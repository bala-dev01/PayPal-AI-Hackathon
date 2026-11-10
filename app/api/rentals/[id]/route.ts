import { NextResponse } from "next/server";
import { getLatestInspection, getRental, getSettlementPrivate, listEvents, listPhotos } from "@/lib/db";
import { derivePayPalDispute, resolutionCenterUrl } from "@/lib/dispute";
import { getEnv } from "@/lib/env";
import { handleError, jsonError } from "@/lib/paypal/http";
import { quoteSettlement, recoverStaleSettling } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    recoverStaleSettling(id);
    const rental = getRental(id);
    if (!rental) return jsonError("Rental not found.", 404);
    const inspection = getLatestInspection(id);
    const priv = getSettlementPrivate(id);
    let settlement = null;
    if (priv.quote) {
      // Once a settlement has started, show exactly what was frozen and charged.
      const q = priv.quote;
      settlement = { ...q.pricing, feeCents: q.feeCents, captureTotalCents: q.captureTotalCents, excludedFindingIds: q.excludedFindingIds };
    } else if (inspection) {
      const q = quoteSettlement(rental, inspection.findings, priv.excludedFindingIds);
      settlement = { ...q.pricing, feeCents: q.feeCents, captureTotalCents: q.captureTotalCents, excludedFindingIds: q.excludedFindingIds };
    }
    const settlementAuthority = priv.basis === "renter_accepted" ? "renter" : priv.basis === "owner_approved" ? "owner" : null;
    const events = listEvents(id);
    return NextResponse.json({
      rental,
      paypalDispute: derivePayPalDispute(events),
      resolutionCenterUrl: resolutionCenterUrl(getEnv().PAYPAL_ENVIRONMENT),
      // Server file paths stay on the server; fetch images via the photo route.
      photos: listPhotos(id).map(({ path: _path, ...p }) => p),
      inspection,
      settlement,
      settlementAuthority,
      // Older events may still carry the PayPal order id; it must not be public.
      events: events.map((e) => {
        const { orderId: _orderId, ...payload } = e.payload;
        return { ...e, payload };
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
