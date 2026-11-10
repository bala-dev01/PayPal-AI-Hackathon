"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Finding, Inspection, Photo, PricingResult, Region, Rental, RentalEvent } from "@/lib/types";
import { ANGLES } from "@/lib/types";
import { groupFindings, type DamageGroup } from "@/lib/damage-groups";
import { Button, Money, Stamp, StatusBadge, TagLabel, Ticket } from "@/components/ui";
import { DisputeBanner } from "@/components/verdict/DisputeBanner";
import type { PayPalDispute } from "@/lib/dispute";
import { RetrySettlement } from "@/components/verdict/RetrySettlement";
import { readOwnerToken } from "./owner-token";
import styles from "./owner-rental.module.css";

interface Payload {
  rental: Rental;
  photos: Photo[];
  inspection: Inspection | null;
  settlement: (PricingResult & { captureTotalCents?: number; feeCents?: number }) | null;
  settlementAuthority?: "renter" | "owner" | null;
  events: RentalEvent[];
  paypalDispute?: PayPalDispute | null;
  resolutionCenterUrl?: string;
}

const CLASS_LABEL: Record<Finding["classification"], string> = {
  new_damage: "New damage",
  pre_existing: "Pre-existing",
  normal_wear: "Normal wear",
  uncertain: "Uncertain",
};

const POLL_STATUSES = new Set(["inspecting", "settling", "returned"]);

