import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "../env";

/**
 * Small typed PayPal REST v2 client. Request shapes follow the published
 * OpenAPI schemas at developer.paypal.com/api/orders/v2 and /api/payments/v2.
 * Every mutating call carries a PayPal-Request-Id so retries are idempotent.
 */

export class PayPalNotConfiguredError extends Error {
  constructor(what = "PayPal") {
    super(`${what} is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`);
    this.name = "PayPalNotConfiguredError";
  }
}

export class PayPalApiError extends Error {
  constructor(
    public status: number,
    public issue: string,
    message: string,
    public debugId: string | null,
    public details: unknown,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
}

export interface Money {
  currency_code: string;
  value: string;
}

export const centsToValue = (cents: number): string => {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
};
export const valueToCents = (value: string): number => Math.round(Number(value) * 100);
export const moneyFromCents = (cents: number, currency: string): Money => ({
  currency_code: currency,
  value: centsToValue(cents),
});

export function baseUrl(): string {
  return getEnv().PAYPAL_ENVIRONMENT === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function paypalConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET);
}

/* ------------------------------- OAuth token ------------------------------- */

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
let tokenInflight: Promise<string> | null = null;

export function resetTokenCache(): void {
  tokenCache = null;
  tokenInflight = null;
}

export async function getAccessToken(): Promise<string> {
  const e = getEnv();
  if (!e.PAYPAL_CLIENT_ID || !e.PAYPAL_CLIENT_SECRET) throw new PayPalNotConfiguredError();
  const key = `${baseUrl()}|${e.PAYPAL_CLIENT_ID}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (tokenInflight) return tokenInflight;
  const clientId = e.PAYPAL_CLIENT_ID;
  const secret = e.PAYPAL_CLIENT_SECRET;
  tokenInflight = (async () => {
    const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) {
      throw new PayPalApiError(res.status, "AUTH_FAILED", "PayPal rejected the API credentials.", null, null);
    }
    tokenCache = { key, token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
    return json.access_token;
  })().finally(() => {
    tokenInflight = null;
  });
  return tokenInflight;
}

/* --------------------------------- transport -------------------------------- */

interface CallOptions {
  body?: unknown;
  /** A ready-made JSON text sent as is. Takes precedence over `body`. */
  rawBody?: string;
  /** Sent as PayPal-Request-Id. Mutating calls should always pass one. */
  requestId?: string;
}

async function call<T>(method: "GET" | "POST", path: string, opts: CallOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId.slice(0, 108);
  // Ask for the full resource back from capture/authorize/reauthorize.
  if (method === "POST") headers["Prefer"] = "return=representation";
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: opts.rawBody !== undefined ? opts.rawBody : opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }
  }
  if (!res.ok) {
    const j = (json ?? {}) as { name?: string; message?: string; debug_id?: string; details?: { issue?: string }[] };
    const issue = j.details?.[0]?.issue ?? j.name ?? `HTTP_${res.status}`;
    throw new PayPalApiError(res.status, issue, j.message ?? `PayPal request failed (${res.status}).`, j.debug_id ?? null, j.details ?? null);
  }
  return json as T;
}

/* ---------------------------------- orders ---------------------------------- */

export interface PayPalAuthorization {
  id: string;
  status: "CREATED" | "CAPTURED" | "DENIED" | "EXPIRED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING";
  amount: Money;
  expiration_time?: string;
  custom_id?: string;
  invoice_id?: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  intent?: string;
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: {
    custom_id?: string;
    invoice_id?: string;
    amount?: Money;
    payments?: { authorizations?: PayPalAuthorization[]; captures?: { id: string; status: string; amount: Money }[] };
  }[];
}

export interface CreateOrderInput {
  amountCents: number;
  currency: string;
  /** Set to the rental id so webhooks and disputes can be linked back. */
  customId: string;
  invoiceId: string;
  description: string;
  requestId: string;
}

/** Orders v2 create, intent AUTHORIZE: nothing is charged at this step. */
export function createOrder(i: CreateOrderInput): Promise<PayPalOrder> {
  return call<PayPalOrder>("POST", "/v2/checkout/orders", {
    requestId: i.requestId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          amount: moneyFromCents(i.amountCents, i.currency),
          description: i.description.slice(0, 127),
          custom_id: i.customId.slice(0, 127),
          invoice_id: i.invoiceId.slice(0, 127),
        },
      ],
    },
  });
}

/** Authorizes an approved order. The authorization is in purchase_units[0].payments.authorizations[0]. */
export function authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { requestId, body: {} });
}

export function getOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/* ------------------------------- authorizations ------------------------------ */

export function getAuthorization(authorizationId: string): Promise<PayPalAuthorization> {
  return call<PayPalAuthorization>("GET", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
}

/** Allowed once, from day 4 to day 29. Supports only the amount parameter. */
export function reauthorize(authorizationId: string, amountCents: number, currency: string, requestId: string) {
  return call<PayPalAuthorization>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`, {
    requestId,
    body: { amount: moneyFromCents(amountCents, currency) },
  });
}

export interface PayPalCapture {
  id: string;
  status: string;
  amount?: Money;
  final_capture?: boolean;
  invoice_id?: string;
}

export interface CaptureInput {
  authorizationId: string;
  amountCents: number;
  currency: string;
  /** true releases whatever is left of the authorization. */
  finalCapture: boolean;
  noteToPayer?: string;
  requestId: string;
}

export function captureAuthorization(i: CaptureInput): Promise<PayPalCapture> {
  const body: Record<string, unknown> = {
    amount: moneyFromCents(i.amountCents, i.currency),
    final_capture: i.finalCapture,
  };
  // No invoice_id here: PayPal requires it to be unique per merchant by default,
  // so a repeat or a second rental would be rejected as a duplicate invoice.
  if (i.noteToPayer) body.note_to_payer = i.noteToPayer.slice(0, 255);
  return call<PayPalCapture>("POST", `/v2/payments/authorizations/${encodeURIComponent(i.authorizationId)}/capture`, {
    requestId: i.requestId,
    body,
  });
}

/** Voids an authorization. PayPal answers 204 with no body, or the authorization with return=representation. */
export function voidAuthorization(authorizationId: string, requestId: string): Promise<PayPalAuthorization | null> {
  return call<PayPalAuthorization | null>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
    requestId,
  });
}

/* -------------------------------- webhooks ---------------------------------- */

export interface WebhookVerifyInput {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  /** The event exactly as received (raw JSON text). It is spliced in verbatim, never re-serialized. */
  webhookEventRaw: string;
}

/**
 * Builds the verify-webhook-signature request body with the event's original text
 * in place. Re-serializing a parsed event can change whitespace, key order, number
 * formatting or escapes, and the signature covers the exact bytes.
 */
export function buildVerifyWebhookBody(i: WebhookVerifyInput): string {
  const j = JSON.stringify;
  return (
    `{"auth_algo":${j(i.authAlgo)},"cert_url":${j(i.certUrl)},"transmission_id":${j(i.transmissionId)},` +
    `"transmission_sig":${j(i.transmissionSig)},"transmission_time":${j(i.transmissionTime)},` +
    `"webhook_id":${j(i.webhookId)},"webhook_event":${i.webhookEventRaw}}`
  );
}

export async function verifyWebhookSignature(i: WebhookVerifyInput): Promise<boolean> {
  const r = await call<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    rawBody: buildVerifyWebhookBody(i),
  });
  return r.verification_status === "SUCCESS";
}

export const newRequestId = (prefix: string): string => `${prefix}-${randomUUID()}`;
