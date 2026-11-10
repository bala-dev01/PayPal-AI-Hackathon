import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("./paypal/toolkit", () => ({
  createAndSendOverageInvoice: async () => "INV2-TEST-0001",
  ToolkitError: class ToolkitError extends Error {},
}));

let db: typeof import("./db");
let settle: typeof import("./settlement");
let client: typeof import("./paypal/client");

type Route = { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
let calls: { method: string; url: string; headers: Record<string, string> }[];
let voidFails: boolean;
let captureFails: boolean;

function installFetch() {
  calls = [];
  voidFails = false;
  captureFails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string> });
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (url.endsWith("/v1/oauth2/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (method === "POST" && url.endsWith("/v2/checkout/orders")) return json({ id: "ORD-NEW", status: "CREATED" }, 201);
      if (url.endsWith("/authorize")) {
        return json({
          id: "ORD-NEW",
          status: "COMPLETED",
          payer: { email_address: "renter@example.com" },
          purchase_units: [
            { payments: { authorizations: [{ id: "AUTH-NEW", status: "CREATED", amount: { currency_code: "USD", value: "90.00" } }] } },
          ],
        });
      }
      if (method === "GET" && url.includes("/v2/payments/authorizations/")) {
        return json({ id: "AUTH1", status: "CREATED", amount: { currency_code: "USD", value: "90.00" } });
      }
      if (url.endsWith("/capture")) {
        if (captureFails) return json({ name: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
        return json({ id: "CAP1", status: "COMPLETED" }, 201);
      }
      if (url.endsWith("/void")) {
        if (voidFails) return json({ name: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
        return new Response(null, { status: 204 });
      }
      return json({ name: "NOT_FOUND" }, 404);
    }),
  );
}
const countOf = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix)).length;
const post = (route: Route, id: string, headers: Record<string, string> = {}, body: unknown = {}) =>
  route.POST(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

function newRental(extra: Parameters<typeof db.updateRental>[1] = {}) {
  const created = db.createRentalWithToken({
    item_name: "Drill",
    daily_rate_cents: 2000,
    days: 2,
    deposit_cents: 5000,
    replacement_cents: 30000,
    purchase_year: new Date().getUTCFullYear(),
  });
  if (Object.keys(extra).length) db.updateRental(created.rental.id, extra);
  return created;
}

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  db = await import("./db");
  client = await import("./paypal/client");
  settle = await import("./settlement");
});
beforeEach(() => {
  client.resetTokenCache();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("hold nonce", () => {
  it("an attacker with the rental id and the public order id cannot authorize or get the renter token", async () => {
    const { rental } = newRental();
    const id = rental.id;
    const order = (await import("../app/api/rentals/[id]/hold/order/route")) as Route;
    const authorize = (await import("../app/api/rentals/[id]/hold/authorize/route")) as Route;
    const get = await import("../app/api/rentals/[id]/route");

    const created = await (await post(order, id)).json();
    expect(created.orderId).toBe("ORD-NEW");
    expect(typeof created.holdNonce).toBe("string");

    // Everything an attacker can read from the public link.
    const publicText = JSON.stringify(await (await get.GET(new Request("http://x"), { params: Promise.resolve({ id }) })).json());
    expect(publicText).not.toContain("ORD-NEW");
    expect(publicText).not.toContain(created.holdNonce);

    for (const attempt of [
      { orderId: "ORD-NEW", holdNonce: "guess" },
      { orderId: "ORD-NEW", holdNonce: "ORD-NEW" },
      { orderId: "ORD-NEW", holdNonce: id },
    ]) {
      const res = await post(authorize, id, {}, attempt);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain("renterToken");
    }
    expect((await post(authorize, id, {}, { orderId: "ORD-NEW" })).status).toBe(400); // nonce is required
    expect(countOf("/authorize")).toBe(0); // PayPal was never asked
    expect(db.getRental(id)?.status).toBe("draft");

    // The real browser, holding the nonce, succeeds exactly once.
    const ok = await post(authorize, id, {}, { orderId: "ORD-NEW", holdNonce: created.holdNonce });
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(typeof okBody.renterToken).toBe("string");
    expect(db.getRental(id)?.status).toBe("held");
    expect((await post(authorize, id, {}, { orderId: "ORD-NEW", holdNonce: created.holdNonce })).status).toBe(403);
    expect(JSON.stringify(okBody)).not.toContain("ORD-NEW");
  });

  it("the order id is only written while the rental is a draft; otherwise 409", async () => {
    const { rental } = newRental();
    expect(db.setHoldOrderIfDraft(rental.id, "ORD-A", "n1")).toBe(true);
    db.updateRental(rental.id, { status: "held" });
    expect(db.setHoldOrderIfDraft(rental.id, "ORD-B", "n2")).toBe(false);
    expect(db.getPayPalOrderId(rental.id)).toBe("ORD-A");
    expect(db.verifyHoldNonce(rental.id, "n1")).toBe(true);
    expect(db.verifyHoldNonce(rental.id, "n2")).toBe(false);

    const order = (await import("../app/api/rentals/[id]/hold/order/route")) as Route;
    const res = await post(order, rental.id);
    expect(res.status).toBe(409);
    expect(db.getPayPalOrderId(rental.id)).toBe("ORD-A");
  });

  it("the route returns 409 when the rental stops being a draft while PayPal creates the order", async () => {
    const { rental } = newRental();
    const order = (await import("../app/api/rentals/[id]/hold/order/route")) as Route;
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url.endsWith("/v2/checkout/orders")) db.updateRental(rental.id, { status: "held" });
        return original(url, init);
      }),
    );
    const res = await post(order, rental.id);
    expect(res.status).toBe(409);
    expect(db.getPayPalOrderId(rental.id)).toBeNull();
  });
});