export function OwnerRental({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => setToken(readOwnerToken(id)), [id]);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setError(null);
      try {
        const res = await fetch(`/api/rentals/${id}`, { cache: "no-store" });
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
        setData(body as Payload);
      } catch (e) {
        if (!quiet) setError(e instanceof Error ? e.message : "The rental could not be loaded.");
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const status = data?.rental.status;
  useEffect(() => {
    if (!status || !POLL_STATUSES.has(status)) return;
    const t = setInterval(() => void load(true), 5000);
    return () => clearInterval(t);
  }, [status, load]);

  if (notFound)
    return (
      <div className="ticket p-6">
        <h1 className="text-4xl">No rental with this tag number</h1>
        <p className="mt-2 text-ink-soft">The link may be mistyped, or the rental was removed.</p>
        <Link href="/owner" className="mt-4 inline-block font-mono font-bold underline">
          Back to the ledger
        </Link>
      </div>
    );
  if (error)
    return (
      <div role="alert" className="ticket p-6">
        <h1 className="text-4xl">The rental did not load</h1>
        <p className="mt-2 text-ink-soft">{error}</p>
        <Button className="mt-4" onClick={() => load()}>
          Try again
        </Button>
      </div>
    );
  if (!data)
    return (
      <p role="status" className="ticket p-6 font-mono text-ink-soft">
        Loading the rental...
      </p>
    );

  return <Loaded data={data} token={token ?? null} reload={() => load(true)} />;
}

function Loaded({ data, token, reload }: { data: Payload; token: string | null; reload: () => Promise<void> }) {
  const { rental, photos, inspection, settlement, events, settlementAuthority, paypalDispute } = data;
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const pickupFront = photos.find((p) => p.phase === "pickup" && p.angle === "front") ?? null;
  const groups = useMemo(
    () => (inspection ? groupFindings(inspection.findings, settlement?.lines ?? []) : []),
    [inspection, settlement],
  );

  const renterLink = `${origin}/r/${rental.id}`;
  const contested = rental.status === "contested";
  const canApprove = contested && Boolean(token);
  // Dropping a damage drops every view of it, so a group is removed when any of its ids is excluded.
  const remaining = settlement
    ? groups.filter((g) => !g.ids.some((i) => excluded.has(i))).reduce((s, g) => s + g.amountCents, 0)
    : 0;
  const removed = settlement ? settlement.damageCents - Math.min(remaining, settlement.damageCents) : 0;

  async function approve() {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/rentals/${rental.id}/settlement/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-owner-token": token },
        body: JSON.stringify({ excludeFindingIds: [...excluded] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      setConfirming(false);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "The settlement could not be approved.");
      // The rental may now be failed; reload so the retry action appears.
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!token) return;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      const res = await fetch(`/api/rentals/${rental.id}/release`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-owner-token": token },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      setConfirmRelease(false);
      await reload();
    } catch (e) {
      setReleaseError(e instanceof Error ? e.message : "The hold could not be released.");
      await reload();
    } finally {
      setReleaseBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(renterLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* link is visible below for manual copy */
    }
  }

  const stamp =
    rental.status === "settled"
      ? rental.captured_cents > 0
        ? { tone: "damage" as const, text: "Captured" }
        : { tone: "clear" as const, text: "All clear" }
      : rental.status === "contested"
        ? { tone: "damage" as const, text: "Contested" }
        : rental.status === "failed"
          ? { tone: "damage" as const, text: "Failed" }
          : rental.status === "released"
            ? { tone: "clear" as const, text: "Hold released" }
            : null;

  return (
    <div className="space-y-8">
      <Link href="/owner" className="inline-flex min-h-11 items-center font-mono text-[0.9rem] font-bold underline">
        Back to the ledger
      </Link>

      <Ticket
        stub={
          <div className="space-y-5">
            <HoldBar rental={rental} settlement={settlement} />
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fig label="Authorized" cents={rental.authorized_cents} currency={rental.currency} />
              <Fig label="Captured" cents={rental.captured_cents} currency={rental.currency} tone="damage" />
              <Fig label="Released" cents={rental.released_cents} currency={rental.currency} tone="clear" />
              <Fig label="Deposit" cents={rental.deposit_cents} currency={rental.currency} />
            </dl>
          </div>
        }
      >
        <div className={`${styles.head} ${pickupFront ? styles.withPhoto : ""}`}>
          {pickupFront ? (
            <div className={styles.photo}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/rentals/${rental.id}/photos/${pickupFront.id}`} alt={`Pickup photo of ${rental.item_name}`} />
              <span className={styles.photoCap}>Pickup, front</span>
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <TagLabel>Tag no. {rental.id.slice(0, 8)}</TagLabel>
                <h1 className="mt-1 text-5xl sm:text-6xl">{rental.item_name}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <StatusBadge status={rental.status} />
                  <TagLabel>
                    {rental.category}, {rental.days} {rental.days === 1 ? "day" : "days"}
                  </TagLabel>
                  {rental.is_sample ? (
                    <span className="border-2 border-stamp px-1.5 font-mono text-[0.8rem] font-bold text-stamp">
                      Sample rental only
                    </span>
                  ) : null}
                </div>
              </div>
              {stamp ? (
                <Stamp tone={stamp.tone} press>
                  {stamp.text}
                </Stamp>
              ) : null}
            </div>
            {rental.item_description ? <p className="mt-4 max-w-[60ch] text-ink-soft">{rental.item_description}</p> : null}
          </div>
        </div>
      </Ticket>

      {paypalDispute ? (
        <DisputeBanner
          dispute={paypalDispute}
          audience="owner"
          rentalId={rental.id}
          resolutionUrl={data.resolutionCenterUrl ?? "https://www.paypal.com/resolutioncenter"}
        />
      ) : null}

      <section aria-labelledby="renter-link-h" className="border-2 border-dashed border-rule bg-card/60 p-4 sm:p-5">
        <h2 id="renter-link-h" className="text-3xl">
          Renter link
        </h2>
        <p className="mt-1 text-sm text-ink-soft">The renter authorizes the hold and takes photos here.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            readOnly
            aria-label="Renter link"
            value={renterLink}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-12 min-w-0 flex-1 rounded-[3px] border-2 border-ink bg-card px-3 font-mono text-sm"
          />
          <Button variant="ghost" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </section>

      {(rental.status === "held" || rental.status === "picked_up" || rental.status === "returned") && !rental.is_sample ? (
        <section aria-labelledby="release-h" className={`${styles.desk} ${styles.deskDanger}`}>
          <div className={styles.deskStrip} aria-hidden="true" />
          <div className={styles.deskBody}>
          <h2 id="release-h" className="text-3xl">
            Release the hold
          </h2>
          <p className="mt-1 max-w-[64ch] text-sm text-ink-soft">
            Use this if the renter lost access to their link or the rental will not go ahead. It gives the whole hold back
            and ends the rental. It can never take money.
          </p>
          {!token ? (
            <p role="status" className="mt-3 border-2 border-dashed border-amber bg-amber-wash p-3 text-amber">
              This browser does not hold the owner key for this rental. Open it in the browser where you created it.
            </p>
          ) : !confirmRelease ? (
            <Button variant="ghost" className="mt-3" onClick={() => setConfirmRelease(true)}>
              Release the renter&rsquo;s hold
            </Button>
          ) : (
            <div className="ticket mt-3 p-4" role="group" aria-label="Confirm release">
              <p className="font-bold">
                This releases the renter&rsquo;s full hold of <Money cents={rental.authorized_cents} currency={rental.currency} size="sm" />.
                Nothing is charged, including the rental fee. The rental ends and cannot be restarted.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button onClick={release} disabled={releaseBusy}>
                  {releaseBusy ? "Releasing..." : "Release the full hold"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmRelease(false)} disabled={releaseBusy}>
                  Go back
                </Button>
              </div>
            </div>
          )}
          {releaseError ? (
            <p role="alert" className="mt-3 border-2 border-stamp bg-stamp-wash px-4 py-3 text-stamp">
              {releaseError}
            </p>
          ) : null}
          </div>
        </section>
      ) : null}

      {rental.status === "released" ? (
        <section className={`${styles.desk} ${styles.deskClear}`} aria-labelledby="released-h">
          <div className={styles.deskStrip} aria-hidden="true" />
          <div className={styles.deskBody}>
          <h2 id="released-h" className="text-3xl">
            Hold released
          </h2>
          <p className="mt-2">The renter&rsquo;s full hold was released through PayPal. Nothing was charged.</p>
          </div>
        </section>
      ) : null}

      {rental.status === "failed" ? (
        settlementAuthority === "owner" ? (
          <RetrySettlement
            rentalId={rental.id}
            who="owner"
            headers={token ? { "x-owner-token": token } : {}}
            blockedMessage={
              token
                ? null
                : "This browser does not hold the owner key for this rental. Open it in the browser where you created it to retry."
            }
            onDone={() => void reload()}
          />
        ) : (
          <section aria-labelledby="failed-h" className="ticket border-stamp p-5">
            <Stamp tone="damage" press tilt={-4} className="mb-3 text-2xl">
              SETTLEMENT STOPPED
            </Stamp>
            <h2 id="failed-h" className="text-3xl">
              PayPal could not finish settling this rental
            </h2>
            <p className="mt-2">
              {settlementAuthority === "renter"
                ? "The renter accepted the verdict, so the renter retries it from their link."
                : "It can be retried by whoever started it."}{" "}
              A retry reuses the same PayPal request, so no money is captured twice.
            </p>
          </section>
        )
      ) : null}

      {contested ? (
        <section aria-labelledby="contest-h" className={`${styles.desk} ${styles.deskDanger}`}>
          <div className={styles.deskStrip} aria-hidden="true" />
          <div className={styles.deskBody}>
          <h2 id="contest-h" className="text-4xl">
            The renter contested this verdict
          </h2>
          <TagLabel className="mt-3 block">Renter&rsquo;s note</TagLabel>
          <blockquote className="mt-1 whitespace-pre-wrap border-l-4 border-stamp pl-4 text-lg">
            {rental.renter_note || "No note was left."}
          </blockquote>
          {!token ? (
            <p role="status" className="mt-5 border-2 border-dashed border-amber bg-amber-wash p-3 text-amber">
              This browser does not hold the owner key for this rental, so you cannot approve it here. Open the rental
              in the browser where you created it. The key is never in the renter link.
            </p>
          ) : (
            <>
              <p className="mt-5 text-ink-soft">
                Review the findings below. Tick any you want to drop from the charge. You can only lower the amount.
              </p>
              <p className="mt-3 max-w-[64ch] border-l-4 border-ink pl-3 text-[0.95rem]">
                Approving captures the money from the renter&rsquo;s hold. Removing a damage lowers the charge. Your decision here
                is final inside Handback, but after the capture the renter can still open a dispute with PayPal, and PayPal decides it.
              </p>
            </>
          )}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="findings-h">
        <h2 id="findings-h" className="text-4xl sm:text-5xl">
          Findings
        </h2>
        {!inspection ? (
          <p className="mt-3 text-ink-soft">
            {rental.status === "inspecting"
              ? "The agent is comparing the photos now. This page updates by itself."
              : "No inspection yet. It starts after the renter returns the item and takes the return photos."}
          </p>
        ) : (
          <>
            <p className="mt-3 max-w-[64ch] text-ink-soft">{inspection.summary}</p>
            {inspection.findings.length === 0 ? (
              <p className="mt-4 font-mono font-bold text-clear">No differences found between pickup and return.</p>
            ) : (
              <ul className="mt-5 space-y-4">
                {groups.map((g) => (
                  <FindingRow
                    key={g.key}
                    g={g}
                    shot={returnShot(g, photos)}
                    rentalId={rental.id}
                    currency={rental.currency}
                    selectable={canApprove && Boolean(g.line?.chargeable)}
                    excluded={g.ids.some((i) => excluded.has(i))}
                    toggle={() =>
                      setExcluded((p) => {
                        const n = new Set(p);
                        if (g.ids.some((i) => n.has(i))) g.ids.forEach((i) => n.delete(i));
                        else g.ids.forEach((i) => n.add(i));
                        return n;
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {settlement ? (
          <div className="mt-6 ticket p-5">
            <h3 className="text-3xl">Settlement</h3>
            <div className="mt-3">
              <HoldBar rental={rental} settlement={settlement} compact />
            </div>
            <dl className="mt-3 grid gap-x-8 gap-y-2 font-mono sm:grid-cols-2">
              <Row label="Value used for pricing" cents={settlement.baseValueCents} currency={rental.currency} />
              <Row label="Damage" cents={settlement.damageCents} currency={rental.currency} tone="damage" />
              <Row label="Taken from deposit" cents={settlement.depositCapturedCents} currency={rental.currency} />
              <Row label="Released to renter" cents={settlement.depositReleasedCents} currency={rental.currency} tone="clear" />
              <Row label="Invoiced above the hold" cents={settlement.overageCents} currency={rental.currency} />
              {typeof settlement.captureTotalCents === "number" ? (
                <Row label="Total to capture, rental fee included" cents={settlement.captureTotalCents} currency={rental.currency} />
              ) : null}
            </dl>
            {canApprove && excluded.size > 0 ? (
              <p className="mt-3 font-mono text-sm text-clear">
                Dropping {groups.filter((g) => g.ids.some((i) => excluded.has(i))).length} of these lowers the damage by about{" "}
                <Money cents={removed} size="sm" tone="clear" />. The server recalculates the exact amount.
              </p>
            ) : null}
          </div>
        ) : null}

        {canApprove ? (
          <div className="mt-6">
            {actionError ? (
              <p role="alert" className="mb-3 border-2 border-stamp bg-stamp-wash px-4 py-3 text-stamp">
                {actionError}
              </p>
            ) : null}
            {!confirming ? (
              <Button variant="money" onClick={() => setConfirming(true)}>
                Approve settlement
              </Button>
            ) : (
              <div className="ticket p-4" role="group" aria-label="Confirm approval">
                <p className="font-bold">
                  This captures the agreed amount from the renter&rsquo;s PayPal hold and releases the rest. It cannot be
                  undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button variant="money" onClick={approve} disabled={busy}>
                    {busy ? "Settling..." : "Capture and release"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                    Go back
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>

      <PhotoSection photos={photos} rentalId={rental.id} />

      <section aria-labelledby="timeline-h">
        <h2 id="timeline-h" className="text-4xl sm:text-5xl">
          Timeline
        </h2>
        {events.length === 0 ? (
          <p className="mt-3 text-ink-soft">Nothing has happened yet.</p>
        ) : (
          <ol className={styles.tl}>
            {events.map((ev, i) => (
              <li key={ev.id} className={styles.tlItem}>
                <span aria-hidden="true" className={`${styles.tlDot} ${i === events.length - 1 ? styles.tlDotKey : ""}`} />
                <div className="font-bold">{humanize(ev.type)}</div>
                <TagLabel>{new Date(ev.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</TagLabel>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function humanize(type: string) {
  const s = type.replace(/[._-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Fig({ label, cents, currency, tone = "ink" }: { label: string; cents: number; currency: string; tone?: "ink" | "damage" | "clear" }) {
  return (
    <div>
      <dt>
        <TagLabel>{label}</TagLabel>
      </dt>
      <dd>
        <Money cents={cents} currency={currency} tone={cents === 0 ? "muted" : tone} />
      </dd>
    </div>
  );
}

function Row({ label, cents, currency, tone = "ink" }: { label: string; cents: number; currency: string; tone?: "ink" | "damage" | "clear" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-rule py-1">
      <dt className="text-ink-soft">{label}</dt>
      <dd>
        <Money cents={cents} currency={currency} size="sm" tone={cents === 0 ? "muted" : tone} />
      </dd>
    </div>
  );
}

function FindingRow({
  g,
  shot,
  rentalId,
  currency,
  selectable,
  excluded,
  toggle,
}: {
  g: DamageGroup;
  shot: { photo: Photo; region: Region | null } | null;
  rentalId: string;
  currency: string;
  selectable: boolean;
  excluded: boolean;
  toggle: () => void;
}) {
  const f = g.primary;
  const line = g.line;
  const chargeable = line?.chargeable ?? false;
  const others = g.views.slice(1);
  return (
    <li className={`ticket p-4 sm:p-5 ${excluded ? "opacity-60" : ""}`}>
      <div className={`${styles.finding} ${shot ? styles.withShot : ""}`}>
        {shot ? (
          <div className={styles.shot}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/rentals/${rentalId}/photos/${shot.photo.id}`} alt={`Return photo, ${shot.photo.angle}`} loading="lazy" />
            {shot.region ? (
              <span
                className={`${styles.shotBox} ${chargeable ? "" : styles.shotBoxFree}`}
                style={{
                  left: `${shot.region.x * 100}%`,
                  top: `${shot.region.y * 100}%`,
                  width: `${shot.region.w * 100}%`,
                  height: `${shot.region.h * 100}%`,
                }}
                aria-hidden="true"
              />
            ) : null}
            <span className={styles.shotCap}>Return, {shot.photo.angle}</span>
          </div>
        ) : null}
        <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TagLabel>
            {f.angle}, {CLASS_LABEL[f.classification]}, {f.severity}, {Math.round(f.confidence * 100)}% sure
          </TagLabel>
          <h3 className={`mt-1 font-display text-3xl ${excluded ? "line-through" : ""}`}>{f.title}</h3>
          <p className="mt-1 text-ink-soft">{f.description}</p>
          {others.length > 0 ? (
            <p className="mt-2 font-mono text-[0.85rem] text-ink-soft">
              Seen from {g.views.length} angles: {g.views.map((v) => v.angle).join(", ")}. Charged once.
            </p>
          ) : null}
        </div>
        <div className="text-right">
          {line ? (
            chargeable ? (
              <Money cents={excluded ? 0 : line.amountCents} currency={currency} tone={excluded ? "muted" : "damage"} />
            ) : (
              <Money cents={0} currency={currency} tone="muted" />
            )
          ) : null}
          {line && !chargeable && line.reason ? <div className="font-mono text-[0.8rem] text-clear">{line.reason}</div> : null}
        </div>
      </div>
      {selectable ? (
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 border-t border-dashed border-rule pt-3 font-mono text-[0.9rem] font-bold">
          <input type="checkbox" checked={excluded} onChange={toggle} className="h-5 w-5 accent-[var(--ink)]" />
          Drop this damage from the charge
        </label>
      ) : null}
        </div>
      </div>
    </li>
  );
}

function PhotoSection({ photos, rentalId }: { photos: Photo[]; rentalId: string }) {
  const byKey = new Map(photos.map((p) => [`${p.phase}:${p.angle}`, p]));
  return (
    <section aria-labelledby="photos-h">
      <h2 id="photos-h" className="text-4xl sm:text-5xl">
        Photos
      </h2>
      {photos.length === 0 ? (
        <p className="mt-3 text-ink-soft">No photos yet. The renter takes them from the renter link.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {ANGLES.map((angle) => {
            const pair = (["pickup", "return"] as const).map((phase) => byKey.get(`${phase}:${angle}`));
            if (!pair[0] && !pair[1]) return null;
            return (
              <div key={angle} className="grid grid-cols-2 gap-3">
                {pair.map((p, i) => (
                  <figure key={i} className="min-w-0">
                    {p ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/rentals/${rentalId}/photos/${p.id}`}
                        alt={`${i === 0 ? "Pickup" : "Return"} photo, ${angle}`}
                        loading="lazy"
                        className="aspect-[4/3] w-full border-2 border-ink bg-paper-deep object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center border-2 border-dashed border-rule text-sm text-ink-soft">
                        Not taken yet
                      </div>
                    )}
                    <figcaption className="mt-1 font-mono text-[0.8rem] text-ink-soft">
                      {i === 0 ? "Pickup" : "Return"}, {angle}
                    </figcaption>
                  </figure>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function returnShot(g: DamageGroup, photos: Photo[]): { photo: Photo; region: Region | null } | null {
  const f = g.primary;
  const photo = photos.find((p) => p.phase === "return" && p.angle === f.angle);
  return photo ? { photo, region: f.region_after } : null;
}

const money0 = (c: number) =>
  "$" + (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: c % 100 === 0 ? 0 : 2 });

function inspectionDone(status: Rental["status"]) {
  return status === "verdict_ready" || status === "contested" || status === "settling" || status === "failed";
}

/** The hold drawn once: fee, damage and what goes back. Before settlement it is the proposed split. */
function HoldBar({
  rental,
  settlement,
  compact = false,
}: {
  rental: Rental;
  settlement: Payload["settlement"];
  compact?: boolean;
}) {
  const fee = settlement?.feeCents ?? rental.daily_rate_cents * rental.days;
  const held = rental.authorized_cents;
  const settled = rental.captured_cents > 0 || rental.released_cents > 0;

  let parts: { cls: string | undefined; label: string; cents: number }[] = [];
  let caption = "";
  if (held === 0) {
    return (
      <div className={styles.holdWrap}>
        <div className={styles.holdTop}>
          <span>No hold yet. The renter places it from their link.</span>
          <span>
            Planned <b>{money0(fee + rental.deposit_cents)}</b>
          </span>
        </div>
        <div className={`${styles.track} ${styles.trackNone}`} aria-hidden="true" />
      </div>
    );
  }
  if (settled) {
    const feePart = Math.min(fee, rental.captured_cents);
    parts = [
      { cls: styles.segFee, label: "Rental fee", cents: feePart },
      { cls: styles.segDmg, label: "Damage captured", cents: Math.max(0, rental.captured_cents - feePart) },
      { cls: styles.segRel, label: "Released", cents: rental.released_cents },
    ];
    caption = "Where the hold went";
  } else if (settlement && inspectionDone(rental.status)) {
    parts = [
      { cls: styles.segFee, label: "Rental fee", cents: fee },
      { cls: styles.segDmg, label: "Damage to capture", cents: settlement.depositCapturedCents },
      { cls: styles.segRel, label: "To release", cents: settlement.depositReleasedCents },
    ];
    caption = "Proposed split of the hold";
  } else {
    parts = [{ cls: styles.segHeld, label: "Held, nothing charged", cents: held }];
    caption = "On hold, nothing charged";
  }
  const total = Math.max(held, parts.reduce((sum, p) => sum + p.cents, 0), 1);
  const shown = parts.filter((p) => p.cents > 0);
  return (
    <div className={styles.holdWrap}>
      {compact ? null : (
        <div className={styles.holdTop}>
          <span>{caption}</span>
          <span>
            Hold <b>{money0(held)}</b>
          </span>
        </div>
      )}
      <div
        className={styles.track}
        role="img"
        aria-label={`${caption}: ${shown.map((p) => `${p.label} ${money0(p.cents)}`).join(", ")}`}
        style={compact ? { height: "1.4rem" } : undefined}
      >
        {shown.map((p) => (
          <span key={p.label} className={`${styles.seg} ${p.cls}`} style={{ width: `${(p.cents / total) * 100}%` }} />
        ))}
      </div>
      <div className={styles.key} aria-hidden="true">
        {shown.map((p) => (
          <span key={p.label}>
            <i className={p.cls} />
            {p.label} <b>{money0(p.cents)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
