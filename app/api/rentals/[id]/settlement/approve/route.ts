import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getRental } from "@/lib/db";
import { paypalConfigured, PayPalNotConfiguredError } from "@/lib/paypal/client";
import { handleError, isOwner, jsonError, parseBody } from "@/lib/paypal/http";
import { settleRental } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Strict: the owner can only name findings to drop. There is no amount field to send.
const body = z.object({ excludeFindingIds: z.array(z.string().min(1).max(64)).max(100) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getRental(id)) return jsonError("Rental not found.", 404);
    if (!isOwner(req, id)) return jsonError("Owner token required.", 401);
    const { excludeFindingIds } = await parseBody(req, body);
    if (!paypalConfigured()) throw new PayPalNotConfiguredError();
    const rental = await settleRental(id, { kind: "owner_approved", excludeFindingIds });
    return NextResponse.json({ rental });
  } catch (e) {
    return handleError(e);
  }
}
