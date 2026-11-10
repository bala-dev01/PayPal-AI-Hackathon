import Link from "next/link";
import type { PayPalDispute } from "@/lib/dispute";

const date = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
};

const LINK = "inline-flex min-h-11 items-center border-2 border-ink px-4 font-mono text-[0.9rem] font-bold";

/**
 * Shown only when PayPal told us a dispute exists for this rental. It shows the date and
 * dispute id PayPal sent, and a status only if PayPal sent one.
 */
export function DisputeBanner({
  dispute,
  audience,
  rentalId,
  resolutionUrl,
}: {
  dispute: PayPalDispute;
  audience: "renter" | "owner";
  rentalId: string;
  resolutionUrl: string;
}) {
  return (
    <section aria-labelledby="dispute-h" role="status" className="no-print border-2 border-amber bg-amber-wash">
      <div className="border-b-2 border-dashed border-amber px-4 py-2 font-mono text-[0.8125rem] font-bold text-amber">
        PayPal dispute on file
      </div>
      <div className="p-4 sm:p-5">
        <h2 id="dispute-h" className="text-3xl">Dispute opened in PayPal</h2>
        <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-soft">Opened</dt>
          <dd className="font-mono">{date(dispute.openedAt)}</dd>
          <dt className="text-ink-soft">Dispute ID</dt>
          <dd className="break-all font-mono">{dispute.disputeId ?? "PayPal did not send one"}</dd>
          {dispute.status ? (
            <>
              <dt className="text-ink-soft">PayPal status</dt>
              <dd className="font-mono">{dispute.status}</dd>
            </>
          ) : null}
        </dl>
        {audience === "owner" ? (
          <>
            <p className="mt-3 max-w-[62ch]">
              PayPal decides this dispute, not Handback. Respond in PayPal and use this rental&rsquo;s evidence record to back
              up your answer. Handback does not send anything to PayPal for you.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href={`/r/${rentalId}/record`} className={LINK}>
                Open the evidence record
              </Link>
              <a href={resolutionUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
                Open PayPal Resolution Center
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 max-w-[62ch]">
              PayPal decides this dispute. Follow it in the Resolution Center. This evidence record stays here for you to
              refer to.
            </p>
            <a href={resolutionUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} mt-3`}>
              Open PayPal Resolution Center
            </a>
          </>
        )}
      </div>
    </section>
  );
}

/** "Still think this is wrong?" for a settled rental. */
export function StillWrong({ resolutionUrl, overage }: { resolutionUrl: string; overage: boolean }) {
  return (
    <section aria-labelledby="wrong-h" className="no-print border-2 border-dashed border-rule bg-card/60 p-4 sm:p-5">
      <h2 id="wrong-h" className="text-3xl">Still think this is wrong?</h2>
      <p className="mt-1 max-w-[62ch]">
        Accepting here does not take away your normal PayPal rights. You can open a dispute with PayPal, and PayPal decides it.
        Your evidence record is saved here with the photos, findings and pricing.
      </p>
      {overage ? (
        <p className="mt-2 max-w-[62ch]">
          The amount beyond your deposit came as a separate PayPal invoice. You can question that invoice with the owner or with PayPal.
        </p>
      ) : null}
      <a href={resolutionUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} mt-3`}>
        Open PayPal Resolution Center
      </a>
    </section>
  );
}
