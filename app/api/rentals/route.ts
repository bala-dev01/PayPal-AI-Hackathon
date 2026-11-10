import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createRentalWithToken, listDisputedRentalIds, listRentalsForOwnerTokens } from "@/lib/db";
import { handleError, parseBody } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HOLD_CENTS = 1_000_000;

const createSchema = z
  .object({
    itemName: z.string().trim().min(1).max(120),
    itemDescription: z.string().trim().max(1000).default(""),
    category: z.string().trim().min(1).max(40).default("other"),
    dailyRateCents: z.number().int().min(0).max(MAX_HOLD_CENTS),
    days: z
      .number()
      .int()
      .min(1, "must be at least 1 day")
      .max(3, "must be 3 days or fewer: PayPal only guarantees a payment hold for 3 days, and renewing it is not supported yet"),
    depositCents: z.number().int().min(0).max(MAX_HOLD_CENTS),
    replacementCents: z.number().int().min(1).max(100_000_000),
    replacementSource: z.string().trim().max(200).nullish(),
    purchaseYear: z.number().int().min(1980).max(2100).nullish(),
  })
  .refine((v) => v.dailyRateCents * v.days + v.depositCents > 0, { message: "the hold must be more than zero" })
  .refine((v) => v.dailyRateCents * v.days + v.depositCents <= MAX_HOLD_CENTS, { message: "the hold is too large" });

const OPEN_HOLD = ["held", "picked_up", "returned", "inspecting", "verdict_ready", "contested", "settling", "failed"];

export async function POST(req: Request) {
  try {
    const b = await parseBody(req, createSchema);
    const { rental, ownerToken } = createRentalWithToken({
      item_name: b.itemName,
      item_description: b.itemDescription,
      category: b.category,
      daily_rate_cents: b.dailyRateCents,
      days: b.days,
      deposit_cents: b.depositCents,
      replacement_cents: b.replacementCents,
      replacement_source: b.replacementSource ?? null,
      purchase_year: b.purchaseYear ?? null,
    });
    return NextResponse.json({ id: rental.id, ownerToken }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Public, but scoped: returns the labelled sample rentals plus only those rentals whose
 * owner token appears in the comma-separated `x-owner-tokens` header. Totals cover the
 * returned set only.
 */
export async function GET(req: Request) {
  try {
    const tokens = (req.headers.get("x-owner-tokens") ?? "").split(",");
    const disputed = listDisputedRentalIds();
    const rentals = listRentalsForOwnerTokens(tokens).map((r) => ({ ...r, hasPayPalDispute: disputed.has(r.id) }));
    const sum = (f: (r: (typeof rentals)[number]) => number) => rentals.reduce((s, r) => s + f(r), 0);
    return NextResponse.json({
      rentals,
      totals: {
        heldCents: sum((r) => (OPEN_HOLD.includes(r.status) ? r.authorized_cents - r.captured_cents - r.released_cents : 0)),
        capturedCents: sum((r) => r.captured_cents),
        releasedCents: sum((r) => r.released_cents),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
