/**
 * Display grouping: one card per physical damage. Pure and client-safe. Money is never computed
 * here; the charge comes from the PricingLine that lib/pricing.ts already marked primary.
 */
import { damageKeyOf } from "./pricing";
import type { Finding, PricingLine } from "./types";

export interface DamageGroup {
  key: string;
  /** The view that carries the classification, stamp and price. */
  primary: Finding;
  /** Every view, primary first, then in original order. */
  views: Finding[];
  /** The primary's pricing line, when pricing exists. */
  line: PricingLine | undefined;
  /** Every finding id in the group (used to send owner exclusions). */
  ids: string[];
  amountCents: number;
}

/** Groups findings by physical damage, charged groups first. Old findings without a key stay alone. */
export function groupFindings(findings: readonly Finding[], lines: readonly PricingLine[] = []): DamageGroup[] {
  const lineBy = new Map(lines.map((l) => [l.findingId, l]));
  const order: string[] = [];
  const byKey = new Map<string, Finding[]>();
  for (const f of findings) {
    // Only new damage is merged across angles; anything else stays on its own card.
    const key = f.classification === "new_damage" ? damageKeyOf(f) : `id:${f.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(f);
  }
  const groups = order.map((key): DamageGroup => {
    const views = byKey.get(key)!;
    const primary = views.find((f) => lineBy.get(f.id)?.primary) ?? views[0]!;
    const rest = views.filter((f) => f !== primary);
    const line = lineBy.get(primary.id);
    return { key, primary, views: [primary, ...rest], line, ids: views.map((f) => f.id), amountCents: line?.amountCents ?? 0 };
  });
  return groups.sort((a, b) => Number(b.amountCents > 0) - Number(a.amountCents > 0));
}
