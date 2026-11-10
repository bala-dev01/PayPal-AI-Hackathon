"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import type { Rental, RentalStatus } from "@/lib/types";
import { Button, Stamp } from "@/components/ui";
import { statusLabel } from "@/components/ui/status-badge";
import { LinkButton } from "./link-button";
import { readAllOwnerTokens } from "./owner-token";
import { CountUp, dollars, useInView } from "./motion";
import styles from "./ledger.module.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const SAMPLES_KEY = "handback.console.showSamples";
const ROW_H = 68;
const HEAD_H = 44;

/** Same definition the API uses for "held now". */
const OPEN_HOLD: RentalStatus[] = ["held", "picked_up", "returned", "inspecting", "verdict_ready", "contested", "settling", "failed"];
/** Photos exist once pickup has started. */
const HAS_PHOTOS: RentalStatus[] = ["picked_up", "returned", "inspecting", "verdict_ready", "contested", "settling", "settled", "failed"];

const ledgerTheme = themeQuartz.withParams({
  backgroundColor: "#f6f1e3",
  foregroundColor: "#1c1a16",
  textColor: "#1c1a16",
  accentColor: "#1c1a16",
  borderColor: "#b9ae93",
  headerBackgroundColor: "#ddd3ba",
  headerTextColor: "#1c1a16",
  headerFontFamily: "var(--font-typewriter-face), 'Courier New', monospace",
  headerFontWeight: 700,
  headerFontSize: 13,
  fontFamily: "var(--font-body-face), system-ui, sans-serif",
  fontSize: 14.5,
  oddRowBackgroundColor: "#f0e9d6",
  rowHoverColor: "#e7dfc6",
  selectedRowBackgroundColor: "#ddd3ba",
  wrapperBorderRadius: 0,
  borderRadius: 2,
  rowBorder: { style: "dashed", width: 1, color: "#b9ae93" },
  columnBorder: false,
  headerColumnBorder: false,
  spacing: 8,
  rowHeight: ROW_H,
  headerHeight: HEAD_H,
  inputBorder: { style: "solid", width: 1.5, color: "#1c1a16" },
  focusShadow: { spread: 3, color: "#0a5fd6" },
});

const STATUS_TONE: Record<RentalStatus, "damage" | "clear" | "ink"> = {
  draft: "ink",
  held: "ink",
  picked_up: "ink",
  returned: "ink",
  inspecting: "ink",
  verdict_ready: "ink",
  contested: "damage",
  settling: "ink",
  settled: "clear",
  failed: "damage",
  released: "clear",
};

/* ---------- lazy pickup photo ---------- */

const frontCache = new Map<string, Promise<string | null>>();
function pickupFrontUrl(id: string): Promise<string | null> {
  let p = frontCache.get(id);
  if (!p) {
    p = fetch(`/api/rentals/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const ph = (b?.photos as { id: string; phase: string; angle: string }[] | undefined)?.find(
          (x) => x.phase === "pickup" && x.angle === "front",
        );
        return ph ? `/api/rentals/${id}/photos/${ph.id}` : null;
      })
      .catch(() => null);
    frontCache.set(id, p);
  }
  return p;
}

function PhotoCell({ data }: ICellRendererParams<Rental>) {
  const [src, setSrc] = useState<string | null>(null);
  const wants = !!data && !data.is_sample && HAS_PHOTOS.includes(data.status);
  const id = data?.id;
  useEffect(() => {
    if (!wants || !id) return;
    let live = true;
    void pickupFrontUrl(id).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [wants, id]);
  if (!data) return null;
  return (
    <span className="flex h-full items-center">
      {src ? (
        <span className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Pickup photo of ${data.item_name}`} loading="lazy" />
        </span>
      ) : (
        <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-label={data.is_sample ? "Sample row, no photo" : "No photo yet"}>
          {data.is_sample ? "sample" : "no photo"}
        </span>
      )}
    </span>
  );
}

/* ---------- other cells ---------- */

function StatusStampCell({ data }: ICellRendererParams<Rental>) {
  if (!data) return null;
  return (
    <span className="flex h-full items-center">
      <Stamp tone={STATUS_TONE[data.status]} tilt={-3} className="!border-2 !px-2 !py-0 text-[0.75rem] leading-6">
        {statusLabel(data.status)}
      </Stamp>
      {(data as Rental & { hasPayPalDispute?: boolean }).hasPayPalDispute ? (
        <span
          title="A dispute was opened in PayPal"
          aria-label="Dispute opened in PayPal"
          className="ml-2 border-2 border-amber bg-amber-wash px-1 font-mono text-[0.7rem] font-bold leading-5 text-amber"
        >
          Dispute
        </span>
      ) : null}
    </span>
  );
}

