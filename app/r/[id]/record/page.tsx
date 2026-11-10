"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ANGLES } from "@/lib/types";
import { groupFindings } from "@/lib/damage-groups";
import { Button, Money, Stamp, StatusBadge } from "@/components/ui";
import { DisputeBanner, StillWrong } from "@/components/verdict/DisputeBanner";
import { RetrySettlement } from "@/components/verdict/RetrySettlement";
import { ClassStamp, PhotoPair } from "@/components/verdict/PhotoPair";
import { ErrorBlock, LoadingBlock, Shell } from "../../_components/shell";
import { NO_RENTER_TOKEN_MESSAGE, renterHeaders, useRenterToken } from "../../_lib/renter-token";
import { ANGLE_LABEL, humanize, photoUrl, tagNumber, useRental } from "../../_lib/rental";

const PRINT_CSS = `
@media print {
  html, body { background: #fff !important; background-image: none !important; }
  .no-print { display: none !important; }
  .ticket { box-shadow: none !important; break-inside: avoid; }
  .rec-section { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
  @page { margin: 14mm; }
}
`;

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useRental(id);
  const renterToken = useRenterToken(id);

  if (loading && !data) return <Shell id={id} step="record" wide><LoadingBlock label="Pulling the record" /></Shell>;
  if (error || !data) return <Shell id={id} step="record" wide><ErrorBlock message={error ?? "Nothing came back."} onRetry={reload} /></Shell>;

  const { rental, photos, inspection, settlement, events, settlementAuthority, paypalDispute } = data;
  const resolutionUrl = data.resolutionCenterUrl ?? "https://www.paypal.com/resolutioncenter";
  const cur = rental.currency;
  const settled = rental.status === "settled";
  const ids: [string, string | null][] = [
    ["Authorization", rental.paypal_authorization_id],
    ["Capture", rental.paypal_capture_id],
    ["Overage invoice", rental.overage_invoice_id],
  ];

  return (
    <Shell id={id} rental={rental} step="record" wide>
      <style>{PRINT_CSS}</style>

      <header className="rec-section mb-6 border-b-4 border-double border-ink pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[0.8125rem] text-ink-soft">Handback evidence record, tag {tagNumber(id)}</p>
            <h1 className="text-[2.8rem]">{rental.item_name}</h1>
            <p className="max-w-prose text-ink-soft">{rental.item_description}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {settled ? <Stamp tone="clear" tilt={-4} className="text-xl">SETTLED</Stamp> : <StatusBadge status={rental.status} />}
            {rental.is_sample ? <span className="border border-amber bg-amber-wash px-1.5 font-mono text-[0.75rem] font-bold text-amber">Sample rental</span> : null}
          </div>
        </div>
        <div className="no-print mt-4 flex flex-wrap gap-3">
          <Button onClick={() => window.print()}>Print this record</Button>
          {rental.status === "verdict_ready" || rental.status === "contested" ? (
            <Link href={`/r/${id}/verdict`} className="inline-flex min-h-12 items-center border-2 border-ink px-5 font-mono font-bold">
              Back to verdict
            </Link>
          ) : null}
        </div>
        {rental.status === "failed" ? (
          settlementAuthority === "renter" ? (
            <div className="no-print mt-4">
              <RetrySettlement
                rentalId={id}
                who="renter"
                headers={renterHeaders(id)}
                blockedMessage={renterToken === null ? NO_RENTER_TOKEN_MESSAGE : null}
                onDone={() => void reload()}
              />
            </div>
          ) : (
            <div className="no-print mt-4 ticket border-stamp p-5">
              <Stamp tone="damage" press tilt={-4} className="mb-3 text-2xl">SETTLEMENT STOPPED</Stamp>
              <p>
                PayPal could not finish settling this rental.{" "}
                {settlementAuthority === "owner"
                  ? "The owner approved it, so the owner retries it from their console."
                  : "It can be retried by whoever started it."}{" "}
                A retry reuses the same PayPal request, so no money is captured twice.
              </p>
            </div>
          )
        ) : null}
        {rental.status === "released" ? (
          <p className="mt-3 border-l-4 border-clear bg-clear-wash px-3 py-2 no-print">
            The owner released the whole PayPal hold before the item came back. Nothing was charged.
          </p>
        ) : null}
        {!settled && rental.status !== "failed" && rental.status !== "released" ? (
          <p className="mt-3 border-l-4 border-amber bg-amber-wash px-3 py-2 no-print">
            This rental isn't settled yet, so the record is still filling in.
          </p>
        ) : null}
      </header>

      {paypalDispute ? (
        <div className="mb-8">
          <DisputeBanner dispute={paypalDispute} audience="renter" rentalId={id} resolutionUrl={resolutionUrl} />
        </div>
      ) : null}

      <section className="rec-section mb-8" aria-labelledby="terms">
        <h2 id="terms" className="text-3xl">Terms and money</h2>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>Rate</dt>
          <dd><Money cents={rental.daily_rate_cents} currency={cur} size="sm" /> x {rental.days} {rental.days === 1 ? "day" : "days"}</dd>
          <dt>Deposit</dt>
          <dd><Money cents={rental.deposit_cents} currency={cur} size="sm" /></dd>
          <dt>Held by PayPal</dt>
          <dd><Money cents={rental.authorized_cents} currency={cur} size="sm" /></dd>
          <dt>Captured</dt>
          <dd><Money cents={rental.captured_cents} currency={cur} size="sm" tone={settled ? "ink" : "muted"} /></dd>
          <dt>Released</dt>
          <dd><Money cents={rental.released_cents} currency={cur} size="sm" tone="clear" /></dd>
        </dl>
        <h3 className="mt-5 text-2xl">PayPal references</h3>
        <dl className="mt-1 space-y-1">
          {ids.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-2">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="break-all font-mono text-[0.9rem]">{v ?? "none"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-8" aria-labelledby="photos">
        <h2 id="photos" className="text-3xl">Photos, pickup beside return</h2>
        {photos.length === 0 ? (
          <p className="mt-2">No photos are on file for this rental.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {ANGLES.map((a) => {
              const b = photos.find((p) => p.phase === "pickup" && p.angle === a);
              const r = photos.find((p) => p.phase === "return" && p.angle === a);
              return (
                <div key={a} className="rec-section grid grid-cols-2 gap-2">
                  {[
                    [b, "Pickup"],
                    [r, "Return"],
                  ].map(([p, label]) => {
                    const ph = p as typeof b;
                    return (
                      <figure key={label as string} className="m-0">
                        {ph ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photoUrl(id, ph.id)}
                            alt={`${ANGLE_LABEL[a]} view of ${rental.item_name} at ${(label as string).toLowerCase()}`}
                            className="block h-auto w-full border-2 border-ink"
                            loading="lazy"
                          />
                        ) : (
                          <div className="grid aspect-[4/3] place-items-center border-2 border-dashed border-rule font-mono text-sm text-ink-soft">
                            Not taken
                          </div>
                        )}
                        <figcaption className="font-mono text-[0.8125rem] text-ink-soft">
                          {ANGLE_LABEL[a]}, {label as string}
                          {ph ? `, ${new Date(ph.created_at).toLocaleString()}` : ""}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8" aria-labelledby="findings">
        <h2 id="findings" className="text-3xl">Findings</h2>
        {!inspection ? (
          <p className="mt-2">No inspection has been run yet.</p>
        ) : (
          <>
            <p className="mt-1">{inspection.summary}</p>
            <p className="font-mono text-[0.8125rem] text-ink-soft">
              Model {inspection.model}, filed {new Date(inspection.created_at).toLocaleString()}
            </p>
            <ul className="mt-4 space-y-6">
              {inspection.findings.length === 0 ? <li>No differences were found.</li> : null}
              {groupFindings(inspection.findings, settlement?.lines).map((g) => {
                const f = g.primary;
                const line = g.line;
                return (
                  <li key={g.key} className="rec-section">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[0.8125rem] text-ink-soft">
                          {g.views.length > 1 ? `Seen from ${g.views.length} angles (${g.views.map((v) => ANGLE_LABEL[v.angle]).join(", ")}), best view: ` : ""}
                          {ANGLE_LABEL[f.angle]}, {Math.round(f.confidence * 100)}% sure, {f.severity}
                        </p>
                        <h3 className="text-2xl">{f.title}</h3>
                      </div>
                      <ClassStamp c={f.classification} />
                    </div>
                    <PhotoPair rentalId={id} finding={f} photos={photos} />
                    <p className="mt-2">{f.description}</p>
                    {g.views.slice(1).map((v) => (
                      <div key={v.id} className="rec-section mt-3">
                        <p className="font-mono text-[0.8125rem] text-ink-soft">Also seen from {ANGLE_LABEL[v.angle]} and not charged again</p>
                        <PhotoPair rentalId={id} finding={v} photos={photos} />
                      </div>
                    ))}
                    {line ? (
                      <p className="mt-1 font-mono text-[0.9rem]">
                        Charge: <Money cents={line.amountCents} currency={cur} size="sm" tone={line.amountCents > 0 ? "damage" : "clear"} />
                        {line.reason ? `, ${line.reason.toLowerCase()}` : ""}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {settlement ? (
        <section className="rec-section mb-8" aria-labelledby="pricing">
          <h2 id="pricing" className="text-3xl">Pricing</h2>
          <p className="text-sm text-ink-soft">Computed by fixed rules from the findings. The AI never sets an amount.</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt>Item value used (after age)</dt>
            <dd><Money cents={settlement.baseValueCents} currency={cur} size="sm" /></dd>
            {settlement.lines.filter((l) => l.primary !== false).map((l) => (
              <div key={l.findingId} className="contents">
                <dt>{l.title}</dt>
                <dd><Money cents={l.amountCents} currency={cur} size="sm" tone={l.amountCents > 0 ? "damage" : "muted"} /></dd>
              </div>
            ))}
            <dt className="font-bold">Total damage</dt>
            <dd><Money cents={settlement.damageCents} currency={cur} size="sm" /></dd>
            <dt>Taken from deposit</dt>
            <dd><Money cents={settlement.depositCapturedCents} currency={cur} size="sm" /></dd>
            <dt>Invoiced beyond deposit</dt>
            <dd><Money cents={settlement.overageCents} currency={cur} size="sm" /></dd>
            <dt>Deposit released</dt>
            <dd><Money cents={settlement.depositReleasedCents} currency={cur} size="sm" tone="clear" /></dd>
          </dl>
          {rental.renter_note ? (
            <p className="mt-3">
              <span className="font-mono text-[0.8125rem] text-ink-soft">Renter's note</span>
              <br />
              {rental.renter_note}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mb-8" aria-labelledby="timeline">
        <h2 id="timeline" className="text-3xl">Timeline</h2>
        {events.length === 0 ? (
          <p className="mt-2">No events recorded yet.</p>
        ) : (
          <ol className="mt-2 border-l-2 border-ink pl-4">
            {events.map((e) => (
              <li key={e.id} className="rec-section relative pb-3">
                <span aria-hidden="true" className="absolute -left-[1.4rem] top-2 h-2.5 w-2.5 rounded-full bg-ink" />
                <p className="font-semibold">{humanize(e.type)}</p>
                <p className="font-mono text-[0.8125rem] text-ink-soft">{new Date(e.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {settled ? (
        <div className="mb-8">
          <StillWrong resolutionUrl={resolutionUrl} overage={(settlement?.overageCents ?? 0) > 0} />
        </div>
      ) : null}

      <footer className="border-t-2 border-ink pt-3 font-mono text-[0.8125rem] text-ink-soft">
        Record generated {new Date().toLocaleString()} for tag {tagNumber(id)}.
        {rental.is_sample ? " This is a sample rental." : ""}
      </footer>
    </Shell>
  );
}
