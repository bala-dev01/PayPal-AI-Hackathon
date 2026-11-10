"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, Money, Stamp, TagLabel, Ticket } from "@/components/ui";
import { LinkButton } from "./link-button";
import { saveOwnerToken } from "./owner-token";

export const INPUT =
  "block w-full min-h-12 rounded-[3px] border-2 border-ink bg-card px-3 py-2 text-base text-ink placeholder:text-ink-soft";

const CATEGORIES = ["Cameras and video", "Power tools", "E-bikes and scooters", "Party and event gear", "Instruments", "Other"];

interface Values {
  itemName: string;
  itemDescription: string;
  category: string;
  dailyRate: string;
  days: string;
  deposit: string;
  replacement: string;
  replacementSource: string;
  purchaseYear: string;
}

type Errors = Partial<Record<keyof Values, string>>;

const empty: Values = {
  itemName: "",
  itemDescription: "",
  category: "",
  dailyRate: "",
  days: "",
  deposit: "",
  replacement: "",
  replacementSource: "",
  purchaseYear: "",
};

/** "12.50" -> 1250. Null when it is not a dollar amount with at most two decimals. */
function toCents(s: string): number | null {
  const t = s.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

function validate(v: Values): Errors {
  const e: Errors = {};
  const year = new Date().getFullYear();
  if (v.itemName.trim().length < 2) e.itemName = "Name the item, for example “Sony A7 camera body”.";
  else if (v.itemName.trim().length > 80) e.itemName = "Keep the name under 80 characters.";
  if (!v.category) e.category = "Choose the closest category.";
  const rate = toCents(v.dailyRate);
  if (v.dailyRate.trim() === "") e.dailyRate = "Enter the daily rate in dollars, for example 35.";
  else if (rate === null) e.dailyRate = "Use dollars with at most two decimals, for example 35 or 35.50.";
  else if (rate <= 0) e.dailyRate = "The daily rate must be more than $0.";
  const days = Number(v.days);
  if (v.days.trim() === "") e.days = "Enter how many days, from 1 to 3.";
  else if (!Number.isInteger(days) || days < 1 || days > 3) e.days = "Use a whole number of days from 1 to 3. A PayPal hold is only honored for 3 days.";
  const dep = toCents(v.deposit);
  if (v.deposit.trim() === "") e.deposit = "Enter the deposit in dollars.";
  else if (dep === null) e.deposit = "Use dollars with at most two decimals.";
  else if (dep <= 0) e.deposit = "The deposit must be more than $0, otherwise there is nothing to hold.";
  const rep = toCents(v.replacement);
  if (v.replacement.trim() === "") e.replacement = "Enter what the item costs to replace.";
  else if (rep === null) e.replacement = "Use dollars with at most two decimals.";
  else if (rep <= 0) e.replacement = "The replacement value must be more than $0.";
  else if (dep !== null && dep > rep) e.replacement = "The deposit cannot be higher than the replacement value.";
  if (v.purchaseYear.trim() !== "") {
    const py = Number(v.purchaseYear);
    if (!Number.isInteger(py) || py < 1980 || py > year) e.purchaseYear = `Use a four-digit year between 1980 and ${year}, or leave it empty.`;
  }
  return e;
}

export function NewRentalForm() {
  const [v, setV] = useState<Values>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ id: string } | null>(null);
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "none" | "found"; title?: string }>({
    state: "idle",
  });
  const [channel3Failed, setChannel3Failed] = useState(false);

  const set = (k: keyof Values) => (value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  async function findPrice() {
    const q = v.itemName.trim();
    if (q.length < 2) {
      setErrors((p) => ({ ...p, itemName: "Enter the item name first, then look up its price." }));
      return;
    }
    setLookup({ state: "loading" });
    try {
      const res = await fetch(`/api/replacement-price?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as { cents: number | null; source?: string; title?: string };
      if (typeof body.cents === "number") {
        setV((p) => ({
          ...p,
          replacement: (body.cents! / 100).toFixed(2),
          replacementSource: body.source ?? "Channel3",
        }));
        setErrors((p) => ({ ...p, replacement: undefined }));
        setLookup({ state: "found", title: body.title });
      } else {
        setLookup({ state: "none" });
        setChannel3Failed(true);
      }
    } catch {
      setLookup({ state: "none" });
      setChannel3Failed(true);
    }
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    const errs = validate(v);
    setErrors(errs);
    const firstBad = Object.keys(errs)[0];
    if (firstBad) {
      document.getElementById(`field-${firstBad}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/rentals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemName: v.itemName.trim(),
          itemDescription: v.itemDescription.trim(),
          category: v.category,
          dailyRateCents: toCents(v.dailyRate),
          days: Number(v.days),
          depositCents: toCents(v.deposit),
          replacementCents: toCents(v.replacement),
          replacementSource: v.replacementSource || "Owner estimate",
          purchaseYear: v.purchaseYear.trim() === "" ? null : Number(v.purchaseYear),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      saveOwnerToken(body.id, body.ownerToken);
      setCreated({ id: body.id });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "The rental could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) return <Created id={created.id} itemName={v.itemName.trim()} />;

  const rate = toCents(v.dailyRate);
  const dep = toCents(v.deposit);
  const days = Number(v.days);
  const holdCents =
    rate !== null && dep !== null && Number.isInteger(days) && days > 0 ? rate * days + dep : null;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-8">
      <fieldset className="ticket space-y-5 p-5 sm:p-6">
        <legend className="ml-2 bg-paper px-2 font-mono text-[0.9rem] font-bold">The item</legend>
        <Field id="itemName" label="Item name" error={errors.itemName}>
          {(p) => (
            <input {...p} type="text" value={v.itemName} onChange={(e) => set("itemName")(e.target.value)} maxLength={80} autoComplete="off" className={INPUT + ""} />
          )}
        </Field>
        <Field id="category" label="Category" error={errors.category}>
          {(p) => (
            <select {...p} value={v.category} onChange={(e) => set("category")(e.target.value)} className={INPUT + ""}>
              <option value="">Choose one</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <Field id="itemDescription" label="Condition and notes" hint="Optional. Serial number, accessories, existing marks." error={errors.itemDescription}>
          {(p) => (
            <textarea {...p} rows={3} value={v.itemDescription} onChange={(e) => set("itemDescription")(e.target.value)} className={INPUT + ""} />
          )}
        </Field>
      </fieldset>

      <fieldset className="ticket space-y-5 p-5 sm:p-6">
        <legend className="ml-2 bg-paper px-2 font-mono text-[0.9rem] font-bold">The terms</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="dailyRate" label="Daily rate (USD)" error={errors.dailyRate}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.dailyRate} onChange={(e) => set("dailyRate")(e.target.value)} className={INPUT + " font-mono"} />}
          </Field>
          <Field
            id="days"
            label="Days"
            hint="Maximum 3 days. PayPal honors a hold for 3 days and keeps it valid for up to 29, but only the first 3 days are guaranteed, so rentals are capped there."
            error={errors.days}
          >
            {(p) => <input {...p} type="text" inputMode="numeric" value={v.days} onChange={(e) => set("days")(e.target.value)} className={INPUT + " font-mono"} />}
          </Field>
          <Field id="deposit" label="Deposit (USD)" hint="Held, and only captured for new damage." error={errors.deposit}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.deposit} onChange={(e) => set("deposit")(e.target.value)} className={INPUT + " font-mono"} />}
          </Field>
          <Field id="purchaseYear" label="Year bought" hint="Optional. Used to depreciate the value." error={errors.purchaseYear}>
            {(p) => <input {...p} type="text" inputMode="numeric" value={v.purchaseYear} onChange={(e) => set("purchaseYear")(e.target.value)} className={INPUT + " font-mono"} />}
          </Field>
        </div>

        <div>
          <Field
            id="replacement"
            label="Replacement value (USD)"
            hint="Damage is priced as a share of this value, never more."
            error={errors.replacement}
          >
            {(p) => (
              <input
                {...p}
                type="text"
                inputMode="decimal"
                value={v.replacement}
                onChange={(e) => {
                  set("replacement")(e.target.value);
                  setV((s) => ({ ...s, replacementSource: "Owner estimate" }));
                }}
                className={INPUT + " font-mono"}
              />
            )}
          </Field>
          {!channel3Failed ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={findPrice} disabled={lookup.state === "loading"}>
                {lookup.state === "loading" ? "Looking..." : "Look up current price"}
              </Button>
              <p className="text-sm text-ink-soft" role="status">
                {lookup.state === "found" ? `Filled from ${v.replacementSource}: ${lookup.title}. You can edit it.` : ""}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-soft" role="status">
              No current price found for this item. Enter your own estimate.
            </p>
          )}
        </div>

        {holdCents !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-rule pt-4">
            <div>
              <TagLabel>The renter will authorize</TagLabel>
              <div>
                <Money cents={holdCents} />
              </div>
            </div>
            <TagLabel>Rental fee plus deposit. Not charged yet.</TagLabel>
          </div>
        ) : null}
      </fieldset>

      {submitError ? (
        <p role="alert" className="border-2 border-stamp bg-stamp-wash px-4 py-3 text-stamp">
          {submitError}
        </p>
      ) : null}
      {Object.values(errors).some(Boolean) ? (
        <p role="alert" className="font-mono text-sm text-stamp">
          Fix the marked fields to continue.
        </p>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating..." : "Create rental"}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (p: { id: string; name: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const uid = useId();
  const hintId = `${uid}-hint`;
  const errId = `${uid}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={`field-${id}`} className="block font-mono text-[0.9rem] font-bold">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
      <div className="mt-1">{children({ id: `field-${id}`, name: id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}</div>
      {error ? (
        <p id={errId} className="mt-1 font-mono text-sm font-bold text-stamp">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Created({ id, itemName }: { id: string; itemName: string }) {
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const link = `${origin}/r/${id}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      (document.getElementById("renter-link") as HTMLInputElement | null)?.select();
    }
  }

  return (
    <Ticket
      className="mt-8"
      stub={
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`/owner/rentals/${id}`}>Open this rental</LinkButton>
          <LinkButton href="/owner" variant="ghost">
            Back to the ledger
          </LinkButton>
        </div>
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <TagLabel>Tag no. {id.slice(0, 8)}</TagLabel>
          <h2 className="mt-1 text-4xl">Tag written for {itemName}</h2>
        </div>
        <Stamp tone="clear" press>
          Filed
        </Stamp>
      </div>
      <p className="mt-3 max-w-[52ch] text-ink-soft">
        Send this link to the renter. They authorize the hold, then take the pickup photos. This browser now holds your
        owner key for the rental, so keep using it to approve contested settlements.
      </p>
      <label htmlFor="renter-link" className="mt-5 block font-mono text-[0.9rem] font-bold">
        Renter link
      </label>
      <input id="renter-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={INPUT + " mt-1 font-mono text-sm"} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
        {canShare ? (
          <Button
            variant="ghost"
            onClick={() => navigator.share({ title: `Rental: ${itemName}`, text: "Authorize the rental hold here.", url: link }).catch(() => {})}
          >
            Share
          </Button>
        ) : null}
        <span role="status" className="text-sm text-ink-soft">
          {copied ? "Link copied to the clipboard." : ""}
        </span>
      </div>
    </Ticket>
  );
}