describe("owner release", () => {
  const heldRental = (status: "held" | "picked_up" | "returned" = "held") => {
    const c = newRental({ status, paypal_authorization_id: "AUTH1", authorized_cents: 9000 });
    db.setRenterToken(c.rental.id, "renter-secret");
    return c;
  };

  it("voids the authorization, ends the rental as released, and records an event", async () => {
    const release = (await import("../app/api/rentals/[id]/release/route")) as Route;
    for (const status of ["held", "picked_up", "returned"] as const) {
      const c = heldRental(status);
      const res = await post(release, c.rental.id, { "x-owner-token": c.ownerToken });
      expect(res.status).toBe(200);
      const r = db.getRental(c.rental.id)!;
      expect(r.status).toBe("released");
      expect(r.captured_cents).toBe(0);
      expect(r.released_cents).toBe(9000);
      expect(db.listEvents(c.rental.id).some((e) => e.type === "hold_released_by_owner")).toBe(true);
      expect((await post(release, c.rental.id, { "x-owner-token": c.ownerToken })).status).toBe(409); // not twice
    }
    expect(countOf("/void")).toBe(3);
    expect(countOf("/capture")).toBe(0);
  });

  it("a stranded `returned` rental can be released, but a running inspection cannot be raced", async () => {
    const release = (await import("../app/api/rentals/[id]/release/route")) as Route;
    const c = heldRental();
    db.updateRental(c.rental.id, { status: "returned" });
    // The inspection claims the rental first: the release must lose without voiding anything.
    expect(db.claimStatus(c.rental.id, ["returned"], "inspecting")).toBe(true);
    expect((await post(release, c.rental.id, { "x-owner-token": c.ownerToken })).status).toBe(409);
    expect(db.getRental(c.rental.id)?.status).toBe("inspecting");
    expect(countOf("/void")).toBe(0);
    // Once released, an inspection claim from `returned` can no longer win.
    const d = heldRental();
    db.updateRental(d.rental.id, { status: "returned" });
    expect((await post(release, d.rental.id, { "x-owner-token": d.ownerToken })).status).toBe(200);
    expect(db.claimStatus(d.rental.id, ["returned"], "inspecting")).toBe(false);
    expect(db.getRental(d.rental.id)?.status).toBe("released");
  });

  it("rejects the renter token, a wrong token and no token, and moves nothing", async () => {
    const release = (await import("../app/api/rentals/[id]/release/route")) as Route;
    const c = heldRental();
    expect((await post(release, c.rental.id)).status).toBe(401);
    expect((await post(release, c.rental.id, { "x-renter-token": "renter-secret" })).status).toBe(401);
    expect((await post(release, c.rental.id, { "x-owner-token": "wrong" })).status).toBe(401);
    expect(countOf("/void")).toBe(0);
    expect(db.getRental(c.rental.id)?.status).toBe("held");
  });

  it("is refused once return, inspection or settlement has begun", async () => {
    const release = (await import("../app/api/rentals/[id]/release/route")) as Route;
    for (const status of ["inspecting", "verdict_ready", "contested", "settling", "settled", "failed", "draft"] as const) {
      const c = heldRental();
      db.updateRental(c.rental.id, { status });
      expect((await post(release, c.rental.id, { "x-owner-token": c.ownerToken })).status).toBe(409);
      expect(db.getRental(c.rental.id)?.status).toBe(status);
    }
    expect(countOf("/void")).toBe(0);
  });

  it("is refused after a real settlement has run", async () => {
    const release = (await import("../app/api/rentals/[id]/release/route")) as Route;
    const c = heldRental();
    db.updateRental(c.rental.id, { status: "verdict_ready" });
    db.saveInspection({ rental_id: c.rental.id, photo_hash: "h", findings: [], summary: "", model: "t" });
    await settle.settleRental(c.rental.id, { kind: "renter_accepted" });
    const voidsBefore = countOf("/void");
    expect((await post(release, c.rental.id, { "x-owner-token": c.ownerToken })).status).toBe(409);
    expect(countOf("/void")).toBe(voidsBefore);
    expect(db.getRental(c.rental.id)?.status).toBe("settled");
  });

  it("puts the status back when PayPal fails to void", async () => {
    const release = (await import("../app/api/rentals/[id]/release/route")) as Route;
    const c = heldRental("picked_up");
    voidFails = true;
    expect((await post(release, c.rental.id, { "x-owner-token": c.ownerToken })).status).toBe(502);
    expect(db.getRental(c.rental.id)?.status).toBe("picked_up");
    expect(db.getRental(c.rental.id)?.released_cents).toBe(0);
  });
});

