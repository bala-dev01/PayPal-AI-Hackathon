"use client";

import type { Finding, Photo, PricingLine } from "@/lib/types";
import type { DamageGroup } from "@/lib/damage-groups";
import { Money, Ticket } from "@/components/ui";
import { EXCLUDED_REASON, OTHER_VIEW_REASON } from "@/lib/pricing";
import { ANGLE_LABEL } from "@/app/r/_lib/rental";
import { ClassStamp } from "./PhotoPair";
import { CompareSlider } from "./CompareSlider";

const SRC = (rentalId: string, photoId: string) => `/api/rentals/${rentalId}/photos/${photoId}`;

const NOTE_LABEL: Record<Finding["classification"], string> = {
  new_damage: "NEW DAMAGE",
  pre_existing: "ALREADY THERE",
  normal_wear: "NORMAL WEAR",
  uncertain: "NOT SURE",
};

/** Plain-language reason a finding costs nothing. */
export function whyFree(f: Finding, line?: PricingLine): string {
  switch (f.classification) {
    case "pre_existing":
      return "This was already on the item when you picked it up. Your pickup photo shows it, so it is not charged.";
    case "normal_wear":
      return "Ordinary use leaves marks like this. It is expected, so it is never charged.";
    case "uncertain":
      return "The AI could not tell whether you caused this. When it is unsure, you get the benefit of the doubt.";
    default:
      if (line?.reason === EXCLUDED_REASON) return "The owner removed this charge after reviewing the verdict. It is not charged.";
      if (line?.reason === OTHER_VIEW_REASON) return "This is another view of a damage that is already charged once, so it is not charged again.";
      if (line?.reason === "Cosmetic only") return "This is a cosmetic mark. Under the pricing rules, cosmetic marks cost nothing.";
      return `The AI is ${Math.round(f.confidence * 100)}% sure this is new damage. Below 75%, it is not charged.`;
  }
}

/** Before and after for one finding, as a comparison slider with the finding annotated on it. */
export function FindingCompare({
  rentalId,
  finding,
  photos,
  currency,
  cents,
  showPrice,
}: {
  rentalId: string;
  finding: Finding;
  photos: Photo[];
  currency: string;
  cents: number;
  showPrice: boolean;
}) {
  const before = photos.find((p) => p.phase === "pickup" && p.angle === finding.angle);
  const after = photos.find((p) => p.phase === "return" && p.angle === finding.angle);
  const damage = finding.classification === "new_damage";
  const angle = finding.angle === "detail" ? "close-up" : ANGLE_LABEL[finding.angle]?.toLowerCase() ?? finding.angle;
  return (
    <CompareSlider
      beforeSrc={before && SRC(rentalId, before.id)}
      afterSrc={after && SRC(rentalId, after.id)}
      regionBefore={finding.region_before}
      regionAfter={finding.region_after}
      tone={damage ? "damage" : "neutral"}
      noteTone={damage ? "damage" : "neutral"}
      angleLabel={angle}
      note={
        <>
          <span>{NOTE_LABEL[finding.classification]}</span>
          {showPrice ? <Money cents={cents} currency={currency} size="sm" tone={cents > 0 ? "ink" : "clear"} /> : null}
        </>
      }
    />
  );
}

/** One card per charged physical damage: the best angle, one annotation, one price, and the other angles on request. */
export function FindingCard({
  rentalId,
  group,
  photos,
  currency,
}: {
  rentalId: string;
  group: DamageGroup;
  photos: Photo[];
  currency: string;
}) {
  const { primary: finding, line } = group;
  const others = group.views.slice(1);
  const charged = !!line && line.chargeable && line.amountCents > 0;
  const excluded = line?.reason === EXCLUDED_REASON;
  const cents = charged ? line.amountCents : 0;
  return (
    <Ticket
      as="article"
      stub={
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.95rem]">
            {charged ? `Charged once, as ${finding.severity} damage.` : excluded ? "The owner removed this charge." : whyFree(finding, line)}
          </p>
          <Money cents={cents} currency={currency} tone={charged ? "damage" : "clear"} />
        </div>
      }
    >
      <div className="mb-3">
        <p className="font-mono text-[0.8125rem] text-ink-soft">
          {others.length > 0 ? `Seen from ${group.views.length} angles, best view: ` : ""}
          {ANGLE_LABEL[finding.angle]}, {Math.round(finding.confidence * 100)}% sure
        </p>
        <h3 className="text-[1.9rem]">{finding.title}</h3>
      </div>
      {/* Room above the photo for the annotation tag */}
      <div className="pt-1">
        <FindingCompare rentalId={rentalId} finding={finding} photos={photos} currency={currency} cents={cents} showPrice />
      </div>
      <p className="mt-3">{finding.description}</p>
      {others.length > 0 ? (
        <details className="mt-4 border-t border-dashed border-rule pt-3">
          <summary className="min-h-11 cursor-pointer font-mono text-[0.9rem] font-bold">
            Seen from {group.views.length} angles: {group.views.map((v) => ANGLE_LABEL[v.angle]).join(", ")}
          </summary>
          <div className="mt-3 space-y-6">
            {others.map((v) => (
              <div key={v.id}>
                <p className="mb-1 font-mono text-[0.8125rem] text-ink-soft">
                  {ANGLE_LABEL[v.angle]}, {Math.round(v.confidence * 100)}% sure. Not charged again.
                </p>
                <FindingCompare rentalId={rentalId} finding={v} photos={photos} currency={currency} cents={0} showPrice={false} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </Ticket>
  );
}

/** No-charge findings, quiet and compact. Each row opens to its photo pair. */
export function QuietFindings({
  rentalId,
  groups,
  photos,
  currency,
}: {
  rentalId: string;
  groups: DamageGroup[];
  photos: Photo[];
  currency: string;
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="quiet-h" className="mt-8">
      <h2 id="quiet-h" className="text-3xl">Noted, no charge</h2>
      <p className="mb-3 text-ink-soft">These cost you nothing. Open one to see the photos.</p>
      <ul className="border-t-2 border-ink">
        {groups.map((g) => {
          const f = g.primary;
          return (
            <li key={g.key} className="border-b border-dashed border-rule">
              <details className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block font-semibold">{f.title}</span>
                    <span className="block font-mono text-[0.8125rem] text-ink-soft">
                      {ANGLE_LABEL[f.angle]}, {Math.round(f.confidence * 100)}% sure
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="scale-[0.72] origin-right"><ClassStamp c={f.classification} /></span>
                    <span aria-hidden="true" className="font-mono text-xl transition-transform duration-150 group-open:rotate-90">+</span>
                  </span>
                </summary>
                <div className="pb-4 pt-1">
                  <FindingCompare rentalId={rentalId} finding={f} photos={photos} currency={currency} cents={0} showPrice={false} />
                  <p className="mt-2">{f.description}</p>
                  <p className="mt-1 text-sm text-ink-soft">{whyFree(f, g.line)}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
