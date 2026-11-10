import { NextResponse } from "next/server";
import { addEvent, claimStatus, getRental, listPhotos } from "@/lib/db";
import { isRenter, renterRequired } from "@/lib/auth";
import { ANGLES, PHASES, type Phase, type RentalStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** pickup completes held -> picked_up; return completes picked_up -> returned. */
const TRANSITIONS: Record<Phase, { from: RentalStatus; to: RentalStatus }> = {
  pickup: { from: "held", to: "picked_up" },
  return: { from: "picked_up", to: "returned" },
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRental(id)) return fail(404, "Rental not found.");
  if (!isRenter(req, id)) return renterRequired();

  // Parse the body FIRST. Anything read from the database before this await could be stale
  // by the time a slow or held-open request finishes, so state is read only afterwards.
  const body = (await req.json().catch(() => null)) as { phase?: unknown } | null;
  const phase = body?.phase;
  if (typeof phase !== "string" || !(PHASES as readonly string[]).includes(phase)) {
    return fail(400, "phase must be pickup or return.");
  }
  const t = TRANSITIONS[phase as Phase];

  // Everything from here to the claim is synchronous: no await, no interleaving.
  const rental = getRental(id);
  if (!rental) return fail(404, "Rental not found.");

  // Calling again after the transition succeeded is harmless.
  if (rental.status === t.to) return NextResponse.json({ rental });
  if (rental.status !== t.from) {
    return fail(409, `Cannot complete ${phase} while the rental is ${rental.status}.`);
  }

  const have = new Set(listPhotos(id, phase as Phase).map((p) => p.angle));
  const missing = ANGLES.filter((a) => !have.has(a));
  if (missing.length > 0) return fail(409, `Missing ${phase} photos: ${missing.join(", ")}.`);

  // Atomic compare-and-set: only moves the rental if it is still in the expected status.
  if (!claimStatus(id, [t.from], t.to)) {
    return fail(409, `Cannot complete ${phase}: the rental changed state.`);
  }
  addEvent(id, `phase.${phase}_complete`, { photos: ANGLES.length });
  return NextResponse.json({ rental: getRental(id) });
}
