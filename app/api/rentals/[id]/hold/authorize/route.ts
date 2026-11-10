import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import {
  addEvent,
  claimStatus,
  clearHoldNonce,
  getPayPalOrderId,
  getRental,
  holdAmountCents,
  setRenterToken,
  setSettlementPrivate,
  updateRental,
  verifyHoldNonce,
} from "@/lib/db";
import {
  authorizeOrder,
  paypalConfigured,
  PayPalNotConfiguredError,
  valueToCents,
  voidAuthorization,
} from "@/lib/paypal/client";
import { handleError, jsonError, parseBody } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ orderId: z.string().trim().min(1).max(64), holdNonce: z.string().min(1).max(200) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orderId, holdNonce } = await parseBody(req, body);
    const rental = getRental(id);
    if (!rental) return jsonError("Rental not found.", 404);
    if (rental.is_sample) {
      return jsonError("This is a sample rental that only fills the owner console. It cannot take a PayPal hold.", 409);
    }
    // The order id is readable by anyone with the link, so it proves nothing. Only the browser
    // that created the order holds the nonce; without it nobody else can take the renter token.
    if (!verifyHoldNonce(id, holdNonce)) {
      return jsonError("This hold can only be completed by the browser that started it.", 403);
    }
    if (!paypalConfigured()) throw new PayPalNotConfiguredError();
    if (getPayPalOrderId(id) !== orderId) return jsonError("That order does not belong to this rental.", 409);
    if (rental.status === "held" && rental.paypal_authorization_id) {
      // The renter token is minted once and never shown again, so a repeat cannot return it.
      return jsonError("This hold was already authorized. The renter token is only issued once, at that moment.", 409);
    }
    if (rental.status !== "draft") return jsonError(`A hold cannot be placed while the rental is ${rental.status}.`, 409);

    const order = await authorizeOrder(orderId, `hb-auth-${rental.id}-${orderId}`);
    const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) return jsonError("PayPal did not return an authorization. The buyer may not have approved the order.", 409);
    if (auth.status !== "CREATED") return jsonError(`The hold is ${auth.status.toLowerCase()}, not active.`, 409);
    const authorized = valueToCents(auth.amount.value);
    if (authorized < holdAmountCents(rental) || auth.amount.currency_code !== rental.currency) {
      await voidAuthorization(auth.id, `hb-void-short-${rental.id}-${auth.id}`).catch(() => null);
      return jsonError("The authorized amount did not match the hold, so it was released.", 409);
    }
    if (!claimStatus(id, ["draft"], "held")) {
      return jsonError("This hold was already authorized by another request.", 409);
    }
    clearHoldNonce(id);
    // Minted once, here. Only a hash is stored; the plain token goes back in this response only.
    const renterToken = randomBytes(24).toString("base64url");
    setRenterToken(id, renterToken);
    updateRental(id, { paypal_authorization_id: auth.id, authorized_cents: authorized });
    setSettlementPrivate(id, { payerEmail: order.payer?.email_address ?? null });
    addEvent(id, "hold_authorized", {
      authorizationId: auth.id,
      authorizedCents: authorized,
      expiresAt: auth.expiration_time ?? null,
    });
    return NextResponse.json({ rental: getRental(id), renterToken });
  } catch (e) {
    return handleError(e);
  }
}
