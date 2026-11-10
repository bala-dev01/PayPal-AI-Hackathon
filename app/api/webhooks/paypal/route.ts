import { NextResponse } from "next/server";
import { addEvent, findRentalByPayPalRef, listEvents, recordWebhookEvent } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/paypal/client";
import { handleError, jsonError } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLED: Record<string, string> = {
  "PAYMENT.AUTHORIZATION.VOIDED": "webhook_authorization_voided",
  "PAYMENT.CAPTURE.COMPLETED": "webhook_capture_completed",
  "CUSTOMER.DISPUTE.CREATED": "webhook_dispute_created",
};

interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource?: Record<string, unknown>;
  summary?: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Every id on the event that could point back at a rental. custom_id and invoice_id are the rental id. */
function candidateRefs(e: WebhookEvent): (string | null)[] {
  const r = (e.resource ?? {}) as Record<string, unknown>;
  const related = ((r.supplementary_data as Record<string, unknown> | undefined)?.related_ids ?? {}) as Record<string, unknown>;
  const txs = Array.isArray(r.disputed_transactions) ? (r.disputed_transactions as Record<string, unknown>[]) : [];
  return [
    str(r.custom_id),
    str(r.invoice_id),
    ...txs.flatMap((t) => [str(t.custom), str(t.invoice_number), str(t.seller_transaction_id)]),
    str(r.id),
    str(related.authorization_id),
    str(related.order_id),
  ];
}

export async function POST(req: Request) {
  try {
    const webhookId = getEnv().PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      // Never accept unverified webhooks.
      return jsonError("Webhook verification is not configured (PAYPAL_WEBHOOK_ID). Event rejected.", 503);
    }
    const text = await req.text();
    let event: WebhookEvent;
    try {
      event = JSON.parse(text) as WebhookEvent;
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("not an object");
    } catch {
      return jsonError("Body must be JSON.", 400);
    }
    const h = req.headers;
    const sig = {
      authAlgo: h.get("paypal-auth-algo"),
      certUrl: h.get("paypal-cert-url"),
      transmissionId: h.get("paypal-transmission-id"),
      transmissionSig: h.get("paypal-transmission-sig"),
      transmissionTime: h.get("paypal-transmission-time"),
    };
    if (!sig.authAlgo || !sig.certUrl || !sig.transmissionId || !sig.transmissionSig || !sig.transmissionTime) {
      return jsonError("Missing PayPal signature headers.", 400);
    }
    const ok = await verifyWebhookSignature({
      authAlgo: sig.authAlgo,
      certUrl: sig.certUrl,
      transmissionId: sig.transmissionId,
      transmissionSig: sig.transmissionSig,
      transmissionTime: sig.transmissionTime,
      webhookId,
      webhookEventRaw: text,
    });
    if (!ok) return jsonError("Signature verification failed.", 401);

    const type = event.event_type ?? "";
    const eventId = event.id ?? sig.transmissionId;
    const rental = findRentalByPayPalRef(candidateRefs(event));
    const mapped = HANDLED[type];
    // An event we cannot match to a rental yet is not marked as seen, so a PayPal retry can still link it.
    if (mapped && !rental) return NextResponse.json({ ok: true, handled: false });
    // Idempotent: PayPal retries deliveries, and each event id is recorded once.
    if (!recordWebhookEvent(eventId, type, rental?.id ?? null)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (mapped && rental) {
      const r = event.resource ?? {};
      // The same dispute can arrive under a new event id; keep one timeline entry per dispute.
      const did = str(r.dispute_id);
      if (did && listEvents(rental.id).some((x) => x.type === mapped && x.payload.disputeId === did)) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      addEvent(rental.id, mapped, {
        paypalEventId: eventId,
        resourceId: str(r.id) ?? str(r.dispute_id),
        // Disputes carry dispute_id and create_time rather than id.
        disputeId: str(r.dispute_id),
        openedAt: str(r.create_time),
        status: str(r.status) ?? str(r.dispute_state),
        reason: str(r.reason),
        summary: event.summary ?? null,
      });
    }
    return NextResponse.json({ ok: true, handled: Boolean(mapped && rental) });
  } catch (e) {
    return handleError(e);
  }
}
