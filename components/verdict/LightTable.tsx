"use client";

import { ANGLES, type Angle, type Finding, type Photo } from "@/lib/types";
import { ANGLE_LABEL, photoUrl } from "@/app/r/_lib/rental";

export interface LtEntry {
  key: string;
  kind: "step" | "finding" | "note";
  text: string;
  detail?: string;
  finding?: Finding;
}

const CLASS_LABEL: Record<Finding["classification"], string> = {
  new_damage: "NEW DAMAGE",
  pre_existing: "ALREADY THERE",
  normal_wear: "NORMAL WEAR",
  uncertain: "NOT SURE",
};
const CLASS_COLOR: Record<Finding["classification"], string> = {
  new_damage: "var(--lt-red)",
  pre_existing: "var(--lt-dim)",
  normal_wear: "var(--lt-green)",
  uncertain: "var(--lt-scan)",
};

const ANGLE_RE = /^Comparing the (front|back|left|right|top|detail) angle/;

/** Which angle a real stream event is about, if any. */
function angleOf(e: LtEntry): Angle | null {
  if (e.kind === "finding" && e.finding) return e.finding.angle;
  if (e.kind === "step") {
    const m = ANGLE_RE.exec(e.text);
    if (m) return m[1] as Angle;
  }
  return null;
}

