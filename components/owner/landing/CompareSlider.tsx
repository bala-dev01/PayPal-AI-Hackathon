"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./landing.module.css";
import { useReducedMotion } from "../motion";

/** Source photos are 729x631. The frame crops the empty wall off the top. */
const IMG_H = 631;
const FRAME_H = 560;
const CROP_TOP = IMG_H - FRAME_H;
const fy = (y: number) => (y * IMG_H - CROP_TOP) / FRAME_H;

export type Mark = {
  id: string;
  label: string;
  /** centre and size, normalized to the source photo */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "new" | "prior";
};

export const MARKS: Mark[] = [
  { id: "grip", label: "Gouge in the grip", x: 0.228, y: 0.59, w: 0.19, h: 0.13, kind: "new" },
  { id: "rim", label: "Dent in the lens rim", x: 0.482, y: 0.768, w: 0.115, h: 0.095, kind: "new" },
  { id: "scuff", label: "Corner scuff", x: 0.79, y: 0.73, w: 0.07, h: 0.07, kind: "prior" },
];

const END = 9;

export function CompareSlider({ active, onActive }: { active: string | null; onActive: (id: string | null) => void }) {
  const reduced = useReducedMotion();
  const frame = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  const [p, setP] = useState(END);
  const [touched, setTouched] = useState(false);

  const stopIntro = useCallback(() => cancelAnimationFrame(raf.current), []);

  // One sweep on load: pickup first, then the line travels left and the damage appears.
  useEffect(() => {
    if (reduced) {
      // No sweep: show the normal final position straight away so the damage is visible.
      // (The hook can flip to true after the first render, when the sweep has already set 100.)
      setP(END);
      return;
    }
    setP(100);
    const t0 = performance.now() + 700;
    const dur = 2600;
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setP(100 - (100 - END) * e);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [reduced]);

  const setFromPointer = (clientX: number) => {
    const r = frame.current?.getBoundingClientRect();
    if (!r) return;
    setP(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    stopIntro();
    setTouched(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromPointer(e.clientX);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e.clientX);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 12 : 4;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = p - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = p + step;
    else if (e.key === "PageDown") next = p - 20;
    else if (e.key === "PageUp") next = p + 20;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 100;
    if (next === null) return;
    e.preventDefault();
    stopIntro();
    setTouched(true);
    setP(Math.max(0, Math.min(100, next)));
  };

  return (
    <figure className={styles.compare}>
      <div
        ref={frame}
        className={styles.frame}
        style={{ aspectRatio: `729 / ${FRAME_H}` }}
        onPointerDown={down}
        onPointerMove={move}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/samples/return-front.jpg" alt="The camera at return, with a gouge in the grip and a dent in the lens rim." className={styles.img} draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/samples/pickup-front.jpg"
          alt="The same camera at pickup, undamaged."
          className={`${styles.img} ${styles.before}`}
          style={{ clipPath: `inset(0 ${100 - p}% 0 0)` }}
          draggable={false}
        />

        {MARKS.map((m) => {
          const left = m.x * 100;
          // A new-damage reticle locks on once the return photo has uncovered it.
          const on = m.kind === "prior" ? true : p < left - (m.w * 100) / 2 + 2;
          return (
            <span
              key={m.id}
              className={`${styles.reticle} ${m.kind === "prior" ? styles.reticlePrior : ""} ${on ? styles.reticleOn : ""} ${
                active === m.id ? styles.reticleActive : ""
              }`}
              style={{ left: `${left}%`, top: `${fy(m.y) * 100}%`, width: `${m.w * 100}%`, height: `${(m.h * IMG_H * 100) / FRAME_H}%` }}
              aria-hidden="true"
              onMouseEnter={() => onActive(m.id)}
              onMouseLeave={() => onActive(null)}
            >
              <i />
              <i />
              <i />
              <i />
              <b>{m.kind === "prior" ? "Already there" : "New"}</b>
            </span>
          );
        })}

        <div className={styles.line} style={{ left: `${p}%` }} aria-hidden="true" />
        <div
          className={styles.knob}
          style={{ left: `${p}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Compare pickup and return photos"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p)}
          aria-valuetext={p > 96 ? "Pickup photo" : p < 4 ? "Return photo" : `${Math.round(p)} percent pickup, rest return`}
          onKeyDown={key}
        >
          <span aria-hidden="true" className={styles.knobArrows}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
              <path d="M9 6 3 12l6 6M15 6l6 6-6 6" />
            </svg>
          </span>
        </div>

        <span className={`${styles.cornerTag} ${styles.cornerL}`} style={{ opacity: p > 22 ? 1 : 0 }} aria-hidden="true">
          Pickup
        </span>
        <span className={`${styles.cornerTag} ${styles.cornerR}`} style={{ opacity: p < 78 ? 1 : 0 }} aria-hidden="true">
          Return
        </span>
        {!touched ? (
          <span className={styles.drag} aria-hidden="true">
            Drag the line
          </span>
        ) : null}
      </div>
      <figcaption className={styles.caption}>AI-generated sample images of a fictional camera. Drag, or use the arrow keys.</figcaption>
    </figure>
  );
}