function ItemCell({ data }: ICellRendererParams<Rental>) {
  if (!data) return null;
  return (
    <span className="flex h-full flex-col justify-center leading-tight">
      <span className="truncate font-bold">{data.item_name}</span>
      <span className="flex items-center gap-2 font-mono text-[0.75rem] text-ink-soft">
        <span className="truncate">{data.category}</span>
        {data.is_sample ? (
          <span className="border border-stamp px-1 font-bold text-stamp" title="Sample row. This is not a real rental.">
            Sample
          </span>
        ) : null}
      </span>
    </span>
  );
}

function TagCell({ data }: ICellRendererParams<Rental>) {
  if (!data) return null;
  return (
    <Link
      href={`/owner/rentals/${data.id}`}
      className="flex h-full items-center font-mono text-[0.85rem] font-bold underline decoration-rule underline-offset-4 hover:decoration-ink"
      aria-label={`Open rental ${data.id}, ${data.item_name}`}
    >
      {data.id.slice(0, 8)}
    </Link>
  );
}

function OpenCell({ data }: ICellRendererParams<Rental>) {
  if (!data) return null;
  return (
    <Link
      href={`/owner/rentals/${data.id}`}
      className="flex h-full items-center justify-end font-mono text-[0.85rem] font-bold"
      aria-label={`View ${data.item_name}`}
    >
      View
    </Link>
  );
}

/** Fee, captured damage and released share of the hold, drawn as one bar. */
function HoldBarCell({ data }: ICellRendererParams<Rental>) {
  if (!data) return null;
  const fmt = (c: number) => dollars(c).replace(".00", "");
  const fee = data.daily_rate_cents * data.days;
  const held = data.authorized_cents;

  if (held === 0) {
    const planned = fee + data.deposit_cents;
    return (
      <div className={styles.holdCell}>
        <div className={`${styles.holdTrack} ${styles.holdTrackNone}`} aria-hidden="true" />
        <div className={styles.holdText}>Not held yet. {fmt(planned)} planned</div>
      </div>
    );
  }

  const settled = data.captured_cents > 0 || data.released_cents > 0;
  if (!settled) {
    return (
      <div className={styles.holdCell} title={`${fmt(held)} held, nothing charged`}>
        <div className={styles.holdTrack} aria-hidden="true">
          <span className={`${styles.holdSeg} ${styles.segHeld}`} style={{ width: "100%" }} />
        </div>
        <div className={styles.holdText}>
          <span>
            <b>{fmt(held)}</b> held, nothing charged
          </span>
        </div>
      </div>
    );
  }

  const captured = data.captured_cents;
  const feePart = Math.min(fee, captured);
  const dmg = Math.max(0, captured - feePart);
  const rel = data.released_cents;
  const total = Math.max(held, feePart + dmg + rel, 1);
  const pct = (c: number) => `${(c / total) * 100}%`;
  return (
    <div
      className={styles.holdCell}
      role="img"
      aria-label={`Hold ${fmt(held)}: rental fee ${fmt(feePart)}, damage ${fmt(dmg)}, released ${fmt(rel)}`}
    >
      <div className={styles.holdTrack} aria-hidden="true">
        {feePart > 0 ? <span className={`${styles.holdSeg} ${styles.segFee}`} style={{ width: pct(feePart) }} /> : null}
        {dmg > 0 ? <span className={`${styles.holdSeg} ${styles.segDmg}`} style={{ width: pct(dmg), animationDelay: "120ms" }} /> : null}
        {rel > 0 ? <span className={`${styles.holdSeg} ${styles.segRel}`} style={{ width: pct(rel), animationDelay: "240ms" }} /> : null}
      </div>
      <div className={styles.holdText} aria-hidden="true">
        <span>
          fee <b>{fmt(feePart)}</b>
        </span>
        <span className={dmg > 0 ? styles.tDmg : ""}>damage {fmt(dmg)}</span>
        <span className={rel > 0 ? styles.tRel : ""}>back {fmt(rel)}</span>
      </div>
    </div>
  );
}

function dateComparator(filterLocal: Date, cell: string | undefined) {
  if (!cell) return -1;
  const d = new Date(cell);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = filterLocal.getTime();
  return a === b ? 0 : a < b ? -1 : 1;
}

