"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Rental } from "@/lib/types";
import { Button } from "@/components/ui";
import { tagNumber } from "../_lib/rental";
import "./renter.css";

export type StepKey = "hold" | "pickup" | "return" | "inspection" | "verdict" | "record";

const STEPS: { key: StepKey; label: string; path: string }[] = [
  { key: "hold", label: "Hold", path: "" },
  { key: "pickup", label: "Pickup", path: "/pickup" },
  { key: "return", label: "Return", path: "/return" },
  { key: "inspection", label: "Inspect", path: "/inspection" },
  { key: "verdict", label: "Verdict", path: "/verdict" },
  { key: "record", label: "Record", path: "/record" },
];

/** Page frame: tag number, sample marker, and where you are in the six steps. */
export function Shell({
  id,
  rental,
  step,
  wide = false,
  children,
}: {
  id: string;
  rental?: Rental | null;
  step: StepKey;
  wide?: boolean;
  children: ReactNode;
}) {
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <div className={`mx-auto w-full px-4 pb-24 pt-4 ${wide ? "max-w-2xl" : "max-w-md"}`}>
      <header className="no-print mb-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-2xl leading-none">
            Handback
          </Link>
          <div className="flex items-center gap-2">
            {rental?.is_sample ? (
              <span className="border border-amber px-1.5 py-0.5 font-mono text-[0.75rem] font-bold text-amber bg-amber-wash">
                Sample rental
              </span>
            ) : null}
            <span className="font-mono text-[0.8125rem] text-ink-soft">Tag {tagNumber(id)}</span>
          </div>
        </div>
        <ol className="mt-3 flex gap-1" aria-label="Rental steps">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === at ? "step" : undefined}
              className={`flex-1 border-t-4 pt-1 font-mono text-[0.6875rem] leading-tight ${
                i < at ? "border-ink text-ink-soft" : i === at ? "border-stamp text-ink font-bold" : "border-rule text-ink-soft"
              }`}
            >
              {s.label}
            </li>
          ))}
        </ol>
      </header>
      {children}
    </div>
  );
}

export function LoadingBlock({ label = "Pulling the file" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="ticket p-6">
      <p className="font-mono text-sm text-ink-soft">
        {label}
        <span className="blink" aria-hidden="true">_</span>
      </p>
      <style>{`@media (prefers-reduced-motion: no-preference){.blink{animation:blink 1s steps(2) infinite}}@keyframes blink{50%{opacity:0}}`}</style>
    </div>
  );
}

export function ErrorBlock({
  title = "That didn't load",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="ticket border-stamp p-5">
      <h1 className="text-3xl text-stamp">{title}</h1>
      <p className="mt-2">{message}</p>
      {onRetry ? (
        <Button className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function RedirectBlock() {
  return <LoadingBlock label="Taking you to the right step" />;
}

/** Item name heading used on every step. */
export function ItemHead({ rental, kicker }: { rental: Rental; kicker?: string }) {
  return (
    <div className="mb-4">
      {kicker ? <p className="font-mono text-[0.8125rem] text-ink-soft">{kicker}</p> : null}
      <h1 className="text-[2.6rem]">{rental.item_name}</h1>
    </div>
  );
}