function Reticle({ r, calm }: { r: { x: number; y: number; w: number; h: number }; calm: boolean }) {
  const w = Math.max(r.w + 0.03, 0.09);
  const h = Math.max(r.h + 0.03, 0.09);
  const x = Math.min(Math.max(r.x + r.w / 2 - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(r.y + r.h / 2 - h / 2, 0), 1 - h);
  return (
    <span
      aria-hidden="true"
      className={`lt-ret ${calm ? "lt-ret-calm" : ""}`}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Plate({
  label,
  src,
  alt,
  scanning,
  scanKey,
  regions,
}: {
  label: string;
  src?: string;
  alt: string;
  scanning: boolean;
  scanKey: string;
  regions: { r: { x: number; y: number; w: number; h: number }; calm: boolean; id: string }[];
}) {
  return (
    <figure className="m-0">
      <figcaption className="lt-dim mb-1 font-mono text-[0.8125rem]">{label}</figcaption>
      <div className="lt-photo" style={{ aspectRatio: "4 / 3" }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="lt-dim absolute inset-0 grid place-items-center p-2 text-center font-mono text-xs">Waiting for the first angle</div>
        )}
        {regions.map((g) => (
          <Reticle key={g.id} r={g.r} calm={g.calm} />
        ))}
        {scanning ? <span key={scanKey} aria-hidden="true" className="lt-scan" /> : null}
      </div>
    </figure>
  );
}

/**
 * Dark light-table view of a running inspection. It shows only what the live stream has reported:
 * the angle being compared, the real photo pair for it, and each finding as it lands.
 */
export function LightTable({
  rentalId,
  photos,
  entries,
  phase,
}: {
  rentalId: string;
  photos: Photo[];
  entries: LtEntry[];
  phase: "idle" | "running" | "done" | "failed";
}) {
  const findings = entries.filter((e) => e.kind === "finding" && e.finding);
  let active: Angle | null = null;
  let lastEntry: LtEntry | null = null;
  const compared: Angle[] = [];
  for (const e of entries) {
    const a = angleOf(e);
    if (a) active = a;
    if (e.kind === "step" && ANGLE_RE.test(e.text) && a && !compared.includes(a)) compared.push(a);
    lastEntry = e;
  }
  const photoFor = (phaseName: "pickup" | "return", a: Angle) => photos.find((p) => p.phase === phaseName && p.angle === a);
  const stateOf = (a: Angle): "done" | "now" | "todo" => {
    if (phase === "done") return "done";
    if (a === active && phase === "running") return "now";
    return compared.includes(a) ? "done" : "todo";
  };

  const before = active ? photoFor("pickup", active) : undefined;
  const after = active ? photoFor("return", active) : undefined;
  const here = active ? findings.filter((e) => e.finding!.angle === active) : [];
  const latestId = here.length ? here[here.length - 1]!.finding!.id : null;
  const scanning = phase === "running" || phase === "idle";
  const scanKey = `${active ?? "none"}:${entries.length}`;
  const caption = lastEntry ?? null;
  const newCount = findings.filter((e) => e.finding!.classification === "new_damage").length;

  return (
    <section className="lt p-4 sm:p-5" aria-label="Light table">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--lt-line)] pb-2">
        <p className="font-mono text-[0.8125rem] font-bold">Condition report, live</p>
        <p className="lt-dim font-mono text-[0.8125rem]" role="status">
          {phase === "running" ? "Working" : phase === "done" ? "Filed" : phase === "failed" ? "Stopped" : "Starting"}
        </p>
      </div>

      {/* Six-angle progress strip, each with its real return photo */}
      <ol className="mb-4 grid grid-cols-6 gap-1.5" aria-label="Angles compared">
        {ANGLES.map((a) => {
          const st = stateOf(a);
          const p = photoFor("return", a);
          return (
            <li key={a} className="lt-cell" data-state={st} aria-current={st === "now" ? "step" : undefined}>
              {p ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl(rentalId, p.id)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              ) : null}
              <span className="absolute inset-x-0 bottom-0 bg-black/70 px-0.5 py-0.5 text-center font-mono text-[0.6875rem] font-bold leading-tight">
                {a === "detail" ? "Close" : ANGLE_LABEL[a]?.replace(" side", "")}
              </span>
              <span className="sr-only">{st === "done" ? ", compared" : st === "now" ? ", comparing now" : ", waiting"}</span>
              {st === "done" ? (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center bg-[var(--lt-green)] text-[0.625rem] font-bold text-black">
                  OK
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* The pair under the scan line */}
      <div className="grid grid-cols-2 gap-2">
        <Plate
          label="Pickup"
          src={before ? photoUrl(rentalId, before.id) : undefined}
          alt={active ? `Pickup photo, ${ANGLE_LABEL[active]?.toLowerCase()}` : ""}
          scanning={scanning}
          scanKey={scanKey + "b"}
          regions={here.filter((e) => e.finding!.region_before).map((e) => ({ id: e.finding!.id, r: e.finding!.region_before!, calm: e.finding!.id !== latestId || e.finding!.classification !== "new_damage" }))}
        />
        <Plate
          label="Return"
          src={after ? photoUrl(rentalId, after.id) : undefined}
          alt={active ? `Return photo, ${ANGLE_LABEL[active]?.toLowerCase()}` : ""}
          scanning={scanning}
          scanKey={scanKey + "a"}
          regions={here.filter((e) => e.finding!.region_after).map((e) => ({ id: e.finding!.id, r: e.finding!.region_after!, calm: e.finding!.id !== latestId || e.finding!.classification !== "new_damage" }))}
        />
      </div>

      <div aria-live="polite" className="mt-3 min-h-[2.75rem]">
        {caption ? (
          <>
            <p className={`font-mono text-[0.9rem] ${caption.kind === "note" ? "text-[var(--lt-scan)]" : ""}`}>
              {caption.kind === "finding" && caption.finding ? `Marking the ${ANGLE_LABEL[caption.finding.angle]?.toLowerCase()} angle: ${caption.finding.title}` : caption.text}
            </p>
            {caption.kind !== "finding" && caption.detail && caption.text !== "Inspection complete" ? <p className="lt-dim text-[0.9rem]">{caption.detail}</p> : null}
          </>
        ) : (
          <p className="lt-dim font-mono text-[0.9rem]">
            Opening the file<span className="caret" aria-hidden="true">_</span>
          </p>
        )}
      </div>

      {/* Findings land here */}
      {findings.length > 0 ? (
        <div className="mt-3 border-t border-[var(--lt-line)] pt-3">
          <p className="mb-2 font-mono text-[0.8125rem] font-bold">
            {findings.length} {findings.length === 1 ? "finding" : "findings"} so far, {newCount} new
          </p>
          <ol className="space-y-1.5" aria-label="Findings">
            {findings.map((e) => {
              const f = e.finding!;
              return (
                <li key={e.key} className="lt-tag lt-land" data-hit={f.classification === "new_damage"}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="lt-chip" style={{ color: CLASS_COLOR[f.classification] }}>{CLASS_LABEL[f.classification]}</span>
                    <span className="lt-dim font-mono text-[0.8125rem]">{ANGLE_LABEL[f.angle]}, {Math.round(f.confidence * 100)}% sure</span>
                  </div>
                  <p className="mt-0.5 font-semibold">{f.title}</p>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <details className="mt-4 border-t border-[var(--lt-line)] pt-2">
        <summary className="min-h-11 cursor-pointer py-2.5 font-mono text-[0.8125rem] font-bold">Agent log, {entries.length} {entries.length === 1 ? "line" : "lines"}</summary>
        <ol className="space-y-1.5" aria-label="Inspection steps">
          {entries.map((e, i) => (
            <li key={e.key} className="grid grid-cols-[2rem_1fr] gap-2">
              <span className="lt-dim font-mono text-[0.8125rem]">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-mono text-[0.85rem]">
                {e.kind === "finding" && e.finding ? `Finding, ${ANGLE_LABEL[e.finding.angle]?.toLowerCase()}: ${e.finding.title}` : e.text}
              </span>
            </li>
          ))}
        </ol>
      </details>
      <style>{`@media (prefers-reduced-motion: no-preference){.caret{animation:caret 1s steps(2) infinite}}@keyframes caret{50%{opacity:0}}`}</style>
    </section>
  );
}
