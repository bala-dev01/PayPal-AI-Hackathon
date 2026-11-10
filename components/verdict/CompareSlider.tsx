"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Region } from "@/lib/types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** True once the element has scrolled into view (stays true). */
function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

/** Reticle box in stage fractions, padded so tiny regions stay visible. */
function reticleBox(r: Region) {
  const w = Math.max(r.w + 0.03, 0.09);
  const h = Math.max(r.h + 0.03, 0.09);
  const x = clamp(r.x + r.w / 2 - w / 2, 0, 1 - w);
  const y = clamp(r.y + r.h / 2 - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

function Reticle({ region, zoom, color }: { region: Region; zoom: number; color: string }) {
  const b = reticleBox(region);
  return (
    <span
      aria-hidden="true"
      className="hb-ret"
      style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, "--ret": color, "--zoom": zoom } as CSSProperties}
    >
      <b />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Pickup and return photos stacked, with the return photo clipped by a draggable divider.
 * Drag, touch, or use the arrow keys on the handle. The reticle and zoom use the finding's real regions.
 */
export function CompareSlider({
  beforeSrc,
  afterSrc,
  regionBefore,
  regionAfter,
  tone,
  angleLabel,
  note,
  noteTone = "damage",
}: {
  beforeSrc?: string;
  afterSrc?: string;
  regionBefore: Region | null;
  regionAfter: Region | null;
  tone: "damage" | "neutral";
  angleLabel: string;
  /** Annotation (classification and price) that sits beside the damage region. */
  note?: ReactNode;
  noteTone?: "damage" | "neutral";
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [ratio, setRatio] = useState(4 / 3);
  const [zoomed, setZoomed] = useState(false);
  const touched = useRef(false);
  const dragging = useRef(false);

  const focus = regionAfter ?? regionBefore;
  const color = tone === "damage" ? "var(--stamp-red)" : "var(--ink)";

  // Zoom geometry: scale s, and the stage offset (as fractions of the box) that centres the region.
  const zoom = (() => {
    if (!zoomed || !focus) return { s: 1, tx: 0, ty: 0 };
    const s = clamp(0.42 / Math.max(focus.w, focus.h, 0.01), 1.8, 3.6);
    const cx = focus.x + focus.w / 2;
    const cy = focus.y + focus.h / 2;
    return { s, tx: clamp(0.5 - cx * s, 1 - s, 0), ty: clamp(0.5 - cy * s, 1 - s, 0) };
  })();

  // One short nudge when it first appears, so people see it can be dragged.
  useEffect(() => {
    if (!inView || touched.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      if (touched.current) return;
      const t = clamp((now - t0 - 500) / 520, 0, 1);
      setPos(50 - 16 * Math.sin(Math.PI * t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView]);

  const setFromClient = useCallback(
    (clientX: number) => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      const frac = (clientX - r.left) / r.width;
      setPos(clamp(((frac - zoom.tx) / zoom.s) * 100, 0, 100));
    },
    [zoom.tx, zoom.s],
  );

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    // The handle itself is the main drag target. Only real controls inside the box opt out.
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [data-nodrag]")) return;
    touched.current = true;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClient(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setFromClient(e.clientX);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    const d = e.shiftKey ? 15 : 5;
    let next: number | null = null;
    if (k === "ArrowLeft" || k === "ArrowDown") next = pos - d;
    else if (k === "ArrowRight" || k === "ArrowUp") next = pos + d;
    else if (k === "PageDown") next = pos - 20;
    else if (k === "PageUp") next = pos + 20;
    else if (k === "Home") next = 0;
    else if (k === "End") next = 100;
    if (next === null) return;
    e.preventDefault();
    touched.current = true;
    setPos(clamp(next, 0, 100));
  };

  const toggleZoom = () => {
    touched.current = true;
    setZoomed((z) => {
      // Centre the divider on the damage when zooming in, so both states of it are visible.
      if (!z && focus) setPos(clamp((focus.x + focus.w / 2) * 100, 0, 100));
      return !z;
    });
  };

  if (!beforeSrc || !afterSrc) {
    const src = afterSrc ?? beforeSrc;
    return (
      <div>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`${afterSrc ? "Return" : "Pickup"} photo, ${angleLabel}`} className="block h-auto w-full border-2 border-ink" loading="lazy" />
        ) : null}
        <p className="mt-1 font-mono text-[0.8125rem] text-ink-soft">
          {afterSrc ? "There is no pickup photo for this angle, so there is nothing to slide against." : "There is no return photo for this angle."}
        </p>
      </div>
    );
  }

  const hx = clamp(zoom.tx + (zoom.s * pos) / 100, 0, 1);
  const noteBox = focus ? reticleBox(focus) : null;
  const noteAbove = noteBox ? zoom.ty + zoom.s * noteBox.y > 0.2 : true;
  const noteX = noteBox ? clamp(zoom.tx + zoom.s * (noteBox.x + noteBox.w / 2), 0.24, 0.76) : 0.5;
  const noteY = noteBox ? (noteAbove ? zoom.ty + zoom.s * noteBox.y : zoom.ty + zoom.s * (noteBox.y + noteBox.h)) : 0;

  return (
    <div ref={ref}>
      <div
        ref={boxRef}
        className={`hb-cmp ${inView ? "is-in" : ""}`}
        style={{ aspectRatio: ratio }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="hb-stage" style={{ transform: `translate(${zoom.tx * 100}%, ${zoom.ty * 100}%) scale(${zoom.s})` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={beforeSrc}
            alt={`Pickup photo, ${angleLabel}`}
            draggable={false}
            loading="lazy"
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight);
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {regionBefore ? <Reticle region={regionBefore} zoom={zoom.s} color={color} /> : null}
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={afterSrc}
              alt={`Return photo, ${angleLabel}${regionAfter ? ". The finding is marked." : ""}`}
              draggable={false}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {regionAfter ? <Reticle region={regionAfter} zoom={zoom.s} color={color} /> : null}
          </div>
        </div>

        <span className="hb-tag left-2" aria-hidden="true">Pickup</span>
        <span className="hb-tag right-2" aria-hidden="true">Return</span>

        {note && noteBox ? (
          <div
            className={`hb-note ${noteTone === "neutral" ? "hb-note-neutral" : ""}`}
            data-side={noteAbove ? "above" : "below"}
            style={{
              left: `${noteX * 100}%`,
              top: `${noteY * 100}%`,
              transform: `translate(-50%, ${noteAbove ? "calc(-100% - 0.55rem)" : "0.55rem"})`,
            }}
          >
            {note}
          </div>
        ) : null}

        <div
          role="slider"
          tabIndex={0}
          aria-label={`Compare pickup and return photos, ${angleLabel}`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}% pickup photo shown on the left, the rest return photo`}
          onKeyDown={onKey}
          className="hb-handle"
          style={{ left: `${hx * 100}%` }}
        >
          <span className="hb-grip" aria-hidden="true">
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
              <path d="M7 1 2 7l5 6" />
            </svg>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
              <path d="m2 1 5 6-5 6" />
            </svg>
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.8125rem] text-ink-soft">Drag the handle, or use the arrow keys.</p>
        {focus ? (
          <button
            type="button"
            onClick={toggleZoom}
            aria-pressed={zoomed}
            className="min-h-11 border-2 border-ink px-3 font-mono text-sm font-bold aria-pressed:bg-ink aria-pressed:text-paper"
          >
            {zoomed ? "Zoom out" : tone === "damage" ? "Zoom to damage" : "Zoom to the mark"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
