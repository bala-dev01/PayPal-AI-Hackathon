import "server-only";
import { randomUUID } from "node:crypto";
import {
  addEvent,
  claimStatus,
  failStaleSettling,
  getLatestInspection,
  getPayPalOrderId,
  getRental,
  getSettlementPrivate,
  setSettlementPrivate,
  updateRental,
  type SettleBasis,
} from "./db";
import { captureTotalCents, priceFindings } from "./pricing";
import {
  captureAuthorization,
  getAuthorization,
  getOrder,
  valueToCents,
  voidAuthorization,
  PayPalApiError,
  type PayPalCapture,
} from "./paypal/client";
import { createAndSendOverageInvoice } from "./paypal/toolkit";
import type { Finding, FrozenSettlement, PricingResult, Rental } from "./types";

export class SettlementError extends Error {
  constructor(message: string, public status: number = 409) {
    super(message);
    this.name = "SettlementError";
  }
}

export type SettleAuthority =
  | { kind: "renter_accepted" }
  | { kind: "owner_approved"; excludeFindingIds: string[] };

export interface SettlementQuote {
  pricing: PricingResult;
  feeCents: number;
  /** Rental fee plus the deposit share, never above the authorized amount. */
  captureTotalCents: number;
  excludedFindingIds: string[];
}

/** The only place a charge amount is computed: stored findings through lib/pricing.ts. */
export function quoteSettlement(rental: Rental, findings: Finding[], excludeFindingIds: string[] = []): SettlementQuote {
  // Exclusions go to priceFindings, which drops the whole physical damage (every view of it).
  const pricing = priceFindings({
    findings,
    excludedFindingIds: excludeFindingIds,
    replacementCents: rental.replacement_cents,
    purchaseYear: rental.purchase_year,
    depositCents: rental.deposit_cents,
  });
  const feeCents = rental.daily_rate_cents * rental.days;
  return {
    pricing,
    feeCents,
    captureTotalCents: captureTotalCents(feeCents, pricing, rental.authorized_cents),
    excludedFindingIds: excludeFindingIds,
  };
}

const SETTLEABLE_FROM: Record<SettleAuthority["kind"], Rental["status"]> = {
  renter_accepted: "verdict_ready",
  owner_approved: "contested",
};

/**
 * Settles a rental for the first time: computes the quote, freezes it, claims the
 * rental, then captures (final_capture releases the rest of the hold) and invoices
 * any overage. Guards live here, not in the UI. After a failure use retrySettlement.
 */
export async function settleRental(rentalId: string, authority: SettleAuthority): Promise<Rental> {
  const rental = getRental(rentalId);
  if (!rental) throw new SettlementError("Rental not found.", 404);

  const requiredFrom = SETTLEABLE_FROM[authority.kind];
  if (rental.status === "failed") {
    throw new SettlementError("A settlement for this rental failed part-way. Use the retry action, which resumes safely.", 409);
  }
  if (rental.status !== requiredFrom) {
    throw new SettlementError(
      rental.status === "settling" || rental.status === "settled"
        ? `Rental is already ${rental.status}.`
        : authority.kind === "renter_accepted"
          ? `The verdict cannot be accepted while the rental is ${rental.status}.`
          : `The owner can only approve a contested rental, and this one is ${rental.status}.`,
    );
  }

  if (!rental.paypal_authorization_id || rental.authorized_cents <= 0) {
    throw new SettlementError("This rental has no PayPal hold to settle.", 409);
  }
  const inspection = getLatestInspection(rentalId);
  if (!inspection) throw new SettlementError("There is no inspection to settle from.", 409);

  let exclude: string[] = [];
  if (authority.kind === "owner_approved") {
    const known = new Set(inspection.findings.map((f) => f.id));
    const unknown = authority.excludeFindingIds.filter((id) => !known.has(id));
    if (unknown.length) throw new SettlementError(`Unknown finding id(s): ${unknown.join(", ")}.`, 400);
    exclude = [...new Set(authority.excludeFindingIds)];
  }

  // Amount is computed from stored findings before anything is claimed.
  const quote = quoteSettlement(rental, inspection.findings, exclude);

  // Atomic: only one caller moves the rental into settling.
  if (!claimStatus(rentalId, [requiredFrom], "settling")) {
    throw new SettlementError("Settlement is already in progress or finished.", 409);
  }
  // Freeze the quote now (no await since the claim). Retries read this, never recompute.
  const frozen: FrozenSettlement = {
    basis: authority.kind,
    findings: inspection.findings,
    excludedFindingIds: exclude,
    pricing: quote.pricing,
    feeCents: quote.feeCents,
    captureTotalCents: quote.captureTotalCents,
    authorizationId: rental.paypal_authorization_id,
    currency: rental.currency,
    requestId: `hb-settle-${rental.id}-${randomUUID()}`,
    moneyDone: false,
  };
  setSettlementPrivate(rentalId, {
    basis: authority.kind as SettleBasis,
    excludedFindingIds: exclude,
    quote: frozen,
  });
  addEvent(rentalId, "settlement_started", {
    basis: authority.kind,
    captureTotalCents: frozen.captureTotalCents,
    excludedFindingIds: exclude,
  });
  return runSettlement(rentalId, frozen, false);
}

