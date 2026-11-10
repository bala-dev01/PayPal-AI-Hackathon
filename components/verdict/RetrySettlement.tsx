"use client";

import { useState } from "react";
import { Button, Stamp } from "@/components/ui";
import { NETWORK_MESSAGE, readError } from "@/app/r/_lib/rental";

/**
 * Shown when PayPal could not finish a settlement. Retrying reuses the same PayPal
 * request ids, so the same capture is never made twice.
 */
export function RetrySettlement({
  rentalId,
  headers,
  who,
  blockedMessage,
  onDone,
}: {
  rentalId: string;
  headers: Record<string, string>;
  who: "renter" | "owner";
  /** Set when this browser lacks the key to retry. */
  blockedMessage?: string | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setErr(null);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/rentals/${rentalId}/settlement/retry`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: "{}",
        });
      } catch {
        throw new Error(NETWORK_MESSAGE);
      }
      if (!res.ok) throw new Error(await readError(res, "The retry didn't go through."));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="failed-h" className="ticket border-stamp p-5">
      <Stamp tone="damage" press tilt={-4} className="mb-3 text-2xl">
        SETTLEMENT STOPPED
      </Stamp>
      <h2 id="failed-h" className="text-3xl">
        PayPal could not finish settling this rental
      </h2>
      <p className="mt-2">
        The agreed amount was not fully processed. You can try again. Every attempt reuses the same PayPal request, so no
        money is captured twice: if part of it already went through, PayPal recognizes it and does not repeat it.
      </p>
      {blockedMessage ? (
        <p role="alert" className="mt-3 border-l-4 border-amber bg-amber-wash px-3 py-2">
          {blockedMessage}
        </p>
      ) : (
        <p className="mt-2 text-ink-soft">
          {who === "renter"
            ? "You accepted this verdict, so you can retry it from here."
            : "You approved this settlement, so you can retry it from here."}
        </p>
      )}
      {err ? (
        <p role="alert" className="mt-3 border-l-4 border-stamp bg-stamp-wash px-3 py-2">
          {err}
        </p>
      ) : null}
      <Button variant="money" className="mt-4" onClick={retry} disabled={busy || Boolean(blockedMessage)}>
        {busy ? "Retrying with PayPal..." : "Retry settlement"}
      </Button>
    </section>
  );
}
