/** Shared domain types. All money is integer cents. */

export const ANGLES = ["front", "back", "left", "right", "top", "detail"] as const;
export type Angle = (typeof ANGLES)[number];

export const PHASES = ["pickup", "return"] as const;
export type Phase = (typeof PHASES)[number];

export const RENTAL_STATUSES = [
  "draft",
  "held",
  "picked_up",
  "returned",
  "inspecting",
  "verdict_ready",
  "contested",
  "settling",
  "settled",
  "failed",
  /** Terminal: the owner released the renter's whole hold before any inspection. Nothing was charged. */
  "released",
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const CLASSIFICATIONS = ["new_damage", "pre_existing", "normal_wear", "uncertain"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const SEVERITIES = ["cosmetic", "minor", "moderate", "major", "destroyed"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Normalized 0..1 region. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Finding {
  id: string;
  /**
   * Short stable lowercase slug naming the physical damage (e.g. "lens-rim-dent"). The same
   * physical damage seen from several angles shares one key. Always set on new findings;
   * findings stored before this field existed lack it and are then priced as their own damage.
   */
  damage_key?: string;
  angle: Angle;
  title: string;
  description: string;
  classification: Classification;
  severity: Severity;
  /** 0..1 */
  confidence: number;
  region_before: Region | null;
  region_after: Region | null;
}

export interface Rental {
  id: string;
  item_name: string;
  item_description: string;
  category: string;
  daily_rate_cents: number;
  days: number;
  deposit_cents: number;
  replacement_cents: number;
  replacement_source: string | null;
  purchase_year: number | null;
  currency: string;
  status: RentalStatus;
  paypal_authorization_id: string | null;
  authorized_cents: number;
  captured_cents: number;
  released_cents: number;
  paypal_capture_id: string | null;
  overage_invoice_id: string | null;
  renter_note: string | null;
  is_sample: boolean;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  rental_id: string;
  phase: Phase;
  angle: Angle;
  path: string;
  quality: PhotoQuality | null;
  created_at: string;
}

export interface PhotoQuality {
  ok: boolean;
  issues: string[];
  feedback: string;
}

export interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface Inspection {
  id: string;
  rental_id: string;
  photo_hash: string;
  findings: Finding[];
  summary: string;
  model: string;
  usage: UsageInfo | null;
  created_at: string;
}

export interface RentalEvent {
  id: string;
  rental_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Itemized output of lib/pricing.ts. */
export interface PricingLine {
  findingId: string;
  /** The physical damage this line belongs to (the finding's damage_key, or its own id for old data). */
  damageKey: string;
  /** True for the one line per physical damage that carries the charge decision. */
  primary: boolean;
  title: string;
  classification: Classification;
  severity: Severity;
  confidence: number;
  chargeable: boolean;
  /** Why it costs nothing, or null when chargeable. */
  reason: string | null;
  amountCents: number;
}

export interface PricingResult {
  baseValueCents: number;
  lines: PricingLine[];
  /** Capped at base value. */
  damageCents: number;
  depositCapturedCents: number;
  overageCents: number;
  depositReleasedCents: number;
}

/**
 * The quote frozen when a settlement is first claimed. Retries use these stored
 * values and never recompute from current findings or exclusions.
 */
export interface FrozenSettlement {
  basis: "renter_accepted" | "owner_approved";
  /** The inspection findings that were priced (all findings, before exclusions). */
  findings: Finding[];
  excludedFindingIds: string[];
  pricing: PricingResult;
  feeCents: number;
  captureTotalCents: number;
  authorizationId: string;
  currency: string;
  /** PayPal-Request-Id for the capture, or the void when nothing is charged. Reused on every retry. */
  requestId: string;
  /** True once the money step (capture or void) is recorded locally. A retry then resumes at the invoice. */
  moneyDone: boolean;
}
