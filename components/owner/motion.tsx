"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** True when the visitor asked for less motion. Starts false on the server. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Becomes true once the element is mostly on screen, and stays true. */
export function useInView<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
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
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

/** Counts from zero to value when `run` turns true. Screen readers get the final figure at once. */
export function CountUp({
  value,
  run = true,
  duration = 1100,
  delay = 0,
  format = (n: number) => String(Math.round(n)),
  className,
}: {
  value: number;
  run?: boolean;
  duration?: number;
  delay?: number;
  format?: (n: number) => string;
  className?: string;
}): ReactNode {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  const target = useRef(value);
  target.current = value;

  useEffect(() => {
    if (!run) return;
    if (reduced) {
      setN(value);
      return;
    }
    let raf = 0;
    let start = 0;
    const from = 0;
    const timer = setTimeout(() => {
      const tick = (t: number) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setN(from + (target.current - from) * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [run, value, reduced, duration, delay]);

  return (
    <span className={className}>
      <span aria-hidden="true">{format(run ? n : 0)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

export const dollars = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dollarsWhole = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");