/** A `settling` rental untouched for this long was interrupted (a crash mid-PayPal). */
export const SETTLING_STALE_MS = 5 * 60 * 1000;

/**
 * Turns a stale `settling` rental into `failed` so it can be retried. Atomic, and safe:
 * the retry reuses the frozen quote and the same PayPal-Request-Id, and adopts any
 * capture PayPal already made, so it cannot charge twice. Returns true if it changed.
 */
export function recoverStaleSettling(rentalId: string, nowMs: number = Date.now()): boolean {
  const cutoff = new Date(nowMs - SETTLING_STALE_MS).toISOString();
  if (!failStaleSettling(rentalId, cutoff)) return false;
  addEvent(rentalId, "settlement_failed", {
    step: "interrupted",
    message: "The settlement stopped before it finished, so it was marked failed. It can be retried safely.",
    recoverable: true,
  });
  return true;
}

/**
 * Resumes a settlement that ended `failed`. It skips the verdict-state precheck, uses the
 * frozen quote and the same PayPal-Request-Id, and cannot change exclusions. If the money
 * step already happened it goes straight to the invoice and never captures again.
 */
export async function retrySettlement(rentalId: string, kind: SettleAuthority["kind"]): Promise<Rental> {
  recoverStaleSettling(rentalId);
  const rental = getRental(rentalId);
  if (!rental) throw new SettlementError("Rental not found.", 404);
  const priv = getSettlementPrivate(rentalId);
  if (priv.basis !== kind) {
    throw new SettlementError("This rental can only be retried by whoever authorized the settlement.", 403);
  }
  if (rental.status !== "failed") {
    throw new SettlementError(
      rental.status === "settled" || rental.status === "settling"
        ? `Rental is already ${rental.status}.`
        : `Only a failed settlement can be retried, and this rental is ${rental.status}.`,
    );
  }
  if (!priv.quote) throw new SettlementError("There is no saved settlement to retry.", 409);
  if (!claimStatus(rentalId, ["failed"], "settling")) {
    throw new SettlementError("Settlement is already in progress or finished.", 409);
  }
  addEvent(rentalId, "settlement_retry", {
    basis: kind,
    captureTotalCents: priv.quote.captureTotalCents,
    resumeAt: priv.quote.moneyDone ? "overage_invoice" : "capture",
  });
  return runSettlement(rentalId, priv.quote, true);
}

/** Finds the capture a lost response may have created, from the order PayPal holds. */
async function findExistingCapture(orderId: string | null, frozen: FrozenSettlement): Promise<PayPalCapture | null> {
  if (!orderId) return null;
  const order = await getOrder(orderId);
  const captures = order.purchase_units?.flatMap((u) => u.payments?.captures ?? []) ?? [];
  const match = captures.find(
    (c) =>
      (c.status === "COMPLETED" || c.status === "PENDING") &&
      valueToCents(c.amount.value) === frozen.captureTotalCents,
  );
  return match ? { id: match.id, status: match.status, amount: match.amount } : null;
}