describe("stale settling", () => {
  const f: Finding = {
    id: "f1",
    angle: "front",
    title: "t",
    description: "",
    classification: "new_damage",
    severity: "minor",
    confidence: 0.95,
    region_before: null,
    region_after: null,
  };

  it("a settling rental older than 5 minutes becomes failed and retries safely with the same request id", async () => {
    const c = newRental({ status: "verdict_ready", paypal_authorization_id: "AUTH1", authorized_cents: 9000 });
    const id = c.rental.id;
    db.saveInspection({ rental_id: id, photo_hash: "h", findings: [f], summary: "", model: "t" });
    captureFails = true;
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow();
    const requestId = db.getSettlementPrivate(id).quote!.requestId;
    captureFails = false;

    // Simulate a crash: stuck in settling, last touched long ago.
    db.updateRental(id, { status: "settling" });
    expect(settle.recoverStaleSettling(id)).toBe(false); // fresh: left alone
    expect(db.getRental(id)?.status).toBe("settling");
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    db.getDb().prepare("UPDATE rentals SET updated_at = ? WHERE id = ?").run(old, id);

    const get = await import("../app/api/rentals/[id]/route");
    const body = await (await get.GET(new Request("http://x"), { params: Promise.resolve({ id }) })).json();
    expect(body.rental.status).toBe("failed"); // converted on read, so the retry control shows

    db.updateRental(id, { status: "settling" });
    db.getDb().prepare("UPDATE rentals SET updated_at = ? WHERE id = ?").run(old, id);
    const done = await settle.retrySettlement(id, "renter_accepted"); // converts at retry too
    expect(done.status).toBe("settled");
    const cap = calls.filter((c2) => c2.url.endsWith("/capture")).pop()!;
    expect(cap.headers["PayPal-Request-Id"]).toBe(`${requestId}-cap`);
  });
});