/* ---------- the ledger ---------- */

export function Ledger() {
  const router = useRouter();
  const [rentals, setRentals] = useState<Rental[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(false);

  useEffect(() => {
    try {
      setShowSamples(localStorage.getItem(SAMPLES_KEY) === "1");
    } catch {
      /* default stays off */
    }
  }, []);
  const toggleSamples = () =>
    setShowSamples((v) => {
      try {
        localStorage.setItem(SAMPLES_KEY, v ? "0" : "1");
      } catch {
        /* not persisted */
      }
      return !v;
    });

  const load = useCallback(async () => {
    setError(null);
    setRentals(null);
    try {
      const res = await fetch("/api/rentals", { cache: "no-store", headers: { "x-owner-tokens": readAllOwnerTokens().join(",") } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      setRentals(body.rentals as Rental[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The ledger could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sampleCount = rentals?.filter((r) => r.is_sample).length ?? 0;
  const visible = useMemo(() => (rentals ? (showSamples ? rentals : rentals.filter((r) => !r.is_sample)) : []), [rentals, showSamples]);

  const totals = useMemo(() => {
    let held = 0;
    let cap = 0;
    let rel = 0;
    let need = 0;
    for (const r of visible) {
      if (OPEN_HOLD.includes(r.status)) held += r.authorized_cents - r.captured_cents - r.released_cents;
      cap += r.captured_cents;
      rel += r.released_cents;
      if (r.status === "contested") need += 1;
    }
    return { held, cap, rel, need };
  }, [visible]);

  const columnDefs = useMemo<ColDef<Rental>[]>(
    () => [
      { colId: "photo", headerName: "Photo", width: 90, sortable: false, filter: false, cellRenderer: PhotoCell, suppressHeaderMenuButton: true },
      { colId: "tag", headerName: "Tag no.", field: "id", width: 112, cellRenderer: TagCell, filter: "agTextColumnFilter" },
      { colId: "item", headerName: "Item", field: "item_name", flex: 2, minWidth: 210, cellRenderer: ItemCell, filter: "agTextColumnFilter" },
      {
        colId: "status",
        headerName: "Status",
        valueGetter: (p) => (p.data ? statusLabel(p.data.status) : ""),
        width: 215,
        filter: "agTextColumnFilter",
        cellRenderer: StatusStampCell,
      },
      {
        colId: "hold",
        headerName: "Hold: fee, damage, released",
        valueGetter: (p) => (p.data ? p.data.authorized_cents / 100 : 0),
        flex: 2,
        minWidth: 290,
        filter: "agNumberColumnFilter",
        cellRenderer: HoldBarCell,
      },
      {
        colId: "created",
        headerName: "Created",
        field: "created_at",
        width: 140,
        sort: "desc",
        filter: "agDateColumnFilter",
        filterParams: { comparator: dateComparator },
        valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""),
      },
      { colId: "open", headerName: "", width: 80, sortable: false, filter: false, cellRenderer: OpenCell, suppressHeaderMenuButton: true },
    ],
    [],
  );
  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: true }), []);

  const onRowClicked = useCallback(
    (e: RowClickedEvent<Rental>) => {
      // Links inside the row handle themselves; the rest of the row opens the rental too.
      const t = e.event?.target as HTMLElement | undefined;
      if (t?.closest("a,button,input")) return;
      if (e.data) router.push(`/owner/rentals/${e.data.id}`);
    },
    [router],
  );

  const loading = rentals === null && !error;

  return (
    <div>
      <KpiRow totals={totals} ready={!loading && !error} />

      <div className={styles.bar}>
        <h2 className={styles.barTitle}>
          Rentals
          {rentals ? (
            <span className={styles.count}>
              {visible.length} {visible.length === 1 ? "row" : "rows"}
            </span>
          ) : null}
        </h2>
        {sampleCount > 0 ? (
          <button
            type="button"
            role="switch"
            aria-checked={showSamples}
            onClick={toggleSamples}
            className={`${styles.switch} ${showSamples ? styles.switchOn : ""}`}
          >
            <span className={styles.track} aria-hidden="true">
              <span className={styles.thumbKnob} />
            </span>
            Show sample rows
          </button>
        ) : null}
      </div>

      {showSamples && sampleCount > 0 ? (
        <p className={styles.sampleNote}>
          {sampleCount} sample {sampleCount === 1 ? "row is" : "rows are"} on. They are labelled &ldquo;Sample&rdquo;, are not
          real rentals, and are counted in the totals above.
        </p>
      ) : null}

      <div aria-busy={loading}>
        {error ? (
          <div role="alert" className={`ticket mt-4 p-6`}>
            <h2 className="text-3xl">The ledger did not load</h2>
            <p className="mt-2 text-ink-soft">{error}</p>
            <Button className="mt-4" onClick={load}>
              Try again
            </Button>
          </div>
        ) : loading ? (
          <EmptyFrame>
            <p role="status" className="m-0 font-mono text-ink-soft">
              Loading the ledger...
            </p>
          </EmptyFrame>
        ) : visible.length === 0 ? (
          <EmptyFrame>
            <h3 className={styles.emptyH}>Nothing on the ledger yet</h3>
            <p className={styles.emptyP}>
              Create a rental and send the renter the link. When their hold lands it appears here, with a photo, a verdict
              and a bar showing where the money went.
            </p>
            <div className={styles.emptyActions}>
              <LinkButton href="/owner/new">Create a rental</LinkButton>
              {sampleCount > 0 ? (
                <Button variant="ghost" onClick={toggleSamples}>
                  Show sample rows
                </Button>
              ) : null}
            </div>
          </EmptyFrame>
        ) : (
          <div className={styles.gridFrame} style={{ height: Math.min(660, HEAD_H + ROW_H * visible.length + 24) }}>
            <AgGridReact<Rental>
              theme={ledgerTheme}
              rowData={visible}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              rowHeight={ROW_H}
              headerHeight={HEAD_H}
              getRowId={(p) => p.data.id}
              onRowClicked={onRowClicked}
              rowStyle={{ cursor: "pointer" }}
              animateRows={false}
              suppressCellFocus={false}
              overlayNoRowsTemplate="No rentals match these filters."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <div className={styles.ghostHead} aria-hidden="true">
        <span>Photo</span>
        <span>Item</span>
        <span>Status</span>
        <span>Hold: fee, damage, released</span>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.ghostRow} aria-hidden="true" style={{ opacity: 0.85 - i * 0.22 }}>
          <span className={styles.ghostPhoto} />
          <span className={styles.ghostLines}>
            <span className={styles.ghostLine} style={{ width: `${70 - i * 12}%` }} />
            <span className={styles.ghostLine} style={{ width: "38%" }} />
          </span>
          <span className={styles.ghostStamp} />
          <span className={styles.ghostBar} />
        </div>
      ))}
      <div className={styles.emptyCard}>{children}</div>
    </div>
  );
}

/* ---------- KPI tickets ---------- */

function KpiRow({ totals, ready }: { totals: { held: number; cap: number; rel: number; need: number }; ready: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  const run = seen && ready;
  return (
    <div ref={ref} className={styles.kpis}>
      <Kpi cls={styles.kpiHeld} label="Held now" note="Authorized, not yet charged" muted={totals.held === 0}>
        <CountUp value={totals.held} run={run} format={dollars} />
      </Kpi>
      <Kpi cls={styles.kpiDmg} label="Captured" note="Charged after inspection" muted={totals.cap === 0}>
        <CountUp value={totals.cap} run={run} format={dollars} delay={120} />
      </Kpi>
      <Kpi cls={styles.kpiRel} label="Released" note="Returned to renters" muted={totals.rel === 0}>
        <CountUp value={totals.rel} run={run} format={dollars} delay={240} />
      </Kpi>
      <Kpi
        cls={styles.kpiNeed}
        label="Needs you"
        note={totals.need > 0 ? "Contested verdicts to review" : "No contested verdicts"}
        muted={totals.need === 0}
        stamp={run && totals.need > 0}
      >
        <CountUp value={totals.need} run={run} delay={360} />
      </Kpi>
    </div>
  );
}

function Kpi({
  cls,
  label,
  note,
  muted,
  stamp,
  children,
}: {
  cls: string | undefined;
  label: string;
  note: string;
  muted: boolean;
  stamp?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.kpi} ${cls} ${muted ? styles.kpiMuted : ""}`}>
      <div className={styles.kpiStrip} aria-hidden="true" />
      <div className={styles.kpiBody}>
        <span className={styles.kpiLabelRow}>
          <span className={styles.kpiLabel}>{label}</span>
          {stamp ? (
            <Stamp tone="damage" press tilt={4} className={styles.kpiStamp}>
              Review
            </Stamp>
          ) : null}
        </span>
        <span className={styles.kpiNum}>{children}</span>
        <span className={styles.kpiNote}>{note}</span>
      </div>
    </div>
  );
}
