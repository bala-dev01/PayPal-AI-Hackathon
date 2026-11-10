import type { RentalEvent } from "./types";

/** What the app may show about a dispute PayPal reported. Nothing else leaves the server. */
export interface PayPalDispute {
  openedAt: string;
  disputeId: string | null;
  /** Exactly what PayPal sent, or null when it sent none. */
  status: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Derives the dispute banner state from the rental's recorded webhook events. Only three
 * fields are read. Repeated deliveries of the same dispute collapse into one result, and
 * the earliest recorded dispute wins.
 */
export function derivePayPalDispute(events: Pick<RentalEvent, "type" | "payload" | "created_at">[]): PayPalDispute | null {
  const e = events.find((x) => x.type === "webhook_dispute_created");
  if (!e) return null;
  const p = e.payload ?? {};
  return {
    openedAt: str(p.openedAt) ?? e.created_at,
    disputeId: str(p.disputeId) ?? str(p.resourceId),
    status: str(p.status),
  };
}

/** PayPal's Resolution Center for the configured environment. */
export function resolutionCenterUrl(environment: "sandbox" | "live"): string {
  return environment === "sandbox"
    ? "https://www.sandbox.paypal.com/resolutioncenter"
    : "https://www.paypal.com/resolutioncenter";
}
