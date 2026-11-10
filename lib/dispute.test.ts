import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/paypal/client", () => ({ verifyWebhookSignature: vi.fn(async () => true) }));

let repo: typeof import("./db/repo");
let webhook: typeof import("@/app/api/webhooks/paypal/route");
let rentalRoute: typeof import("@/app/api/rentals/[id]/route");
let derive: typeof import("./dispute");

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  repo = await import("./db/repo");
  webhook = await import("@/app/api/webhooks/paypal/route");
  rentalRoute = await import("@/app/api/rentals/[id]/route");
  derive = await import("./dispute");
});

function makeRental() {
  const { rental, ownerToken } = repo.createRentalWithToken({
    item_name: "Test camera",
    daily_rate_cents: 2000,
    days: 1,
    deposit_cents: 5000,
    replacement_cents: 60000,
  });
  repo.updateRental(rental.id, { status: "settled", paypal_capture_id: `CAP-${rental.id}`, paypal_authorization_id: `AUTH-${rental.id}` });
  return { id: rental.id, ownerToken };
}

function post(eventId: string, resource: Record<string, unknown>) {
  return webhook.POST(
    new Request("http://localhost/api/webhooks/paypal", {
      method: "POST",
      headers: {
        "paypal-auth-algo": "a",
        "paypal-cert-url": "https://api.paypal.com/cert",
        "paypal-transmission-id": `tx-${eventId}`,
        "paypal-transmission-sig": "s",
        "paypal-transmission-time": "t",
      },
      body: JSON.stringify({ id: eventId, event_type: "CUSTOMER.DISPUTE.CREATED", summary: "A dispute was created", resource }),
    }),
  );
}

const dispute = (captureId: string, extra: Record<string, unknown> = {}) => ({
  dispute_id: "PP-D-1234",
  create_time: "2026-11-09T10:00:00.000Z",
  status: "OPEN",
  reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  disputed_transactions: [{ seller_transaction_id: captureId }],
  ...extra,
});

async function getBundle(id: string) {
  const res = await rentalRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
  return (await res.json()) as Record<string, unknown> & { paypalDispute: unknown };
}

describe("paypalDispute", () => {
  it("is null when no dispute was recorded", async () => {
    const { id } = makeRental();
    expect((await getBundle(id)).paypalDispute).toBeNull();
  });

  it("links a dispute to the rental through the capture id and exposes three fields", async () => {
    const { id } = makeRental();
    const res = await post("WH-1", dispute(`CAP-${id}`));
    expect((await res.json()).handled).toBe(true);
    const b = await getBundle(id);
    expect(b.paypalDispute).toEqual({ openedAt: "2026-11-09T10:00:00.000Z", disputeId: "PP-D-1234", status: "OPEN" });
  });

  it("does not invent a status PayPal did not send", async () => {
    const { id } = makeRental();
    await post("WH-2", dispute(`CAP-${id}`, { status: undefined }));
    expect(((await getBundle(id)).paypalDispute as { status: unknown }).status).toBeNull();
  });

  it("handles a duplicate delivery and a repeat under a new event id once", async () => {
    const { id } = makeRental();
    await post("WH-3", dispute(`CAP-${id}`));
    const again = await (await post("WH-3", dispute(`CAP-${id}`))).json();
    expect(again.duplicate).toBe(true);
    const renamed = await (await post("WH-3b", dispute(`CAP-${id}`))).json();
    expect(renamed.duplicate).toBe(true);
    expect(repo.listEvents(id).filter((e) => e.type === "webhook_dispute_created")).toHaveLength(1);
  });

  it("leaves an unmatched dispute unrecorded so a retry can still link it", async () => {
    const res = await (await post("WH-4", dispute("CAP-unknown"))).json();
    expect(res.handled).toBe(false);
    expect(repo.recordWebhookEvent("WH-4", "CUSTOMER.DISPUTE.CREATED", null)).toBe(true);
  });

  it("does not leak the owner token or private fields", async () => {
    const { id, ownerToken } = makeRental();
    repo.setSettlementPrivate(id, { payerEmail: "payer@example.com" });
    await post("WH-5", dispute(`CAP-${id}`));
    const b = await getBundle(id);
    expect(Object.keys(b.paypalDispute as object).sort()).toEqual(["disputeId", "openedAt", "status"]);
    const text = JSON.stringify(b);
    expect(text).not.toContain(ownerToken);
    expect(text).not.toContain("owner_token");
    expect(text).not.toContain("payer@example.com");
  });

  it("builds the Resolution Center link per environment", () => {
    expect(derive.resolutionCenterUrl("sandbox")).toBe("https://www.sandbox.paypal.com/resolutioncenter");
    expect(derive.resolutionCenterUrl("live")).toBe("https://www.paypal.com/resolutioncenter");
  });
});
