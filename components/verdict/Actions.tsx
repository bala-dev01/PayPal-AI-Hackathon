"use client";

import { useState } from "react";
import type { Rental } from "@/lib/types";
import { Button, Money } from "@/components/ui";
import { NoRenterTokenNotice, useRenterToken } from "@/app/r/_lib/renter-token";
import { postJson, type Settlement } from "@/app/r/_lib/rental";

/** Accept or contest. The button text states exactly what will move. */
export function Actions({ rental, settlement, onDone }: { rental: Rental; settlement: Settlement; onDone: () => void }) {
  const renterToken = useRenterToken(rental.id);
  const [mode, setMode] = useState<"choose" | "contest">("choose");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "contest" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = rental.currency;
  const fee = settlement.feeCents ?? rental.daily_rate_cents * rental.days;
  const total = settlement.captureTotalCents ?? fee + settlement.depositCapturedCents;

  const act = async (kind: "accept" | "contest") => {
    setBusy(kind);
    setErr(null);
    try {
      await postJson(`/api/rentals/${rental.id}/settlement/${kind}`, kind === "contest" ? { note: note.trim() } : {});
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      // The server may have moved the rental on (for example to a failed settlement). Reload so the retry action shows.
      onDone();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="decide" className="border-2 border-ink bg-card p-5">
      <h2 id="decide" className="text-3xl">Your call</h2>
      {renterToken === null ? <div className="mt-2"><NoRenterTokenNotice /></div> : null}
      <p className="mt-1">
        Nothing is taken until you choose. If you accept, PayPal captures <Money cents={total} currency={cur} size="sm" /> from your hold and
        releases the other <Money cents={settlement.depositReleasedCents} currency={cur} size="sm" tone="clear" />.
      </p>

      {mode === "choose" ? (
        <div className="mt-4 grid gap-3">
          <p className="border-l-4 border-ink pl-3 text-[0.95rem] text-ink-soft">
            If you disagree, the verdict goes to the owner with your note. Nothing is captured while they review. They can only
            lower the charge, and they make the final call inside Handback.
          </p>
          <Button variant="money" disabled={busy !== null || renterToken === null} onClick={() => void act("accept")} className="w-full">
            {busy === "accept" ? "Settling with PayPal..." : "Accept the verdict"}
          </Button>
          <Button variant="ghost" disabled={busy !== null || renterToken === null} onClick={() => setMode("contest")} className="w-full">
            I disagree, send to the owner
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <label htmlFor="note" className="block font-mono text-[0.8125rem] font-bold">
            Tell the owner what is wrong
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="For example: the scratch on the left side was there when I picked it up, see photo 3."
            className="mt-1 w-full border-2 border-ink bg-paper p-3"
          />
          <p className="text-sm text-ink-soft">The owner reviews your note and the photos. They can only lower the charge, never raise it.</p>
          <div className="mt-3 grid gap-3">
            <Button disabled={busy !== null || note.trim().length < 10} onClick={() => void act("contest")} className="w-full">
              {busy === "contest" ? "Sending..." : "Send to the owner"}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setMode("choose")} className="w-full">
              Back
            </Button>
          </div>
          {note.trim().length < 10 ? <p className="mt-2 text-sm text-ink-soft">Write at least a sentence so the owner can act on it.</p> : null}
        </div>
      )}
      {err ? <p role="alert" className="mt-3 border-l-4 border-stamp bg-stamp-wash px-3 py-2">{err}</p> : null}
    </section>
  );
}
