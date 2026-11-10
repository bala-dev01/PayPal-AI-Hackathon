"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Money, Stamp, Ticket } from "@/components/ui";
import { ErrorBlock, ItemHead, LoadingBlock, RedirectBlock, Shell } from "../_components/shell";
import { postJson, useRental } from "../_lib/rental";
import { saveRenterToken } from "../_lib/renter-token";
import type { Rental } from "@/lib/types";

/* Minimal typing for the PayPal JS SDK v5 buttons we use. */
interface PayPalButtons {
  render: (el: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
}
interface PayPalNamespace {
  Buttons: (opts: Record<string, unknown>) => PayPalButtons;
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

type Config = { clientId?: string | null; environment?: string } | null;

export default function HoldPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, redirecting, reload, setData } = useRental(id, ["draft"]);
  const [placed, setPlaced] = useState<Rental | null>(null);
  const [stored, setStored] = useState(true);

  const onAuthorized = useCallback(
    (r: Rental, savedDurably: boolean) => {
      setPlaced(r);
      setStored(savedDurably);
      setData((d) => (d ? { ...d, rental: r } : d));
      window.scrollTo({ top: 0 });
    },
    [setData],
  );

  if (redirecting) return <Shell id={id} step="hold"><RedirectBlock /></Shell>;
  if (loading) return <Shell id={id} step="hold"><LoadingBlock /></Shell>;
  if (error || !data) return <Shell id={id} step="hold"><ErrorBlock message={error ?? "Nothing came back."} onRetry={reload} /></Shell>;

  const rental = placed ?? data.rental;

  return (
    <Shell id={id} rental={rental} step="hold">
      <ItemHead rental={rental} kicker="Rental terms, in plain language" />
      {rental.is_sample ? (
        <p className="mb-4 border-l-4 border-amber bg-amber-wash px-3 py-2 text-[0.95rem]">
          This is a sample rental, and it is view-only. No hold can be placed on it. To try the whole flow, create your own rental from the owner page.
        </p>
      ) : null}

      {rental.is_sample ? (
        <Link href="/owner/new" className="inline-flex min-h-12 items-center border-2 border-ink bg-ink px-5 font-mono font-bold text-paper">
          Create a rental
        </Link>
      ) : placed ? (
        <HoldPlaced rental={placed} id={id} stored={stored} />
      ) : (
        <>
          <Terms rental={rental} holdAmount={data.holdAmount} />
          <PayBlock rental={rental} onAuthorized={onAuthorized} />
        </>
      )}
    </Shell>
  );
}

