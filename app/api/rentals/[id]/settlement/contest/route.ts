import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { addEvent, claimStatus, getRental, updateRental } from "@/lib/db";
import { isRenter, renterRequired } from "@/lib/auth";
import { handleError, jsonError, parseBody } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ note: z.string().trim().min(1).max(1000) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getRental(id)) return jsonError("Rental not found.", 404);
    if (!isRenter(req, id)) return renterRequired();
    const { note } = await parseBody(req, body);
    // Re-read after the body resolves so the check below sees current state.
    const rental = getRental(id);
    if (!rental) return jsonError("Rental not found.", 404);
    if (!claimStatus(id, ["verdict_ready"], "contested")) {
      return jsonError(`The verdict cannot be contested while the rental is ${rental.status}.`, 409);
    }
    updateRental(id, { renter_note: note });
    addEvent(id, "verdict_contested", { note });
    return NextResponse.json({ rental: getRental(id) });
  } catch (e) {
    return handleError(e);
  }
}
