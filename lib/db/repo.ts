import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "./connection";
import type {
  Angle,
  Finding,
  FrozenSettlement,
  Inspection,
  Phase,
  Photo,
  PhotoQuality,
  Rental,
  RentalEvent,
  RentalStatus,
  UsageInfo,
} from "../types";

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
/** Short prefixed id, used in share links. */
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** Columns that must never leave the server through a Rental object. */
const PRIVATE_COLUMNS = ["owner_token", "renter_token_hash", "payer_email", "excluded_finding_ids", "settle_basis", "settle_quote", "hold_nonce_hash", "paypal_order_id"];

function toRental(r: Row): Rental {
  const copy: Row = { ...r };
  for (const c of PRIVATE_COLUMNS) delete copy[c];
  return { ...(copy as unknown as Rental), is_sample: Number(r.is_sample) === 1 };
}

export type SettleBasis = "renter_accepted" | "owner_approved";

/** Server-only settlement bookkeeping that is deliberately not part of Rental. */
export interface SettlementPrivate {
  payerEmail: string | null;
  excludedFindingIds: string[];
  basis: SettleBasis | null;
  /** The quote frozen at first claim; null before a settlement has started. */
  quote: FrozenSettlement | null;
}

export function getSettlementPrivate(id: string): SettlementPrivate {
  const r = getDb()
    .prepare("SELECT payer_email, excluded_finding_ids, settle_basis, settle_quote FROM rentals WHERE id = ?")
    .get(id);
  return {
    payerEmail: (r?.payer_email as string | null) ?? null,
    excludedFindingIds: r?.excluded_finding_ids ? (JSON.parse(r.excluded_finding_ids as string) as string[]) : [],
    basis: (r?.settle_basis as SettleBasis | null) ?? null,
    quote: r?.settle_quote ? (JSON.parse(r.settle_quote as string) as FrozenSettlement) : null,
  };
}

export function setSettlementPrivate(
  id: string,
  p: { payerEmail?: string | null; excludedFindingIds?: string[]; basis?: SettleBasis | null; quote?: FrozenSettlement | null },
): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (p.payerEmail !== undefined) { sets.push("payer_email = ?"); vals.push(p.payerEmail); }
  if (p.excludedFindingIds !== undefined) { sets.push("excluded_finding_ids = ?"); vals.push(JSON.stringify(p.excludedFindingIds)); }
  if (p.basis !== undefined) { sets.push("settle_basis = ?"); vals.push(p.basis); }
  if (p.quote !== undefined) { sets.push("settle_quote = ?"); vals.push(p.quote ? JSON.stringify(p.quote) : null); }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE rentals SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now(), id);
}

