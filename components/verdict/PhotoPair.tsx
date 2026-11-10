"use client";

import type { Finding, Photo, Region } from "@/lib/types";
import { Stamp } from "@/components/ui";

const SRC = (rentalId: string, photoId: string) => `/api/rentals/${rentalId}/photos/${photoId}`;

const LABEL: Record<Finding["classification"], string> = {
  new_damage: "NEW DAMAGE",
  pre_existing: "ALREADY THERE",
  normal_wear: "NORMAL WEAR",
  uncertain: "NOT SURE",
};

export function ClassStamp({ c, press = false }: { c: Finding["classification"]; press?: boolean }) {
  if (c === "new_damage") return <Stamp tone="damage" press={press} tilt={-4} className="text-base">{LABEL[c]}</Stamp>;
  if (c === "uncertain") return <Stamp tone="ink" tilt={3} className="text-base text-amber!">{LABEL[c]}</Stamp>;
  if (c === "normal_wear") return <Stamp tone="clear" tilt={2} className="text-base">{LABEL[c]}</Stamp>;
  return <Stamp tone="ink" tilt={-2} className="text-base">{LABEL[c]}</Stamp>;
}

function Frame({
  src,
  alt,
  region,
  tone,
  caption,
  empty,
}: {
  src?: string;
  alt: string;
  region: Region | null;
  tone: "damage" | "neutral";
  caption: string;
  empty: string;
}) {
  const color = tone === "damage" ? "var(--stamp-red)" : "var(--ink)";
  return (
    <figure className="m-0">
      <div className="relative border-2 border-ink bg-paper-deep">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="block h-auto w-full" loading="lazy" />
        ) : (
          <div className="grid aspect-[4/3] place-items-center p-3 text-center font-mono text-sm text-ink-soft">{empty}</div>
        )}
        {src && region ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.w * 100}%`,
              height: `${region.h * 100}%`,
              border: `3px solid ${color}`,
              borderRadius: "46% 54% 50% 50% / 55% 45% 55% 45%",
              boxShadow: "0 0 0 2px rgba(246,241,227,0.7)",
            }}
          />
        ) : null}
      </div>
      <figcaption className="mt-1 font-mono text-[0.8125rem] text-ink-soft">{caption}</figcaption>
    </figure>
  );
}

/** Before and after for one finding, with the finding's regions circled in normalized coordinates. */
export function PhotoPair({ rentalId, finding, photos }: { rentalId: string; finding: Finding; photos: Photo[] }) {
  const before = photos.find((p) => p.phase === "pickup" && p.angle === finding.angle);
  const after = photos.find((p) => p.phase === "return" && p.angle === finding.angle);
  const tone = finding.classification === "new_damage" ? "damage" : "neutral";
  const angle = finding.angle === "detail" ? "close-up" : finding.angle;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Frame
        src={before && SRC(rentalId, before.id)}
        alt={`Pickup photo, ${angle}. ${finding.region_before ? "The finding is circled." : "Nothing is circled because this was not visible at pickup."}`}
        region={finding.region_before}
        tone={tone}
        caption={finding.region_before ? "At pickup, circled" : "At pickup"}
        empty="No pickup photo for this angle"
      />
      <Frame
        src={after && SRC(rentalId, after.id)}
        alt={`Return photo, ${angle}. ${finding.region_after ? "The finding is circled." : ""}`}
        region={finding.region_after}
        tone={tone}
        caption={finding.region_after ? "At return, circled" : "At return"}
        empty="No return photo for this angle"
      />
    </div>
  );
}
