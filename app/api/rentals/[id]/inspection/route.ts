import { NextResponse } from "next/server";
import { openInspection } from "@/lib/ai/inspection-service";
import { clientIp } from "@/lib/ai/ratelimit";
import { isRenter, renterRequired } from "@/lib/auth";
import { getRental } from "@/lib/db";
import type { StreamEvent } from "@/lib/ai/inspect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Starts the inspection, or joins one already running (including after a page reload).
 * Responds with text/event-stream: one JSON object per `data:` line.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRental(id)) return NextResponse.json({ error: "Rental not found." }, { status: 404 });
  // Starting (or re-joining) an inspection spends model budget and moves the rental, so it needs the renter token.
  if (!isRenter(req, id)) return renterRequired();
  const opened = openInspection(id, clientIp(req));
  if (opened.kind === "error") {
    return NextResponse.json(
      { error: opened.message },
      { status: opened.status, headers: opened.retryAfterSec ? { "Retry-After": String(opened.retryAfterSec) } : undefined },
    );
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
          return;
        }
        if (event.type === "done" || event.type === "error") cleanup();
      };

      // Subscribe before replaying so nothing falls in the gap; both happen in one synchronous turn.
      const pending: StreamEvent[] = [];
      let replaying = true;
      unsubscribe = opened.subscribe((e) => (replaying ? pending.push(e) : send(e)));
      for (const e of opened.backlog) send(e);
      replaying = false;
      for (const e of pending) send(e);

      if (!closed) {
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);
      }
      // A client abort only detaches this listener; the inspection keeps running for reconnects.
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
