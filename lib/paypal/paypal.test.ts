import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Replace the real toolkit with one whose tools return what the real package returns on failure.
const tools: Record<string, { execute: (a: unknown, o: unknown) => unknown }> = {};
vi.mock("@paypal/agent-toolkit/ai-sdk", () => ({
  PayPalAgentToolkit: class {
    getTools() {
      return tools;
    }
  },
}));

let toolkit: typeof import("./toolkit");
let client: typeof import("./client");

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  toolkit = await import("./toolkit");
  client = await import("./client");
});

beforeEach(() => {
  toolkit.resetToolkit();
  client.resetTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("toolkit error handling", () => {
  // Shape verified in node_modules/@paypal/agent-toolkit/ai-sdk: the error class has ok = false and
  // toJSON() returns { ok, status, code, message }. There is no `error` key.
  it("throws when a tool returns the serialized { ok: false, status, code, message }", async () => {
    tools.create_invoice = {
      execute: async () => JSON.stringify({ ok: false, status: 422, code: "PAYPAL_TOOL_ERROR", message: "Invalid recipient" }),
    };
    const err = (await toolkit.callToolkitTool("create_invoice", {}).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(toolkit.ToolkitError);
    expect(err.message).toContain("Invalid recipient");
    expect(err.message).toContain("PAYPAL_TOOL_ERROR");
  });

  it("also throws when the tool returns the error object itself, and for the older { error } shape", async () => {
    tools.send_invoice = { execute: async () => ({ ok: false, code: "X", message: "nope", status: 500 }) };
    await expect(toolkit.callToolkitTool("send_invoice", {})).rejects.toThrow(/nope/);
    tools.get_order = { execute: async () => JSON.stringify({ error: { message: "legacy failure" } }) };
    await expect(toolkit.callToolkitTool("get_order", {})).rejects.toThrow(/legacy failure/);
  });

  it("returns the parsed result for a success", async () => {
    tools.create_invoice = { execute: async () => JSON.stringify({ id: "INV2-OK", href: "x" }) };
    await expect(toolkit.callToolkitTool("create_invoice", {})).resolves.toMatchObject({ id: "INV2-OK" });
  });

  it("an invoice failure surfaces from createAndSendOverageInvoice instead of looking sent", async () => {
    tools.create_invoice = { execute: async () => JSON.stringify({ ok: false, status: 400, code: "C", message: "bad" }) };
    tools.send_invoice = { execute: vi.fn(async () => JSON.stringify({ ok: true })) };
    await expect(
      toolkit.createAndSendOverageInvoice({ rentalId: "r", itemName: "i", currency: "USD", overageCents: 100, recipientEmail: "a@b.co" }),
    ).rejects.toBeInstanceOf(toolkit.ToolkitError);
    expect(tools.send_invoice!.execute).not.toHaveBeenCalled();
  });
});

describe("webhook verification keeps the raw body", () => {
  it("splices the original event text into the verify request, byte for byte", async () => {
    const raw = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"10.10"},"note":"caf\\u00e9","big":1.0e2}}\n';
    let sent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
        sent = String(init?.body);
        return new Response(JSON.stringify({ verification_status: "SUCCESS" }));
      }),
    );
    const ok = await client.verifyWebhookSignature({
      authAlgo: "SHA256withRSA",
      certUrl: "https://api.paypal.com/cert.pem",
      transmissionId: "tid",
      transmissionSig: "sig",
      transmissionTime: "2026-11-10T00:00:00Z",
      webhookId: "WH",
      webhookEventRaw: raw,
    });
    expect(ok).toBe(true);
    expect(sent).toContain(`"webhook_event":${raw}}`); // identical text, not JSON.stringify(JSON.parse(raw))
    expect(sent).not.toBe(JSON.stringify(JSON.parse(sent))); // proves we did not re-serialize the whole thing
    const parsed = JSON.parse(sent);
    expect(parsed).toMatchObject({ auth_algo: "SHA256withRSA", transmission_id: "tid", webhook_id: "WH" });
    expect(parsed.webhook_event.resource.amount.value).toBe("10.10");
  });
});
