import { NextResponse } from "next/server";
import { paypalConfigured, PayPalNotConfiguredError } from "@/lib/paypal/client";
import { getRental } from "@/lib/db";
import { isRenter, renterRequired } from "@/lib/auth";
import { handleError, jsonError } from "@/lib/paypal/http";
import { settleRental } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Renter accepts the verdict (x-renter-token required). The charge is computed on the server from stored findings. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getRental(id)) return jsonError("Rental not found.", 404);
    if (!isRenter(req, id)) return renterRequired();
    if (!paypalConfigured()) throw new PayPalNotConfiguredError();
    const rental = await settleRental(id, { kind: "renter_accepted" });
    return NextResponse.json({ rental });
  } catch (e) {
    return handleError(e);
  }
}
