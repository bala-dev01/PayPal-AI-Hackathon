"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import { Button } from "@/components/ui";
import { LightTable, type LtEntry } from "@/components/verdict/LightTable";
import { ErrorBlock, ItemHead, LoadingBlock, RedirectBlock, Shell } from "../../_components/shell";
import { renterHeaders, useRenterToken, NoRenterTokenNotice } from "../../_lib/renter-token";
import { readError, NETWORK_MESSAGE, useRental } from "../../_lib/rental";

type StreamEvent =
  | { type: "step"; label: string; detail?: string }
  | { type: "finding"; finding: Finding }
  | { type: "done"; inspectionId: string }
  | { type: "error"; message: string };

type Entry = LtEntry & { at: string };

const MAX_RECONNECTS = 3;

/** Findings often arrive in a burst; show them landing one at a time. Order and content are untouched. */
const PACE_MS = 420;

export default function InspectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, redirecting, reload } = useRental(id, ["returned", "inspecting"]);
  const renterToken = useRenterToken(id);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  const queue = useRef<StreamEvent[]>([]);
  const pacer = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const add = useCallback((e: Omit<Entry, "at" | "key"> & { key: string }) => {
    if (seen.current.has(e.key)) return;
    seen.current.add(e.key);
    setEntries((list) => [...list, { ...e, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }]);
  }, []);

  const apply = useCallback(
    (ev: StreamEvent) => {
      if (ev.type === "step") add({ key: `s:${ev.label}|${ev.detail ?? ""}`, kind: "step", text: ev.label, detail: ev.detail });
      else if (ev.type === "finding") add({ key: `f:${ev.finding.id}`, kind: "finding", text: ev.finding.title, finding: ev.finding });
      else if (ev.type === "done") {
        setPhase("done");
        redirectTimer.current = setTimeout(() => router.push(`/r/${id}/verdict`), 3000);
      } else if (ev.type === "error") {
        setFailure(ev.message);
        setPhase("failed");
      }
    },
    [add, id, router],
  );

  const push = useCallback(
    (ev: StreamEvent) => {
      if (queue.current.length === 0 && !pacer.current) {
        apply(ev);
        return;
      }
      queue.current.push(ev);
      if (pacer.current) return;
      pacer.current = setInterval(() => {
        const next = queue.current.shift();
        if (!next) {
          if (pacer.current) clearInterval(pacer.current);
          pacer.current = null;
          return;
        }
        apply(next);
      }, PACE_MS);
    },
    [apply],
  );

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase("running");
    setFailure(null);

    let attempt = 0;
    while (!ctl.signal.aborted) {
      let finished = false;
      try {
        // Re-POSTing joins the inspection that is already running, or returns the cached one.
        const res = await fetch(`/api/rentals/${id}/inspection`, { method: "POST", signal: ctl.signal, headers: renterHeaders(id) });
        if (!res.ok || !res.body) {
          setFailure(await readError(res, "The inspection couldn't start."));
          setPhase("failed");
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let cut: number;
          while ((cut = buf.search(/\r?\n\r?\n/)) !== -1) {
            const block = buf.slice(0, cut);
            buf = buf.slice(cut).replace(/^\r?\n\r?\n/, "");
            const dataLines = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
            if (!dataLines.length) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(dataLines.join("\n")) as StreamEvent;
            } catch {
              continue;
            }
            push(ev);
            if (ev.type === "done") {
              finished = true;
              return;
            }
            if (ev.type === "error") return;
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (attempt >= MAX_RECONNECTS) {
          setFailure(NETWORK_MESSAGE + " The inspection keeps running on the server, so retrying will pick it back up.");
          setPhase("failed");
          return;
        }
      }
      if (finished) return;
      attempt += 1;
      if (attempt > MAX_RECONNECTS) {
        setFailure("The live feed kept dropping. The inspection may still be running; retry to pick it back up.");
        setPhase("failed");
        return;
      }
      add({ key: `n:${attempt}`, kind: "note", text: `Connection dropped. Reconnecting (try ${attempt} of ${MAX_RECONNECTS}).` });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }, [id, add, push]);

  const started = useRef(false);
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [data, run]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      started.current = false;
      if (pacer.current) clearInterval(pacer.current);
      pacer.current = null;
      queue.current = [];
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  if (redirecting) return <Shell id={id} step="inspection"><RedirectBlock /></Shell>;
  if (loading) return <Shell id={id} step="inspection"><LoadingBlock /></Shell>;
  if (error || !data) return <Shell id={id} step="inspection"><ErrorBlock message={error ?? "Nothing came back."} onRetry={reload} /></Shell>;

  const findings = entries.filter((e) => e.kind === "finding");

  return (
    <Shell id={id} rental={data.rental} step="inspection" wide>
      <ItemHead rental={data.rental} kicker="Inspection report" />
      {renterToken === null ? <NoRenterTokenNotice /> : null}
      <p className="mb-4">
        The AI is comparing your pickup and return photos, one angle at a time. It only describes what it sees. Prices come later, from fixed rules.
      </p>

      <LightTable rentalId={id} photos={data.photos} entries={entries} phase={phase} />

      {phase === "done" ? (
        <div className="mt-5" role="status">
          <p className="mb-3">
            Inspection filed with {findings.length} {findings.length === 1 ? "finding" : "findings"}. Opening the verdict...
          </p>
          <Link href={`/r/${id}/verdict`} className="inline-flex min-h-12 w-full items-center justify-center border-2 border-ink bg-ink px-5 font-mono font-bold text-paper">
            See the verdict now
          </Link>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div role="alert" className="mt-5 border-2 border-stamp bg-stamp-wash p-4">
          <h2 className="text-3xl text-stamp">The inspection stopped</h2>
          <p className="mt-1">{failure}</p>
          <p className="mt-1 text-sm">Your photos are safe and no money has moved.</p>
          <Button className="mt-3" onClick={() => void run()}>
            Retry inspection
          </Button>
        </div>
      ) : null}
    </Shell>
  );
}