function Terms({ rental, holdAmount }: { rental: Rental; holdAmount?: number }) {
  // Pre-authorization display of the two stored terms; the amount actually held comes back from PayPal via the API.
  const fee = rental.daily_rate_cents * rental.days;
  const hold = typeof holdAmount === "number" ? holdAmount : fee + rental.deposit_cents;
  const cur = rental.currency;
  return (
    <>
      <Ticket
        className="mb-6"
        stub={
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[0.8125rem] text-ink-soft">PayPal will reserve</p>
              <p className="text-sm text-ink-soft">Nothing is charged today</p>
            </div>
            <Money cents={hold} currency={cur} size="lg" />
          </div>
        }
      >
        <p className="mb-3 font-mono text-[0.8125rem] text-ink-soft">What the hold is made of</p>
        <div className="hb-bar mb-4" role="img" aria-label={`Rental fee ${(fee / 100).toFixed(2)} ${cur} and refundable deposit ${(rental.deposit_cents / 100).toFixed(2)} ${cur}`} style={{ height: "2.5rem" }}>
          <div className="hb-seg hb-seg-fee" style={{ width: `${(fee / (fee + rental.deposit_cents || 1)) * 100}%` }} />
          <div className="hb-seg hb-seg-release" style={{ width: `${(rental.deposit_cents / (fee + rental.deposit_cents || 1)) * 100}%`, ["--d" as string]: "250ms" }} />
        </div>
        <dl className="space-y-2">
          <Row swatch="var(--seg-fee)" label={`Rental fee, ${rental.days} ${rental.days === 1 ? "day" : "days"} at`} rate={rental.daily_rate_cents} cents={fee} cur={cur} />
          <Row swatch="var(--seg-release)" label="Refundable deposit" cents={rental.deposit_cents} cur={cur} />
        </dl>
      </Ticket>

      <section aria-labelledby="flow" className="mb-8">
        <h2 id="flow" className="text-3xl">Where the hold can go</h2>
        <p className="mb-4 text-ink-soft">The hold is split three ways at the end. You see the split before anything moves.</p>
        <div className="relative ml-1 border-l-2 border-dashed border-ink pl-6">
          {[
            { sw: "var(--seg-fee)", t: "Rental fee", amt: <Money cents={fee} currency={cur} size="sm" />, d: "Captured when the rental settles." },
            { sw: "var(--seg-damage)", t: "Damage, if there is any", amt: <>up to <Money cents={rental.deposit_cents} currency={cur} size="sm" tone="damage" /></>, d: "Taken from the deposit, and only after you accept or the owner approves." },
            { sw: "var(--seg-release)", t: "The rest of the deposit", amt: <Money cents={rental.deposit_cents} currency={cur} size="sm" tone="clear" />, d: "Released back to you, minus any damage." },
          ].map((o) => (
            <div key={o.t} className="relative pb-4 last:pb-0">
              <span aria-hidden="true" className="absolute -left-6 top-3 h-0.5 w-5 bg-ink" />
              <span aria-hidden="true" className="absolute -left-[1.1rem] top-[0.45rem] h-3 w-3 rotate-45 border-2 border-ink bg-card" />
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex items-center gap-2 font-bold">
                  <span aria-hidden="true" className="inline-block h-3.5 w-3.5 border-2 border-ink" style={{ background: o.sw }} />
                  {o.t}
                </p>
                <span className="font-mono text-sm">{o.amt}</span>
              </div>
              <p className="text-[0.95rem] text-ink-soft">{o.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-l-4 border-stamp bg-stamp-wash px-3 py-2 text-[0.95rem]">
          Damage beyond the deposit is never taken from the hold. It would come as a separate PayPal invoice.
        </p>
      </section>

      <section aria-labelledby="happens" className="mb-8">
        <h2 id="happens" className="text-3xl">What happens to the hold</h2>
        <ol className="mt-3 border-l-2 border-ink">
          {[
            ["Today", "PayPal reserves the amount above. It is a hold and nothing is paid yet. Your money stays yours until you accept a verdict."],
            ["Pickup and return", "You photograph the item from six angles at pickup and again when you give it back. Return photos are lined up over the pickup ones."],
            ["After return", "An AI compares the photos. It only reports what it sees, and fixed rules turn that into a price. You see every finding before anything is taken."],
          ].map(([t, d], i) => (
            <li key={t} className="relative pb-4 pl-6 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[0.8rem] top-0 grid h-6 w-6 place-items-center rounded-full border-2 border-ink bg-card font-mono text-[0.75rem] font-bold">{i + 1}</span>
              <p><strong className="font-semibold">{t}.</strong> {d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="fair" className="mb-8 border-2 border-ink bg-card p-4 shadow-[4px_4px_0_var(--ink)]">
        <h2 id="fair" className="text-3xl">Rules that protect you</h2>
        <h3 className="mt-3 font-mono text-[0.9rem] font-bold" style={{ fontFamily: "var(--font-typewriter-face), monospace", letterSpacing: 0, lineHeight: 1.3 }}>These cost you nothing</h3>
        <ul className="mt-1 space-y-1.5">
          {[
            "Damage that was already there at pickup costs nothing.",
            "Normal wear costs nothing.",
            "If the AI is less than 75% sure, it costs nothing.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-[0.45rem] h-3 w-3 shrink-0 border-2 border-clear bg-clear-wash" />
              {t}
            </li>
          ))}
        </ul>
        <h3 className="mt-4 font-mono text-[0.9rem] font-bold" style={{ fontFamily: "var(--font-typewriter-face), monospace", letterSpacing: 0, lineHeight: 1.3 }}>How the money moves</h3>
        <ul className="mt-1 space-y-1.5">
          {[
            "Nothing is captured until you accept, or the owner approves after you contest. The owner can only lower a charge.",
            "The hold covers the rental fee and the deposit. The rental fee is captured when the rental settles, and any unused deposit is released back to you.",
            "If inspected damage is more than the deposit, you will be invoiced for the difference. You can contest the findings before anything is charged.",
            "PayPal honors a hold for 3 days and keeps it valid for up to 29. Only the first 3 days are guaranteed, which is why rentals are capped at 3 days.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-[0.45rem] h-3 w-3 shrink-0 border-2 border-ink bg-paper-deep" />
              {t}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Row({ label, rate, cents, cur, swatch }: { label: string; rate?: number; cents: number; cur: string; swatch?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule pb-2">
      <dt className="flex items-baseline gap-2">
        {swatch ? <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 translate-y-0.5 border-2 border-ink" style={{ background: swatch }} /> : null}
        <span>
          {label}
          {rate !== undefined ? <> <Money cents={rate} currency={cur} size="sm" />/day</> : null}
        </span>
      </dt>
      <dd><Money cents={cents} currency={cur} /></dd>
    </div>
  );
}

function HoldPlaced({ rental, id, stored }: { rental: Rental; id: string; stored: boolean }) {
  return (
    <Ticket
      stub={
        <Link
          href={`/r/${id}/pickup`}
          className="inline-flex min-h-12 w-full items-center justify-center border-2 border-ink bg-ink px-5 font-mono font-bold text-paper shadow-[3px_3px_0_var(--rule)]"
        >
          Start pickup photos
        </Link>
      }
    >
      <Stamp tone="clear" press tilt={-5} className="mb-3 text-2xl">HOLD PLACED</Stamp>
      <p>
        PayPal is holding <Money cents={rental.authorized_cents} currency={rental.currency} /> for this rental. Nothing has been charged.
      </p>
      <p className="mt-2 text-ink-soft">Next, photograph the item at pickup so both of you have the same record.</p>
      <p role="note" className="mt-3 border-l-4 border-amber bg-amber-wash px-3 py-2 font-bold">
        Continue this rental in this browser, on this device. Your key to it is saved here and nowhere else. If you clear
        this browser's site data or switch devices, you will not be able to pick up where you left off, and the owner
        would have to release your hold.
      </p>
      {!stored ? (
        <p role="alert" className="mt-3 border-2 border-stamp bg-stamp-wash px-3 py-2">
          This browser would not save your key (private browsing or blocked site data). It works only while you keep this
          tab open and do not reload it. If you close it, tell the owner: they can release your whole hold and nothing
          will be charged.
        </p>
      ) : null}
    </Ticket>
  );
}

function PayBlock({ rental, onAuthorized }: { rental: Rental; onAuthorized: (r: Rental, savedDurably: boolean) => void }) {
  const [config, setConfig] = useState<Config | "loading" | "failed">("loading");
  const [sdk, setSdk] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [agreed, setAgreed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const agreedRef = useRef(false);
  const mount = useRef<HTMLDivElement>(null);
  /** The one-time hold nonce, kept in memory only between creating the order and authorizing it. */
  const nonceRef = useRef<string | null>(null);
  const rentalId = rental.id;
  const currency = rental.currency;

  useEffect(() => {
    agreedRef.current = agreed;
  }, [agreed]);

  useEffect(() => {
    let live = true;
    fetch("/api/paypal/config")
      .then(async (r) => {
        if (r.ok) return (await r.json()) as Config;
        // 503 means the server has no PayPal credentials; show the not-configured state, not a network error.
        if (r.status === 503) return { clientId: null };
        throw new Error("config");
      })
      .then((c: Config) => live && setConfig(c))
      .catch(() => live && setConfig("failed"));
    return () => {
      live = false;
    };
  }, []);

  const clientId = typeof config === "object" && config ? config.clientId : null;

  useEffect(() => {
    if (!clientId) return;
    if (window.paypal) {
      setSdk("ready");
      return;
    }
    setSdk("loading");
    const existing = document.getElementById("paypal-sdk") as HTMLScriptElement | null;
    const s = existing ?? document.createElement("script");
    // SDK v5 with intent=authorize: v6 could not be verified here, so we use the stable v5 buttons.
    s.id = "paypal-sdk";
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&commit=false&currency=${encodeURIComponent(currency)}&components=buttons`;
    s.async = true;
    s.addEventListener("load", () => setSdk("ready"));
    s.addEventListener("error", () => setSdk("failed"));
    if (!existing) document.head.appendChild(s);
  }, [clientId, currency]);

  useEffect(() => {
    if (sdk !== "ready" || !window.paypal || !mount.current) return;
    const el = mount.current;
    let buttons: PayPalButtons | null = window.paypal.Buttons({
      style: { layout: "vertical", color: "blue", shape: "rect", label: "paypal", height: 48 },
      onClick: (_d: unknown, actions: { resolve: () => Promise<void>; reject: () => Promise<void> }) => {
        if (!agreedRef.current) {
          setMsg("Tick the box to confirm you've read the terms, then press PayPal again.");
          return actions.reject();
        }
        setMsg(null);
        return actions.resolve();
      },
      createOrder: async () => {
        const { orderId, holdNonce } = await postJson<{ orderId: string; holdNonce: string }>(
          `/api/rentals/${rentalId}/hold/order`,
        );
        nonceRef.current = holdNonce;
        return orderId;
      },
      onApprove: async (d: { orderID: string }) => {
        setBusy(true);
        try {
          const { rental: r, renterToken } = await postJson<{ rental: Rental; renterToken?: string }>(
            `/api/rentals/${rentalId}/hold/authorize`,
            { orderId: d.orderID, holdNonce: nonceRef.current ?? "" },
          );
          nonceRef.current = null;
          const savedDurably = renterToken ? saveRenterToken(rentalId, renterToken) : false;
          onAuthorized(r, savedDurably);
        } catch (e) {
          setMsg((e as Error).message + " Your PayPal account was not charged.");
        } finally {
          setBusy(false);
        }
      },
      onCancel: () => setMsg("You closed PayPal before approving. Nothing was held. Press the button to try again."),
      onError: (e: unknown) =>
        setMsg(`PayPal reported a problem${e instanceof Error ? `: ${e.message}` : ""}. Nothing was charged. Try again.`),
    });
    void buttons.render(el).catch(() => setSdk("failed"));
    return () => {
      void buttons?.close().catch(() => {});
      buttons = null;
    };
  }, [sdk, rentalId, onAuthorized]);

  return (
    <section aria-labelledby="pay" className="ticket p-5">
      <h2 id="pay" className="text-3xl">Place the hold</h2>
      <label className="mt-3 flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 h-6 w-6 shrink-0 accent-[var(--ink)]"
        />
        <span>I've read the terms above. I understand this is a hold. The rental fee is captured at settlement, damage beyond the deposit is invoiced, and nothing is taken until I accept the verdict or the owner approves it.</span>
      </label>

      <div className="mt-4">
        {config === "loading" ? (
          <p role="status" className="font-mono text-sm text-ink-soft">Checking PayPal setup...</p>
        ) : config === "failed" ? (
          <p role="alert" className="border-2 border-stamp bg-stamp-wash p-3">
            We couldn't reach the PayPal setup. Reload the page; if it keeps happening, tell the owner.
          </p>
        ) : !clientId ? (
          <div role="alert" className="border-2 border-dashed border-ink p-4">
            <Stamp tone="ink" tilt={-3} className="mb-2">NOT CONFIGURED</Stamp>
            <p>
              PayPal isn't set up on this server yet, so a hold can't be placed. The owner needs to add the PayPal
              sandbox client ID and secret. Nothing has been charged.
            </p>
          </div>
        ) : sdk === "failed" ? (
          <p role="alert" className="border-2 border-stamp bg-stamp-wash p-3">
            The PayPal button didn't load. An ad blocker or a poor connection can cause this. Reload and try again.
          </p>
        ) : (
          <>
            {sdk !== "ready" ? <p role="status" className="font-mono text-sm text-ink-soft">Loading PayPal...</p> : null}
            <div ref={mount} className={agreed ? "" : "opacity-60"} />
            {config && typeof config === "object" && config.environment ? (
              <p className="mt-2 font-mono text-[0.8125rem] text-ink-soft">PayPal environment: {config.environment}</p>
            ) : null}
          </>
        )}
        {busy ? <p role="status" className="mt-3 font-mono text-sm">Confirming the hold with PayPal...</p> : null}
        {msg ? <p role="alert" className="mt-3 border-l-4 border-stamp bg-stamp-wash px-3 py-2">{msg}</p> : null}
      </div>
    </section>
  );
}
