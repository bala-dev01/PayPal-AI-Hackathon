"use client";

import Link from "next/link";
import type { Rental } from "@/lib/types";
import { Money, Stamp } from "@/components/ui";
import { tagNumber } from "@/app/r/_lib/rental";

/** The moment settlement succeeds: what PayPal captured and released, with the references, then the record. */
export function SettledCeremony({ rental }: { rental: Rental }) {
  const cur = rental.currency;
  const ids: [string, string | null][] = [
    ["Capture", rental.paypal_capture_id],
    ["Authorization", rental.paypal_authorization_id],
    ["Overage invoice", rental.overage_invoice_id],
  ];
  return (
    <section aria-labelledby="settled-h" className="ticket hb-thud mb-8 overflow-hidden" role="status">
      <div className="border-b-2 border-ink bg-clear-wash px-5 pb-4 pt-5 sm:px-6">
        <p className="font-mono text-[0.8125rem] text-ink-soft">Tag {tagNumber(rental.id)}, filed</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Stamp tone="clear" tilt={-5} className="hb-slam text-5xl">SETTLED</Stamp>
          <h2 id="settled-h" className="min-w-40 flex-1 text-[1.7rem]">PayPal has moved the money.</h2>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <dl className="space-y-3">
          <div className="hb-rise flex items-baseline justify-between gap-3" style={{ ["--d" as string]: "420ms" }}>
            <dt className="font-mono font-bold">Captured</dt>
            <dd><Money cents={rental.captured_cents} currency={cur} size="lg" tone={rental.captured_cents > 0 ? "ink" : "muted"} /></dd>
          </div>
          <div className="hb-rule-draw h-0 border-t-2 border-dashed border-rule" style={{ ["--d" as string]: "520ms" }} />
          <div className="hb-rise flex items-baseline justify-between gap-3" style={{ ["--d" as string]: "620ms" }}>
            <dt className="font-mono font-bold">Released back to you</dt>
            <dd><Money cents={rental.released_cents} currency={cur} size="lg" tone="clear" /></dd>
          </div>
        </dl>

        <dl className="mt-5 space-y-1 border-t-2 border-ink pt-3">
          {ids.map(([k, v], i) => (
            <div key={k} className="hb-rise grid grid-cols-[8.5rem_1fr] gap-2" style={{ ["--d" as string]: `${760 + i * 90}ms` }}>
              <dt className="text-ink-soft">{k}</dt>
              <dd className="break-all font-mono text-[0.9rem]">{v ?? "none"}</dd>
            </div>
          ))}
        </dl>

        <Link
          href={`/r/${rental.id}/record`}
          className="hb-rise mt-5 inline-flex min-h-12 w-full items-center justify-center border-2 border-ink bg-ink px-5 font-mono font-bold text-paper shadow-[3px_3px_0_var(--rule)]"
          style={{ ["--d" as string]: "1050ms" }}
        >
          Open the evidence record
        </Link>
      </div>
    </section>
  );
}
