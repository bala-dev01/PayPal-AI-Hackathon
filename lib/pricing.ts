/**
 * Pure pricing. The model returns findings only; this module turns them into
 * integer cents. No model output is ever used directly as an amount.
 */
import type { Finding, PricingLine, PricingResult, Severity } from "./types";

export const CONFIDENCE_THRESHOLD = 0.75;
export const DEPRECIATION_PER_YEAR = 0.15;
export const DEPRECIATION_FLOOR = 0.4;

/** Share of base value, in basis points (1 bp = 0.01%) to keep math integer. */
export const SEVERITY_RATE_BP: Record<Severity, number> = {
  cosmetic: 0,
  minor: 300,
  moderate: 1200,
  major: 3500,
  destroyed: 10000,
};

/** Replacement value depreciated 15% per full year of age, never below 40%. */
export function depreciatedBaseCents(
  replacementCents: number,
  purchaseYear: number | null,
  currentYear: number = new Date().getUTCFullYear(),
): number {
  const replacement = Math.max(0, Math.round(replacementCents));
  if (purchaseYear === null) return replacement;
  const age = Math.max(0, currentYear - purchaseYear);
  // Work in basis points so the result is deterministic integer math.
  const factorBp = Math.max(
    Math.round(DEPRECIATION_FLOOR * 10000),
    10000 - Math.round(DEPRECIATION_PER_YEAR * 10000) * age,
  );
  return Math.round((replacement * factorBp) / 10000);
}

/** Reason shown on every extra view of a physical damage that is already priced on one line. */
export const OTHER_VIEW_REASON = "Another view of the same damage, charged once";
export const EXCLUDED_REASON = "Removed by the owner";

/**
 * The physical damage a finding belongs to. Findings stored before damage_key existed have
 * none, so each is its own damage (keyed by its unique id) and still prices without throwing.
 */
export function damageKeyOf(f: Finding): string {
  const k = typeof f.damage_key === "string" ? f.damage_key.trim().toLowerCase() : "";
  return k ? `k:${k}` : `id:${f.id}`;
}

/** Null when the finding is chargeable, otherwise the plain-language reason. */
export function nonChargeableReason(f: Finding): string | null {
  if (f.classification === "pre_existing") return "Already present at pickup";
  if (f.classification === "normal_wear") return "Normal wear";
  if (f.classification === "uncertain") return "Not certain enough to charge";
  if (!(f.confidence >= CONFIDENCE_THRESHOLD)) return "Confidence below 75%";
  return null;
}

export interface PricingInput {
  findings: Finding[];
  replacementCents: number;
  purchaseYear: number | null;
  depositCents: number;
  currentYear?: number;
  /**
   * Findings the owner dropped. Excluding ANY finding of a physical damage removes the whole
   * damage from the charge, so an exclusion always lowers (never raises) the total.
   */
  excludedFindingIds?: readonly string[];
}

const SEVERITY_ORDER: Record<Severity, number> = { cosmetic: 0, minor: 1, moderate: 2, major: 3, destroyed: 4 };

/**
 * True when `a` should be the one charged instead of `b`. A view the inspector is sure of always
 * beats one it is not, so an unsure guess can neither raise a charge nor erase a confident one.
 * After that: higher severity, then higher confidence.
 */
function outranks(a: Finding, b: Finding): boolean {
  const confidentA = a.confidence >= CONFIDENCE_THRESHOLD;
  const confidentB = b.confidence >= CONFIDENCE_THRESHOLD;
  if (confidentA !== confidentB) return confidentA;
  const sa = SEVERITY_ORDER[a.severity];
  const sb = SEVERITY_ORDER[b.severity];
  if (sa !== sb) return sa > sb;
  const ca = Number.isFinite(a.confidence) ? a.confidence : -1;
  const cb = Number.isFinite(b.confidence) ? b.confidence : -1;
  return ca > cb; // ties keep the earlier finding (stable order)
}

export function priceFindings(input: PricingInput): PricingResult {
  const base = depreciatedBaseCents(input.replacementCents, input.purchaseYear, input.currentYear);
  const deposit = Math.max(0, Math.round(input.depositCents));
  const excludedIds = new Set(input.excludedFindingIds ?? []);

  // One physical damage is charged once. Only new_damage findings compete for the charge;
  // anything else keeps its own line and its own $0 reason.
  const excludedKeys = new Set(input.findings.filter((f) => excludedIds.has(f.id)).map(damageKeyOf));
  const chosen = new Map<string, Finding>();
  for (const f of input.findings) {
    if (f.classification !== "new_damage") continue;
    const key = damageKeyOf(f);
    const cur = chosen.get(key);
    if (!cur || outranks(f, cur)) chosen.set(key, f);
  }

  const lines: PricingLine[] = input.findings.map((f) => {
    const damageKey = damageKeyOf(f);
    const head = {
      findingId: f.id,
      damageKey,
      title: f.title,
      classification: f.classification,
      severity: f.severity,
      confidence: f.confidence,
    };
    const winner = f.classification === "new_damage" ? chosen.get(damageKey) : undefined;
    if (winner && winner !== f) {
      return { ...head, primary: false, chargeable: false, reason: OTHER_VIEW_REASON, amountCents: 0 };
    }
    if (winner && excludedKeys.has(damageKey)) {
      return { ...head, primary: true, chargeable: false, reason: EXCLUDED_REASON, amountCents: 0 };
    }
    const reason = nonChargeableReason(f);
    const chargeable = reason === null;
    const amountCents = chargeable ? Math.round((base * SEVERITY_RATE_BP[f.severity]) / 10000) : 0;
    return {
      ...head,
      primary: true,
      chargeable,
      reason: chargeable && amountCents === 0 ? "Cosmetic only" : reason,
      amountCents,
    };
  });

  const sum = lines.reduce((s, l) => s + l.amountCents, 0);
  const damageCents = Math.min(sum, base);
  const depositCapturedCents = Math.min(damageCents, deposit);
  const overageCents = damageCents - depositCapturedCents;
  return {
    baseValueCents: base,
    lines,
    damageCents,
    depositCapturedCents,
    overageCents,
    depositReleasedCents: deposit - depositCapturedCents,
  };
}

/** Whole-currency display helper, e.g. 12500 -> "125.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Rental fee plus the deposit share being captured. Never exceeds the authorized amount. */
export function captureTotalCents(feeCents: number, result: PricingResult, authorizedCents: number): number {
  return Math.min(authorizedCents, Math.max(0, feeCents) + result.depositCapturedCents);
}
