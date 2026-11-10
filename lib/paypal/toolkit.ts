import "server-only";
import { getEnv } from "../env";
import { centsToValue, PayPalNotConfiguredError } from "./client";

/**
 * Wrapper around the official PayPal Agent Toolkit (AI SDK adapter).
 * Used for the overage invoice (create_invoice, send_invoice) and exported so
 * the inspection agent can call read-only tools such as get_order and
 * list_disputes. Tools that move money (pay_order, refunds) are not enabled.
 */

/** Only these tool families are switched on in the toolkit configuration. */
export const ENABLED_ACTIONS = {
  invoices: { create: true, send: true, get: true },
  orders: { get: true },
  disputes: { list: true, get: true },
};

/** Read-only tools the AI agent may be handed. */
export const AGENT_SAFE_TOOLS = ["get_order", "list_disputes", "get_dispute"] as const;

type ToolLike = { execute?: (args: never, options: never) => PromiseLike<unknown> | unknown };
type Toolkit = { getTools(): Record<string, ToolLike> };

let toolkit: Toolkit | null = null;

export async function getToolkit(): Promise<Toolkit> {
  if (toolkit) return toolkit;
  const e = getEnv();
  if (!e.PAYPAL_CLIENT_ID || !e.PAYPAL_CLIENT_SECRET) throw new PayPalNotConfiguredError("PayPal Agent Toolkit");
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  toolkit = new PayPalAgentToolkit({
    clientId: e.PAYPAL_CLIENT_ID,
    clientSecret: e.PAYPAL_CLIENT_SECRET,
    configuration: {
      actions: ENABLED_ACTIONS,
      context: { sandbox: e.PAYPAL_ENVIRONMENT !== "live" },
    },
  }) as unknown as Toolkit;
  return toolkit;
}

export function resetToolkit(): void {
  toolkit = null;
}

export class ToolkitError extends Error {
  constructor(public tool: string, message: string) {
    super(message);
    this.name = "ToolkitError";
  }
}

/** Names of the tools the toolkit actually exposes under the current configuration. */
export async function listToolkitTools(): Promise<string[]> {
  return Object.keys((await getToolkit()).getTools());
}

/**
 * Calls a named toolkit tool's execute. The toolkit returns a JSON string;
 * this parses it and turns its `{ error }` shape into a thrown ToolkitError.
 */
export async function callToolkitTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const tool = (await getToolkit()).getTools()[name];
  if (!tool?.execute) throw new ToolkitError(name, `PayPal toolkit tool "${name}" is not available.`);
  const raw = await (tool.execute as (a: unknown, o: unknown) => unknown)(args, {
    toolCallId: `handback-${name}-${Date.now()}`,
    messages: [],
  });
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }
  // The toolkit's own error class serializes as { ok: false, status, code, message }
  // (verified in @paypal/agent-toolkit/ai-sdk), with no `error` key, so check both shapes.
  const failed = parsed as { ok?: unknown; message?: unknown; code?: unknown; error?: { message?: string } | string } | null;
  if (failed && typeof failed === "object" && failed.ok === false) {
    const code = typeof failed.code === "string" ? `${failed.code}: ` : "";
    const msg = typeof failed.message === "string" && failed.message ? failed.message : `Tool "${name}" failed.`;
    throw new ToolkitError(name, `${code}${msg}`);
  }
  const err = failed?.error;
  if (err) throw new ToolkitError(name, typeof err === "string" ? err : (err.message ?? `Tool "${name}" failed.`));
  return parsed as T;
}

/* ---------------------------- overage invoice helper ---------------------------- */

export interface OverageInvoiceInput {
  rentalId: string;
  itemName: string;
  currency: string;
  overageCents: number;
  recipientEmail: string;
  /** Set when the invoice was already created by an earlier attempt. */
  existingInvoiceId?: string | null;
  onCreated?: (invoiceId: string) => void;
}

const INVOICE_ID_RE = /(INV2-[A-Z0-9-]+)/i;

/** Creates (unless one exists) and sends the invoice for damage above the deposit. Returns the invoice id. */
export async function createAndSendOverageInvoice(i: OverageInvoiceInput): Promise<string> {
  let invoiceId = i.existingInvoiceId ?? null;
  if (!invoiceId) {
    const created = await callToolkitTool<{ href?: string; id?: string }>("create_invoice", {
      currency_code: i.currency,
      reference: i.rentalId,
      note: `Damage above the deposit for rental ${i.rentalId}. The full record, with before and after photos, is attached to the rental.`,
      primary_recipients: [{ billing_info: { email_address: i.recipientEmail } }],
      items: [
        {
          name: `Damage beyond deposit: ${i.itemName}`.slice(0, 200),
          description: "Amount by which assessed new damage exceeds the deposit already captured.",
          quantity: "1",
          unit_amount: { currency_code: i.currency, value: centsToValue(i.overageCents) },
        },
      ],
    });
    invoiceId = created.id ?? created.href?.match(INVOICE_ID_RE)?.[1] ?? null;
    if (!invoiceId) throw new ToolkitError("create_invoice", "PayPal did not return an invoice id.");
    i.onCreated?.(invoiceId);
  }
  await callToolkitTool("send_invoice", {
    invoice_id: invoiceId,
    send_to_recipient: true,
    note: "Damage above the deposit was found at return. See the rental record for photos.",
  });
  return invoiceId;
}