async function runSettlement(rentalId: string, quote: FrozenSettlement, retrying: boolean): Promise<Rental> {
  let frozen = quote;
  const rental = getRental(rentalId)!;
  const authId = frozen.authorizationId;
  let step = "authorization_check";
  try {
    const moneyDone = frozen.moneyDone || Boolean(rental.paypal_capture_id) || rental.released_cents > 0;

    if (!moneyDone) {
      const auth = await getAuthorization(authId);
      const total = frozen.captureTotalCents;
      let captureId: string | null = null;
      let recovered = false;

      if (auth.status === "CAPTURED" || auth.status === "PARTIALLY_CAPTURED") {
        // A capture may have gone through while its response was lost. Adopt it; never capture again.
        const existing = await findExistingCapture(getPayPalOrderId(rentalId), frozen);
        if (existing) {
          captureId = existing.id;
          recovered = true;
        } else if (auth.status === "CAPTURED") {
          throw new SettlementError(
            "The PayPal authorization is already captured, but no capture for the settled amount was found. It needs manual review.",
            409,
          );
        }
      } else if (auth.status === "VOIDED" && total === 0) {
        recovered = true;
      } else if (auth.status !== "CREATED") {
        throw new SettlementError(`The PayPal hold is ${auth.status.toLowerCase()}, so nothing can be captured from it.`, 409);
      }

      if (!recovered) {
        if (total > valueToCents(auth.amount.value)) {
          throw new SettlementError("Capture would exceed the authorized hold.", 409);
        }
        step = "capture";
        if (total > 0) {
          const cap = await captureAuthorization({
            authorizationId: authId,
            amountCents: total,
            currency: frozen.currency,
            finalCapture: true, // releases the remainder of the hold
            noteToPayer: "Rental fee and any assessed damage. The remainder of your hold has been released.",
            requestId: `${frozen.requestId}-cap`,
          });
          if (cap.status !== "COMPLETED" && cap.status !== "PENDING") {
            throw new SettlementError(`PayPal capture ended as ${cap.status}.`, 502);
          }
          captureId = cap.id;
        } else {
          // Nothing to charge (zero-rate rental, no damage): release the whole hold.
          await voidAuthorization(authId, `${frozen.requestId}-void`);
        }
      }

      const releasedCents = rental.authorized_cents - total;
      updateRental(rentalId, { captured_cents: total, released_cents: releasedCents, paypal_capture_id: captureId });
      frozen = { ...frozen, moneyDone: true };
      setSettlementPrivate(rentalId, { quote: frozen });
      addEvent(rentalId, "capture_completed", {
        captureId,
        capturedCents: total,
        releasedCents,
        authorizedCents: rental.authorized_cents,
        feeCents: frozen.feeCents,
        damageCents: frozen.pricing.damageCents,
        depositCapturedCents: frozen.pricing.depositCapturedCents,
        overageCents: frozen.pricing.overageCents,
        finalCapture: true,
        recoveredFromLostResponse: recovered,
      });
    }

    // Overage: damage above the deposit becomes an invoice. The invoice id is
    // saved the moment it exists so a retry sends instead of creating a second one.
    const overage = frozen.pricing.overageCents;
    if (overage > 0) {
      step = "overage_invoice";
      const email = getSettlementPrivate(rentalId).payerEmail;
      if (!email) {
        addEvent(rentalId, "overage_not_invoiced", {
          overageCents: overage,
          reason: "PayPal did not share a payer email, so no invoice could be addressed.",
        });
      } else {
        const fresh = getRental(rentalId)!;
        const invoiceId = await createAndSendOverageInvoice({
          rentalId,
          itemName: rental.item_name,
          currency: frozen.currency,
          overageCents: overage,
          recipientEmail: email,
          existingInvoiceId: fresh.overage_invoice_id,
          onCreated: (id) => updateRental(rentalId, { overage_invoice_id: id }),
        });
        updateRental(rentalId, { overage_invoice_id: invoiceId });
        addEvent(rentalId, "overage_invoice_sent", { invoiceId, overageCents: overage });
      }
    }

    updateRental(rentalId, { status: "settled" });
    addEvent(rentalId, "settled", { basis: frozen.basis, retried: retrying });
    return getRental(rentalId)!;
  } catch (e) {
    const message =
      e instanceof PayPalApiError
        ? `${e.issue}: ${e.message}${e.debugId ? ` (debug ${e.debugId})` : ""}`
        : e instanceof Error
          ? e.message
          : "Unknown error";
    updateRental(rentalId, { status: "failed" });
    addEvent(rentalId, "settlement_failed", { step, message, recoverable: true });
    if (e instanceof SettlementError) throw e;
    throw new SettlementError(`Settlement failed at ${step}: ${message}. It can be retried safely.`, 502);
  }
}