/** Constant-time check of the owner token. Rentals without a token (samples) never match. */
export function verifyOwnerToken(id: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const r = getDb().prepare("SELECT owner_token FROM rentals WHERE id = ?").get(id);
  const stored = r?.owner_token as string | null | undefined;
  if (!stored) return false;
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

const sha256 = (v: string) => createHash("sha256").update(v).digest();

/**
 * Stores the renter token (as a SHA-256 hash) for a rental. Only the authorize
 * route calls this, once, right after the hold is placed.
 */
export function setRenterToken(id: string, token: string): void {
  getDb().prepare("UPDATE rentals SET renter_token_hash = ? WHERE id = ?").run(sha256(token).toString("hex"), id);
}

export function hasRenterToken(id: string): boolean {
  const r = getDb().prepare("SELECT renter_token_hash FROM rentals WHERE id = ?").get(id);
  return Boolean(r?.renter_token_hash);
}

/** Constant-time check of the renter token. Rentals without one never match. */
export function verifyRenterToken(id: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const r = getDb().prepare("SELECT renter_token_hash FROM rentals WHERE id = ?").get(id);
  const stored = r?.renter_token_hash as string | null | undefined;
  if (!stored) return false;
  return timingSafeEqual(Buffer.from(stored, "hex"), sha256(token));
}

/** The PayPal order id. Server-only: it is deliberately not on the public Rental. */
export function getPayPalOrderId(id: string): string | null {
  const r = getDb().prepare("SELECT paypal_order_id FROM rentals WHERE id = ?").get(id);
  return (r?.paypal_order_id as string | null | undefined) ?? null;
}

/**
 * Atomically records a freshly created PayPal order and its one-time hold nonce (stored
 * hashed), only while the rental is still a draft. False when it is no longer a draft.
 */
export function setHoldOrderIfDraft(id: string, orderId: string, nonce: string): boolean {
  const res = getDb()
    .prepare(
      "UPDATE rentals SET paypal_order_id = ?, hold_nonce_hash = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
    )
    .run(orderId, sha256(nonce).toString("hex"), now(), id);
  return Number(res.changes) === 1;
}

/** Constant-time check of the hold nonce handed to the browser that created the order. */
export function verifyHoldNonce(id: string, nonce: string | null | undefined): boolean {
  if (!nonce) return false;
  const r = getDb().prepare("SELECT hold_nonce_hash FROM rentals WHERE id = ?").get(id);
  const stored = r?.hold_nonce_hash as string | null | undefined;
  if (!stored) return false;
  return timingSafeEqual(Buffer.from(stored, "hex"), sha256(nonce));
}

/** Makes the hold nonce single-use. */
export function clearHoldNonce(id: string): void {
  getDb().prepare("UPDATE rentals SET hold_nonce_hash = NULL WHERE id = ?").run(id);
}

/**
 * A rental stuck in `settling` since before `cutoffIso` (a crash mid-PayPal) becomes
 * `failed` so the retry action appears. Atomic: only one caller makes the change.
 */
export function failStaleSettling(id: string, cutoffIso: string): boolean {
  const res = getDb()
    .prepare("UPDATE rentals SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'settling' AND updated_at < ?")
    .run(now(), id, cutoffIso);
  return Number(res.changes) === 1;
}

/**
 * Atomic compare-and-set on status. Returns true only for the caller that made
 * the transition, which is what stops two requests from both settling.
 */
export function claimStatus(id: string, from: RentalStatus[], to: RentalStatus): boolean {
  const marks = from.map(() => "?").join(",");
  const res = getDb()
    .prepare(`UPDATE rentals SET status = ?, updated_at = ? WHERE id = ? AND status IN (${marks})`)
    .run(to, now(), id, ...from);
  return Number(res.changes) === 1;
}

/** Records a PayPal webhook event id. False when it was already seen. */
export function recordWebhookEvent(eventId: string, type: string, rentalId: string | null): boolean {
  const res = getDb()
    .prepare("INSERT OR IGNORE INTO webhook_events (id,type,rental_id,created_at) VALUES (?,?,?,?)")
    .run(eventId, type, rentalId, now());
  return Number(res.changes) === 1;
}

/** Finds the rental a PayPal object belongs to by any id we stored or set on the order. */
export function findRentalByPayPalRef(refs: (string | null | undefined)[]): Rental | null {
  const db = getDb();
  for (const ref of refs) {
    if (!ref) continue;
    const r = db
      .prepare(
        "SELECT * FROM rentals WHERE id = ?1 OR paypal_order_id = ?1 OR paypal_authorization_id = ?1 OR paypal_capture_id = ?1 LIMIT 1",
      )
      .get(ref);
    if (r) return toRental(r);
  }
  return null;
}

/* --------------------------------- rentals --------------------------------- */

export interface NewRental {
  id?: string;
  item_name: string;
  item_description?: string;
  category?: string;
  daily_rate_cents: number;
  days: number;
  deposit_cents: number;
  replacement_cents: number;
  replacement_source?: string | null;
  purchase_year?: number | null;
  currency?: string;
  status?: RentalStatus;
}

/** Returns the rental and its owner token. The token is shown to the creator once. */
export function createRentalWithToken(input: NewRental): { rental: Rental; ownerToken: string } {
  const ownerToken = randomBytes(24).toString("base64url");
  const rental = createRental(input);
  getDb().prepare("UPDATE rentals SET owner_token = ? WHERE id = ?").run(ownerToken, rental.id);
  return { rental, ownerToken };
}

export function createRental(input: NewRental): Rental {
  const id = input.id ?? newId("rnt");
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO rentals (id,item_name,item_description,category,daily_rate_cents,days,deposit_cents,
        replacement_cents,replacement_source,purchase_year,currency,status,is_sample,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    )
    .run(
      id,
      input.item_name,
      input.item_description ?? "",
      input.category ?? "other",
      input.daily_rate_cents,
      input.days,
      input.deposit_cents,
      input.replacement_cents,
      input.replacement_source ?? null,
      input.purchase_year ?? null,
      input.currency ?? "USD",
      input.status ?? "draft",
      t,
      t,
    );
  return getRental(id)!;
}

export function getRental(id: string): Rental | null {
  const r = getDb().prepare("SELECT * FROM rentals WHERE id = ?").get(id);
  return r ? toRental(r) : null;
}

export function listRentals(): Rental[] {
  return getDb().prepare("SELECT * FROM rentals ORDER BY created_at DESC, rowid DESC").all().map(toRental);
}

/**
 * What the owner console may see: the sample rentals, plus rentals whose owner
 * token is in `tokens`. Each token is compared in constant time.
 */
export function listRentalsForOwnerTokens(tokens: string[]): Rental[] {
  const wanted = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))].slice(0, 100).map(sha256);
  const rows = getDb().prepare("SELECT * FROM rentals ORDER BY created_at DESC, rowid DESC").all();
  return rows
    .filter((r) => {
      if (Number(r.is_sample) === 1) return true;
      const stored = r.owner_token as string | null | undefined;
      if (!stored || wanted.length === 0) return false;
      const h = sha256(stored);
      let match = false;
      for (const w of wanted) if (timingSafeEqual(h, w)) match = true;
      return match;
    })
    .map(toRental);
}

