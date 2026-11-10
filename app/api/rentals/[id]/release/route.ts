import { NextResponse } from "next/server";
import { addEvent, claimStatus, getRental, updateRental } from "@/lib/db";
import { ownerRequired } from "@/lib/auth";
import { paypalConfigured, PayPalNotConfiguredError, voidAuthorization } from "@/lib/paypal/client";
import { handleError, isOwner, jsonError } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Before settlement owns the hold. `returned` is included so a rental stranded there (for
 * example after the AI refused or failed the inspection) can still be released. `inspecting`
 * is deliberately absent: a running inspection owns the rental, and the claim below is an
 * atomic compare-and-set, so a release can never win against one that has already started.
 */
const RELEASABLE = ["held", "picked_up", "returned"] as const;

/**
 * Owner-only escape hatch for a hold the renter can no longer manage (lost token, other
 * browser). Voids the whole authorization and ends the rental as `released`. It can only
 * give money back: there is no capture here, and no amount to send.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rental = getRental(id);
    if (!rental) return jsonError("Rental not found.", 404);
    if (!isOwner(req, id)) return ownerRequired();
    if (!(RELEASABLE as readonly string[]).includes(rental.status) || !rental.paypal_authorization_id) {
      return jsonError(
        rental.status === "released"
          ? "This hold was already released."
          : `The hold can only be released before the inspection starts, and this rental is ${rental.status}.`,
        409,
      );
    }
    if (!paypalConfigured()) throw new PayPalNotConfiguredError();

    const from = rental.status as (typeof RELEASABLE)[number];
    // Claim first, atomically: the renter's phase route then refuses to move the rental on
    // while the void is in flight, so settlement can never meet a voided hold.
    if (!claimStatus(id, [from], "released")) {
      return jsonError("The rental changed while releasing. Reload and check its status.", 409);
    }
    try {
      await voidAuthorization(rental.paypal_authorization_id, `hb-release-${id}-${rental.paypal_authorization_id}`);
    } catch (e) {
      claimStatus(id, ["released"], from);
      throw e;
    }
    updateRental(id, { captured_cents: 0, released_cents: rental.authorized_cents });
    addEvent(id, "hold_released_by_owner", {
      authorizationId: rental.paypal_authorization_id,
      releasedCents: rental.authorized_cents,
      capturedCents: 0,
      from,
    });
    return NextResponse.json({ rental: getRental(id) });
  } catch (e) {
    return handleError(e);
  }
}
