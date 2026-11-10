import "server-only";

export interface HoldCheck {
  /** True only when PayPal confirmed the order. */
  verified: boolean;
  /** A status word such as APPROVED or COMPLETED, when known. */
  status: string | null;
  note: string;
}

type Loose = Record<string, unknown>;

function findStatus(value: unknown): string | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Loose;
  const units = obj.purchase_units;
  if (Array.isArray(units)) {
    const auths = ((units[0] as Loose | undefined)?.payments as Loose | undefined)?.authorizations;
    const a0 = Array.isArray(auths) ? (auths[0] as Loose | undefined) : undefined;
    if (a0 && typeof a0.status === "string") return `AUTHORIZATION_${a0.status}`;
  }
  return typeof obj.status === "string" ? obj.status : null;
}

/**
 * Asks the PayPal Agent Toolkit for the order (`get_order`). The toolkit helper is
 * loaded lazily: if it is missing or fails, the
 * inspection continues and the model is told the hold could not be checked.
 */
export async function verifyHold(orderId: string | null): Promise<HoldCheck> {
  if (!orderId) return { verified: false, status: null, note: "No payment hold is recorded for this rental." };
  try {
    const { callToolkitTool } = await import("../paypal/toolkit");
    const result = await callToolkitTool("get_order", { id: orderId });
    const status = findStatus(result);
    return status
      ? { verified: true, status, note: "Hold checked with PayPal." }
      : { verified: false, status: null, note: "PayPal returned an order but its status was unclear." };
  } catch {
    return { verified: false, status: null, note: "The payment check is unavailable right now." };
  }
}