export type RentalPatch = Partial<Omit<Rental, "id" | "created_at" | "updated_at" | "is_sample">> & {
  /** Server-only: never part of a Rental, so it cannot leak through a read route. */
  paypal_order_id?: string | null;
};

const PATCHABLE = new Set([
  "item_name", "item_description", "category", "daily_rate_cents", "days", "deposit_cents",
  "replacement_cents", "replacement_source", "purchase_year", "currency", "status",
  "paypal_order_id", "paypal_authorization_id", "authorized_cents", "captured_cents",
  "released_cents", "paypal_capture_id", "overage_invoice_id", "renter_note",
]);

export function updateRental(id: string, patch: RentalPatch): Rental | null {
  const entries = Object.entries(patch).filter(([k, v]) => PATCHABLE.has(k) && v !== undefined);
  if (entries.length === 0) return getRental(id);
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v as string | number | null);
  getDb().prepare(`UPDATE rentals SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  return getRental(id);
}

export function setRentalStatus(id: string, status: RentalStatus): Rental | null {
  return updateRental(id, { status });
}

/** Total hold the renter authorizes: rental fee plus deposit, in cents. */
export function holdAmountCents(r: Pick<Rental, "daily_rate_cents" | "days" | "deposit_cents">): number {
  return r.daily_rate_cents * r.days + r.deposit_cents;
}

/* ---------------------------------- photos --------------------------------- */

function toPhoto(r: Row): Photo {
  return {
    id: r.id as string,
    rental_id: r.rental_id as string,
    phase: r.phase as Phase,
    angle: r.angle as Angle,
    path: r.path as string,
    quality: r.quality_json ? (JSON.parse(r.quality_json as string) as PhotoQuality) : null,
    created_at: r.created_at as string,
  };
}

/** Replaces any earlier photo for the same rental, phase and angle (a retake). */
export function savePhoto(input: {
  rental_id: string;
  phase: Phase;
  angle: Angle;
  path: string;
  quality?: PhotoQuality | null;
}): Photo {
  const db = getDb();
  const id = newId("pho");
  db.prepare("DELETE FROM photos WHERE rental_id = ? AND phase = ? AND angle = ?").run(
    input.rental_id,
    input.phase,
    input.angle,
  );
  db.prepare(
    "INSERT INTO photos (id,rental_id,phase,angle,path,quality_json,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(id, input.rental_id, input.phase, input.angle, input.path, input.quality ? JSON.stringify(input.quality) : null, now());
  return getPhoto(id)!;
}

export function getPhoto(id: string): Photo | null {
  const r = getDb().prepare("SELECT * FROM photos WHERE id = ?").get(id);
  return r ? toPhoto(r) : null;
}

export function listPhotos(rentalId: string, phase?: Phase): Photo[] {
  const db = getDb();
  const rows = phase
    ? db.prepare("SELECT * FROM photos WHERE rental_id = ? AND phase = ? ORDER BY created_at, rowid").all(rentalId, phase)
    : db.prepare("SELECT * FROM photos WHERE rental_id = ? ORDER BY created_at, rowid").all(rentalId);
  return rows.map(toPhoto);
}

export function updatePhotoQuality(id: string, quality: PhotoQuality): void {
  getDb().prepare("UPDATE photos SET quality_json = ? WHERE id = ?").run(JSON.stringify(quality), id);
}

/* ------------------------------- inspections ------------------------------- */

function toInspection(r: Row): Inspection {
  return {
    id: r.id as string,
    rental_id: r.rental_id as string,
    photo_hash: r.photo_hash as string,
    findings: JSON.parse(r.findings_json as string) as Finding[],
    summary: r.summary as string,
    model: r.model as string,
    usage: r.usage_json ? (JSON.parse(r.usage_json as string) as UsageInfo) : null,
    created_at: r.created_at as string,
  };
}

export function saveInspection(input: {
  rental_id: string;
  photo_hash: string;
  findings: Finding[];
  summary: string;
  model: string;
  usage?: UsageInfo | null;
}): Inspection {
  const id = newId("ins");
  const db = getDb();
  db.prepare(
    "INSERT INTO inspections (id,rental_id,photo_hash,findings_json,summary,model,usage_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(id, input.rental_id, input.photo_hash, JSON.stringify(input.findings), input.summary, input.model, input.usage ? JSON.stringify(input.usage) : null, now());
  return toInspection(db.prepare("SELECT * FROM inspections WHERE id = ?").get(id)!);
}

export function getLatestInspection(rentalId: string): Inspection | null {
  const r = getDb()
    .prepare("SELECT * FROM inspections WHERE rental_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(rentalId);
  return r ? toInspection(r) : null;
}

/** Cache lookup: the latest inspection of the same photo set. */
export function findInspectionByHash(photoHash: string): Inspection | null {
  const r = getDb()
    .prepare("SELECT * FROM inspections WHERE photo_hash = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(photoHash);
  return r ? toInspection(r) : null;
}

/** Inspections created since an ISO timestamp, for the daily demo limit. */
export function countInspectionsSince(sinceIso: string): number {
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM inspections WHERE created_at >= ?").get(sinceIso);
  return Number(r?.n ?? 0);
}

/* ---------------------------------- events --------------------------------- */

function toEvent(r: Row): RentalEvent {
  return {
    id: r.id as string,
    rental_id: r.rental_id as string,
    type: r.type as string,
    payload: JSON.parse(r.payload_json as string) as Record<string, unknown>,
    created_at: r.created_at as string,
  };
}

export function addEvent(rentalId: string, type: string, payload: Record<string, unknown> = {}): RentalEvent {
  const id = newId("evt");
  const db = getDb();
  db.prepare("INSERT INTO events (id,rental_id,type,payload_json,created_at) VALUES (?,?,?,?,?)").run(
    id,
    rentalId,
    type,
    JSON.stringify(payload),
    now(),
  );
  return toEvent(db.prepare("SELECT * FROM events WHERE id = ?").get(id)!);
}

/** Ids of rentals that have a PayPal dispute event recorded. */
export function listDisputedRentalIds(): Set<string> {
  const rows = getDb().prepare("SELECT DISTINCT rental_id FROM events WHERE type = 'webhook_dispute_created'").all();
  return new Set(rows.map((r) => String(r.rental_id)));
}

export function listEvents(rentalId: string): RentalEvent[] {
  return getDb()
    .prepare("SELECT * FROM events WHERE rental_id = ? ORDER BY created_at, rowid")
    .all(rentalId)
    .map(toEvent);
}
