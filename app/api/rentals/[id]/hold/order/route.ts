import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { addEvent, getRental, holdAmountCents, setHoldOrderIfDraft } from "@/lib/db";
import { createOrder, newRequestId, paypalConfigured, PayPalNotConfiguredError } from "@/lib/paypal/client";
import { handleError, jsonError } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rental = getRental(id);
    if (!rental) return jsonError("Rental not found.", 404);
    if (rental.is_sample) {
      return jsonError("This is a sample rental that only fills the owner console. It cannot take a PayPal hold. Create your own rental to try one.", 409);
    }
    if (!paypalConfigured()) throw new PayPalNotConfiguredError();
    if (rental.status !== "draft") return jsonError(`A hold cannot be placed while the rental is ${rental.status}.`, 409);
    const amount = holdAmountCents(rental);
    if (amount <= 0) return jsonError("The hold amount is zero.", 409);
    const order = await createOrder({
      amountCents: amount,
      currency: rental.currency,
      customId: rental.id,
      invoiceId: rental.id,
      description: `Handback hold: ${rental.item_name}`,
      requestId: newRequestId(`hb-ord-${rental.id}`),
    });
    // One-time nonce: returned only to this caller, stored hashed. Authorizing needs it, so
    // knowing the rental id (the public link) is not enough to take the renter token.
    const holdNonce = randomBytes(24).toString("base64url");
    if (!setHoldOrderIfDraft(id, order.id, holdNonce)) {
      return jsonError("A hold can no longer be started for this rental.", 409);
    }
    // The order id is deliberately not in the event: events are public.
    addEvent(id, "hold_order_created", { amountCents: amount });
    return NextResponse.json({ orderId: order.id, holdNonce });
  } catch (e) {
    return handleError(e);
  }
}
