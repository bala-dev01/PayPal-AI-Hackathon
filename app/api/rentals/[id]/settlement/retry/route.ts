import { NextResponse } from "next/server";
import { getRental, getSettlementPrivate } from "@/lib/db";
import { isOwner, isRenter, ownerRequired, renterRequired } from "@/lib/auth";
import { paypalConfigured, PayPalNotConfiguredError } from "@/lib/paypal/client";
import { handleError, jsonError } from "@/lib/paypal/http";
import { retrySettlement } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retries a settlement that ended `failed`. Needs the same authority that started it:
 * x-renter-token if the renter accepted, x-owner-token if the owner approved. The retry
 * reuses the frozen quote and the same PayPal-Request-Id, so it cannot charge twice or
 * change which findings were excluded.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getRental(id)) return jsonError("Rental not found.", 404);
    const basis = getSettlementPrivate(id).basis;
    if (!basis) return jsonError("No settlement has been started for this rental, so there is nothing to retry.", 409);
    if (basis === "renter_accepted") {
      if (!isRenter(req, id)) return renterRequired();
    } else if (!isOwner(req, id)) {
      return ownerRequired();
    }
    if (!paypalConfigured()) throw new PayPalNotConfiguredError();
    const rental = await retrySettlement(id, basis);
    return NextResponse.json({ rental });
  } catch (e) {
    return handleError(e);
  }
}
