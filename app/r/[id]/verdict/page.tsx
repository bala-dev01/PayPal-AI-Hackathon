"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Stamp, Ticket } from "@/components/ui";
import { groupFindings } from "@/lib/damage-groups";
import { Actions } from "@/components/verdict/Actions";
import { DisputeBanner, StillWrong } from "@/components/verdict/DisputeBanner";
import { FindingCard, QuietFindings } from "@/components/verdict/FindingCard";
import { SettledCeremony } from "@/components/verdict/SettledCeremony";
import { SettlementPanel } from "@/components/verdict/SettlementPanel";
import { ErrorBlock, ItemHead, LoadingBlock, RedirectBlock, Shell } from "../../_components/shell";
import { useRental } from "../../_lib/rental";

export default function VerdictPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, redirecting, reload } = useRental(id, ["verdict_ready", "contested", "settling", "settled"]);
  const status = data?.rental.status;

  // While PayPal settles, check again every few seconds.
  useEffect(() => {
    if (status !== "settling") return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [status, reload]);

  if (redirecting) return <Shell id={id} step="verdict" wide><RedirectBlock /></Shell>;
  if (loading && !data) return <Shell id={id} step="verdict" wide><LoadingBlock label="Opening the verdict" /></Shell>;
  if (error || !data) return <Shell id={id} step="verdict" wide><ErrorBlock message={error ?? "Nothing came back."} onRetry={reload} /></Shell>;

  const { rental, inspection, settlement, photos, paypalDispute } = data;
  const resolutionUrl = data.resolutionCenterUrl ?? "https://www.paypal.com/resolutioncenter";

  if (!inspection || !settlement) {
    return (
      <Shell id={id} rental={rental} step="verdict" wide>
        <ErrorBlock
          title="No verdict on file yet"
          message="The inspection for this rental hasn't produced a price. Open the inspection step to run or rerun it."
          onRetry={reload}
        />
        <Link href={`/r/${id}/inspection`} className="mt-4 inline-flex min-h-12 items-center border-2 border-ink px-5 font-mono font-bold">
          Go to inspection
        </Link>
      </Shell>
    );
  }

  const groups = groupFindings(inspection.findings, settlement.lines);
  const damaged = settlement.damageCents > 0;
  const chargedGroups = groups.filter((g) => g.amountCents > 0);
  const quietGroups = groups.filter((g) => g.amountCents <= 0);
  const settled = rental.status === "settled";

  return (
    <Shell id={id} rental={rental} step="verdict" wide>
      <ItemHead rental={rental} kicker="Verdict" />

      {paypalDispute ? (
        <div className="my-6">
          <DisputeBanner dispute={paypalDispute} audience="renter" rentalId={id} resolutionUrl={resolutionUrl} />
        </div>
      ) : null}

      {settled ? (
        <SettledCeremony rental={rental} />
      ) : (
        <section aria-label="Outcome" className="hb-thud mb-6 mt-8 flex flex-wrap items-center gap-x-6 gap-y-7 border-b-4 border-double border-ink pb-5">
          {damaged ? (
            <Stamp tone="damage" tilt={-5} className="hb-slam whitespace-nowrap text-[2.15rem] sm:text-6xl">DAMAGE FOUND</Stamp>
          ) : (
            <Stamp tone="clear" tilt={-5} className="hb-slam whitespace-nowrap text-[2.15rem] sm:text-6xl">ALL CLEAR</Stamp>
          )}
          <p className="hb-rise min-w-48 flex-1 text-lg leading-snug" style={{ ["--d" as string]: "380ms" }}>
            {inspection.findings.length === 0
              ? "The AI found no differences between the pickup and return photos."
              : damaged
                ? `${chargedGroups.length} ${chargedGroups.length === 1 ? "damage carries" : "damages carry"} a charge.${
                    quietGroups.length > 0 ? ` ${quietGroups.length} ${quietGroups.length === 1 ? "does" : "do"} not.` : ""
                  }`
                : "Nothing here costs you anything."}
          </p>
        </section>
      )}

      {settled ? (
        <div className="mb-6">
          <StillWrong resolutionUrl={resolutionUrl} overage={settlement.overageCents > 0} />
        </div>
      ) : null}

      <div className="mb-6">
        <SettlementPanel rental={rental} settlement={settlement} />
      </div>

      <details className="mb-8 border-2 border-dashed border-rule bg-card/60 px-4">
        <summary className="min-h-12 cursor-pointer py-3 font-mono text-[0.9rem] font-bold">What the AI saw, in short</summary>
        <p className="pb-3">{inspection.summary}</p>
      </details>

      {inspection.findings.length === 0 ? (
        <Ticket className="mb-6">
          <h2 className="text-3xl">Nothing to report</h2>
          <p className="mt-1">The AI found no differences between the pickup and return photos. Your full deposit comes back.</p>
        </Ticket>
      ) : (
        <>
          {chargedGroups.length > 0 ? (
            <>
              <h2 className="mb-1 text-3xl">Where it changed</h2>
              <p className="mb-5 text-ink-soft">Slide to see pickup against return. The marks show where the AI looked.</p>
              <div className="space-y-8">
                {chargedGroups.map((g) => (
                  <FindingCard key={g.key} rentalId={id} group={g} photos={photos} currency={rental.currency} />
                ))}
              </div>
            </>
          ) : null}
          <QuietFindings rentalId={id} groups={quietGroups} photos={photos} currency={rental.currency} />
        </>
      )}

      <div className="mt-10">
        {rental.status === "verdict_ready" ? <Actions rental={rental} settlement={settlement} onDone={() => void reload()} /> : null}

        {rental.status === "contested" ? (
          <section role="status" className="border-2 border-amber bg-amber-wash p-5">
            <h2 className="text-3xl">With the owner</h2>
            <p className="mt-1">You disagreed with the verdict. The owner is reviewing it and can only lower the charge. Nothing has been taken from your hold. Check back on this link.</p>
            <p className="mt-2">If the owner settles it and you still disagree, you can open a dispute with PayPal. PayPal decides those, and your evidence record stays on this link.</p>
            {rental.renter_note ? <blockquote className="mt-3 border-l-4 border-ink pl-3 italic">{rental.renter_note}</blockquote> : null}
          </section>
        ) : null}

        {rental.status === "settling" ? (
          <section role="status" className="border-2 border-amber bg-amber-wash p-5">
            <h2 className="text-3xl">Settling with PayPal</h2>
            <p className="mt-1">The capture and release are in progress. This page updates by itself.</p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
