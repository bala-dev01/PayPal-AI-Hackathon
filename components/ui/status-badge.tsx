import type { RentalStatus } from "@/lib/types";

const LABELS: Record<RentalStatus, string> = {
  draft: "Draft",
  held: "Hold placed",
  picked_up: "Picked up",
  returned: "Returned",
  inspecting: "Inspecting",
  verdict_ready: "Verdict ready",
  contested: "Contested",
  settling: "Settling",
  settled: "Settled",
  failed: "Failed",
  released: "Hold released",
};

const TONES: Record<RentalStatus, string> = {
  draft: "border-rule text-ink-soft bg-transparent",
  held: "border-ink text-ink bg-card",
  picked_up: "border-ink text-ink bg-card",
  returned: "border-ink text-ink bg-card",
  inspecting: "border-amber text-amber bg-amber-wash",
  verdict_ready: "border-ink text-paper bg-ink",
  contested: "border-stamp text-stamp bg-stamp-wash",
  settling: "border-amber text-amber bg-amber-wash",
  settled: "border-clear text-clear bg-clear-wash",
  failed: "border-stamp text-stamp bg-stamp-wash",
  released: "border-clear text-clear bg-clear-wash",
};

export function statusLabel(status: RentalStatus): string {
  return LABELS[status];
}

export function StatusBadge({ status, className = "" }: { status: RentalStatus; className?: string }) {
  return (
    <span
      className={`inline-block rounded-[2px] border px-2 py-0.5 font-mono text-[0.8125rem] font-bold ${TONES[status]} ${className}`}
    >
      {LABELS[status]}
    </span>
  );
}
