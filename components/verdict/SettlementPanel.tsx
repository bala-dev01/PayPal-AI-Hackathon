"use client";

import type { Rental } from "@/lib/types";
import { Money } from "@/components/ui";
import type { Settlement } from "@/app/r/_lib/rental";

/** Segments of the hold, all from the API's code-computed settlement. */
export function holdSegments(rental: Rental, settlement: Settlement) {
  const fee = settlement.feeCents ?? rental.daily_rate_cents * rental.days;
  const total = settlement.captureTotalCents ?? fee + settlement.depositCapturedCents;
  const segs = [
    { key: "damage", label: "Damage, taken from your deposit", cents: settlement.depositCapturedCents, cls: "hb-seg-damage", color: "var(--seg-damage)", tone: "damage" as const },
    { key: "fee", label: "Rental fee", cents: fee, cls: "hb-seg-fee", color: "var(--seg-fee)", tone: "ink" as const },
    { key: "release", label: "Released back to you", cents: settlement.depositReleasedCents, cls: "hb-seg-release", color: "var(--seg-release)", tone: "clear" as const },
  ];
  return { fee, total, segs, sum: segs.reduce((n, s) => n + s.cents, 0) };
}

/** Wording that is only true for the status the rental is in. */
function panelCopy(status: Rental["status"]) {
  switch (status) {
    case "verdict_ready":
      return { heading: "Held by PayPal for this rental", note: "Nothing is taken until you choose", total: "Would be taken from the hold" };
    case "contested":
      return { heading: "Held by PayPal while the owner reviews", note: "Nothing is taken until the owner decides", total: "Would be taken from the hold" };
    case "settling":
      return { heading: "Being settled with PayPal", note: "Capture and release in progress", total: "Being taken from the hold" };
    case "settled":
      return { heading: "Authorized for this rental", note: "Settled, nothing more will be taken", total: "Taken from the hold" };
    case "failed":
      return { heading: "Authorized for this rental", note: "Settlement did not finish. Retry it", total: "Due from the hold" };
    default:
      return { heading: "Authorized for this rental", note: "", total: "Taken from the hold" };
  }
}

/**
 * The money split: one ticket whose bar fills from "held" into damage, rental fee, and released.
 * Every figure comes from the API (code-computed). Percentages only size the bar.
 */
export function SettlementPanel({ rental, settlement, animate = true }: { rental: Rental; settlement: Settlement; animate?: boolean }) {
  const cur = rental.currency;
  const { fee, total, segs, sum } = holdSegments(rental, settlement);
  const held = rental.authorized_cents > 0 ? rental.authorized_cents : sum;
  const charged = settlement.lines.filter((l) => l.chargeable && l.amountCents > 0);
  // Extra views of an already-priced damage are folded into its one line.
  const free = settlement.lines.filter((l) => l.primary !== false && !(l.chargeable && l.amountCents > 0));
  let delay = 560;
  const copy = panelCopy(rental.status);

  return (
    <section className="ticket" aria-labelledby="split-h">
      <div className="p-5 sm:p-6">
        <h2 id="split-h" className="font-mono text-[0.8125rem] font-normal text-ink-soft" style={{ fontFamily: "var(--font-typewriter-face), monospace", letterSpacing: 0 }}>
          {copy.heading}
        </h2>
        <div className="mt-1 flex items-end justify-between gap-3">
          <Money cents={held} currency={cur} size="lg" />
          <p className="pb-1.5 text-right font-mono text-[0.8125rem] text-ink-soft">{copy.note}</p>
        </div>

        <div
          className="hb-bar mt-4"
          role="img"
          aria-label={segs.map((s) => `${s.label} ${(s.cents / 100).toFixed(2)} ${cur}`).join(", ")}
          style={animate ? undefined : { animation: "none" }}
        >
          <div className="hb-bar-hold" style={animate ? undefined : { animation: "none" }} />
          {segs
            .filter((s) => s.cents > 0)
            .map((s) => {
              const d = delay;
              delay += 260;
              return (
                <div
                  key={s.key}
                  className={`hb-seg ${s.cls}`}
                  style={{ width: `${(s.cents / (sum || 1)) * 100}%`, ["--d" as string]: `${d}ms`, animation: animate ? undefined : "none" }}
                />
              );
            })}
        </div>

        <dl className="mt-4 space-y-2.5">
          {segs.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-4 w-4 shrink-0 border-2 border-ink" style={{ background: s.color, opacity: s.cents > 0 ? 1 : 0.25 }} />
                <span className={s.cents > 0 ? "" : "text-ink-soft"}>{s.label}</span>
              </dt>
              <dd>
                <Money cents={s.cents} currency={cur} tone={s.cents > 0 ? s.tone : "muted"} />
              </dd>
            </div>
          ))}
        </dl>

        {settlement.overageCents > 0 ? (
          <div className="hb-overage mt-4 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-bold">Damage beyond the deposit</p>
              <Money cents={settlement.overageCents} currency={cur} tone="damage" />
            </div>
            <p className="mt-1 text-[0.95rem]">
              This is more than your deposit. The extra would come as a separate PayPal invoice and would not be taken from the hold.
            </p>
          </div>
        ) : null}
      </div>

      <div className="ticket-perf" aria-hidden="true" />
      <div className="p-5 sm:px-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono font-bold">{copy.total}</span>
          <Money cents={total} currency={cur} size="lg" tone={settlement.damageCents > 0 ? "damage" : "ink"} />
        </div>
        <details className="mt-3 border-t border-dashed border-rule pt-2">
          <summary className="min-h-11 cursor-pointer py-2 font-mono text-[0.9rem] font-bold">How the price was worked out</summary>
          <p className="mb-2 text-sm text-ink-soft">Worked out by fixed rules. The AI doesn't set any amount.</p>
          <dl className="space-y-2">
            <Line label="Rental fee" cents={fee} cur={cur} />
            {charged.map((l) => (
              <Line key={l.findingId} label={`Damage: ${l.title}`} sub={`${l.severity}`} cents={l.amountCents} cur={cur} tone="damage" />
            ))}
            {free.map((l) => (
              <Line key={l.findingId} label={l.title} sub={l.reason ?? "No charge"} cents={0} cur={cur} tone="muted" />
            ))}
            {settlement.damageCents > 0 ? <Line label="Total damage" cents={settlement.damageCents} cur={cur} tone="damage" strong /> : null}
            <Line label="Deposit held" cents={rental.deposit_cents} cur={cur} tone="muted" />
            {settlement.damageCents > 0 ? <Line label="Damage taken from deposit" cents={settlement.depositCapturedCents} cur={cur} /> : null}
          </dl>
        </details>
      </div>
    </section>
  );
}

function Line({
  label,
  sub,
  cents,
  cur,
  tone = "ink",
  strong = false,
}: {
  label: string;
  sub?: string;
  cents: number;
  cur: string;
  tone?: "ink" | "damage" | "muted";
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-dashed border-rule pb-1.5 ${strong ? "font-bold" : ""}`}>
      <dt>
        {label}
        {sub ? <span className="block font-mono text-[0.8125rem] font-normal text-ink-soft">{sub}</span> : null}
      </dt>
      <dd>
        <Money cents={cents} currency={cur} tone={tone} size="md" />
      </dd>
    </div>
  );
}
