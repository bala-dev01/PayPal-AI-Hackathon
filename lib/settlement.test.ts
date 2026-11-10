import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "./types";

vi.mock("server-only", () => ({}));
const invoiceMock = vi.fn(async (_i: { overageCents: number }) => "INV2-TEST-0001");
vi.mock("./paypal/toolkit", () => ({
  createAndSendOverageInvoice: (i: { overageCents: number }) => invoiceMock(i),
  ToolkitError: class ToolkitError extends Error {},
}));

let db: typeof import("./db");
let settle: typeof import("./settlement");
let client: typeof import("./paypal/client");

const YEAR = new Date().getUTCFullYear();

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}
let calls: Call[];
let holdValue: string; // what PayPal reports for the authorization
let captureFails: boolean;
/** What PayPal reports for the authorization's status, and whether a capture really went through there. */
let authStatus: string;
let serverCaptureCents: number | null;
/** When true the capture is recorded at PayPal but the HTTP response is lost (a 500 reaches us). */
let loseCaptureResponse: boolean;

function installFetch() {
  calls = [];
  holdValue = "90.00";
  captureFails = false;
  authStatus = "CREATED";
  serverCaptureCents = null;
  loseCaptureResponse = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const isToken = url.endsWith("/v1/oauth2/token");
      const body = init?.body && !isToken ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      const method = init?.method ?? "GET";
      calls.push({ method, url, headers, body });
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (url.endsWith("/v1/oauth2/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (method === "GET" && url.includes("/v2/payments/authorizations/")) {
        return json({ id: "AUTH1", status: authStatus, amount: { currency_code: "USD", value: holdValue } });
      }
      if (method === "GET" && url.includes("/v2/checkout/orders/")) {
        const captures =
          serverCaptureCents === null
            ? []
            : [{ id: "CAP-LOST", status: "COMPLETED", amount: { currency_code: "USD", value: (serverCaptureCents / 100).toFixed(2) } }];
        return json({ id: "ORD1", status: "COMPLETED", purchase_units: [{ payments: { captures } }] });
      }
      if (url.endsWith("/capture")) {
        if (loseCaptureResponse) {
          serverCaptureCents = Math.round(Number((body as { amount: { value: string } }).amount.value) * 100);
          authStatus = "CAPTURED";
          return json({ name: "INTERNAL_SERVER_ERROR", message: "response lost", debug_id: "dbg2" }, 500);
        }
        if (captureFails) return json({ name: "INTERNAL_SERVER_ERROR", message: "boom", debug_id: "dbg1" }, 500);
        return json({ id: "CAP1", status: "COMPLETED" }, 201);
      }
      if (url.endsWith("/void")) return new Response(null, { status: 204 });
      return json({ name: "NOT_FOUND" }, 404);
    }),
  );
}

const capCalls = () => calls.filter((c) => c.url.endsWith("/capture"));
const authReads = () => calls.filter((c) => c.method === "GET" && c.url.includes("/v2/payments/authorizations/")).length;

function finding(id: string, severity: Finding["severity"], over: Partial<Finding> = {}): Finding {
  return {
    id,
    angle: "front",
    title: `Finding ${id}`,
    description: "",
    classification: "new_damage",
    severity,
    confidence: 0.95,
    region_before: null,
    region_after: null,
    ...over,
  };
}

/** Fee 4000 (2 x 2000), deposit 5000, hold 9000, base value 30000. */
function makeRental(findings: Finding[], status: "verdict_ready" | "contested" = "verdict_ready") {
  const r = db.createRental({
    item_name: "Test drill",
    daily_rate_cents: 2000,
    days: 2,
    deposit_cents: 5000,
    replacement_cents: 30000,
    purchase_year: YEAR,
  });
  db.updateRental(r.id, {
    status,
    paypal_order_id: "ORD1",
    paypal_authorization_id: "AUTH1",
    authorized_cents: 9000,
  });
  db.setSettlementPrivate(r.id, { payerEmail: "renter@example.com" });
  db.saveInspection({ rental_id: r.id, photo_hash: `h-${r.id}`, findings, summary: "", model: "test" });
  return r.id;
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
  invoiceMock.mockClear();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("settlement guards", () => {
  it("settles once: a double settle captures a single time", async () => {
    const id = makeRental([finding("f1", "moderate")]);
    const results = await Promise.allSettled([
      settle.settleRental(id, { kind: "renter_accepted" }),
      settle.settleRental(id, { kind: "renter_accepted" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(settle.SettlementError);
    expect(capCalls()).toHaveLength(1);
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow(/already settled/);
    expect(capCalls()).toHaveLength(1);
    expect(db.getRental(id)?.status).toBe("settled");
  });

  it("never captures above the authorized hold, even for total loss", async () => {
    const id = makeRental([finding("f1", "destroyed")]);
    await settle.settleRental(id, { kind: "renter_accepted" });
    const body = capCalls()[0]!.body as { amount: { value: string }; final_capture: boolean };
    expect(Number(body.amount.value) * 100).toBeLessThanOrEqual(9000);
    expect(body.amount.value).toBe("90.00");
    expect(body.final_capture).toBe(true);
    expect(db.getRental(id)?.captured_cents).toBe(9000);
    expect(db.getRental(id)?.released_cents).toBe(0);
  });

  it("refuses to capture when PayPal reports a smaller hold than recorded", async () => {
    const id = makeRental([finding("f1", "destroyed")]);
    holdValue = "30.00";
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow(/exceed the authorized hold/);
    expect(capCalls()).toHaveLength(0);
    expect(db.getRental(id)?.status).toBe("failed");
  });

  it("rejects settlement from the wrong state or the wrong authority", async () => {
    const contested = makeRental([finding("f1", "minor")], "contested");
    await expect(settle.settleRental(contested, { kind: "renter_accepted" })).rejects.toThrow(/cannot be accepted/);
    const fresh = makeRental([finding("f1", "minor")], "verdict_ready");
    await expect(
      settle.settleRental(fresh, { kind: "owner_approved", excludeFindingIds: [] }),
    ).rejects.toThrow(/only approve a contested/);
    expect(capCalls()).toHaveLength(0);
  });

  it("approve route without a valid owner token is 401 and moves no money", async () => {
    const created = db.createRentalWithToken({
      item_name: "x",
      daily_rate_cents: 1000,
      days: 1,
      deposit_cents: 1000,
      replacement_cents: 10000,
    });
    db.updateRental(created.rental.id, { status: "contested", paypal_authorization_id: "AUTH1", authorized_cents: 2000 });
    const route = await import("../app/api/rentals/[id]/settlement/approve/route");
    const call = (headers: Record<string, string>) =>
      route.POST(
        new Request("http://x/api", { method: "POST", headers, body: JSON.stringify({ excludeFindingIds: [] }) }),
        { params: Promise.resolve({ id: created.rental.id }) },
      );
    expect((await call({})).status).toBe(401);
    expect((await call({ "x-owner-token": "wrong" })).status).toBe(401);
    expect(capCalls()).toHaveLength(0);
    expect(db.getRental(created.rental.id)?.status).toBe("contested");
  });

  it("read results never contain the owner token", () => {
    const created = db.createRentalWithToken({
      item_name: "x",
      daily_rate_cents: 1,
      days: 1,
      deposit_cents: 1,
      replacement_cents: 1,
    });
    const asText = JSON.stringify([db.getRental(created.rental.id), db.listRentals()]);
    expect(asText).not.toContain(created.ownerToken);
    expect(asText).not.toContain("owner_token");
    expect(db.verifyOwnerToken(created.rental.id, created.ownerToken)).toBe(true);
    expect(db.verifyOwnerToken(created.rental.id, "nope")).toBe(false);
  });
});

describe("owner approval can only lower the charge", () => {
  it("rejects any attempt to send an amount, and unknown finding ids", async () => {
    const id = makeRental([finding("f1", "major")], "contested");
    const route = await import("../app/api/rentals/[id]/settlement/approve/route");
    const token = db.createRentalWithToken({
      item_name: "t",
      daily_rate_cents: 1,
      days: 1,
      deposit_cents: 1,
      replacement_cents: 1,
    });
    void token;
    // Direct: unknown id is a 400-class error and nothing is captured.
    await expect(settle.settleRental(id, { kind: "owner_approved", excludeFindingIds: ["nope"] })).rejects.toThrow(/Unknown finding/);
    expect(capCalls()).toHaveLength(0);
    expect(route.POST).toBeTypeOf("function");
  });

  it("excluding a finding reduces the capture; the full quote is the ceiling", async () => {
    const findings = [finding("f1", "major"), finding("f2", "moderate")];
    const full = settle.quoteSettlement(db.getRental(makeRental(findings))!, findings);
    const id = makeRental(findings, "contested");
    await settle.settleRental(id, { kind: "owner_approved", excludeFindingIds: ["f1"] });
    const captured = db.getRental(id)!.captured_cents;
    expect(captured).toBeLessThan(full.captureTotalCents);
    // fee 4000 + moderate 12% of 30000 = 3600
    expect(captured).toBe(7600);
  });

  it("the approve route schema is strict, so an amount field is a 400", async () => {
    const created = db.createRentalWithToken({
      item_name: "x",
      daily_rate_cents: 1000,
      days: 1,
      deposit_cents: 1000,
      replacement_cents: 10000,
    });
    db.updateRental(created.rental.id, { status: "contested", paypal_authorization_id: "AUTH1", authorized_cents: 2000 });
    const route = await import("../app/api/rentals/[id]/settlement/approve/route");
    const res = await route.POST(
      new Request("http://x/api", {
        method: "POST",
        headers: { "x-owner-token": created.ownerToken },
        body: JSON.stringify({ excludeFindingIds: [], amountCents: 999999 }),
      }),
      { params: Promise.resolve({ id: created.rental.id }) },
    );
    expect(res.status).toBe(400);
    expect(capCalls()).toHaveLength(0);
  });
});

describe("settlement amounts", () => {
  it("zero damage still captures the rental fee and releases the whole deposit", async () => {
    const id = makeRental([]);
    await settle.settleRental(id, { kind: "renter_accepted" });
    const r = db.getRental(id)!;
    expect(r.captured_cents).toBe(4000);
    expect(r.released_cents).toBe(5000);
    expect(r.paypal_capture_id).toBe("CAP1");
    expect(r.status).toBe("settled");
    const body = capCalls()[0]!.body as { amount: { value: string }; final_capture: boolean };
    expect(body.amount.value).toBe("40.00");
    expect(body.final_capture).toBe(true);
    expect(invoiceMock).not.toHaveBeenCalled();
    expect(db.listEvents(id).map((e) => e.type)).toContain("capture_completed");
  });

  it("benefit of the doubt: low-confidence and pre-existing findings cost nothing", async () => {
    const id = makeRental([
      finding("a", "major", { confidence: 0.6 }),
      finding("b", "major", { classification: "pre_existing" }),
    ]);
    await settle.settleRental(id, { kind: "renter_accepted" });
    expect(db.getRental(id)!.captured_cents).toBe(4000);
  });

  it("damage above the deposit is captured up to the hold and the overage is invoiced", async () => {
    const id = makeRental([finding("f1", "destroyed")]);
    await settle.settleRental(id, { kind: "renter_accepted" });
    const r = db.getRental(id)!;
    expect(r.captured_cents).toBe(9000);
    expect(r.released_cents).toBe(0);
    expect(invoiceMock).toHaveBeenCalledTimes(1);
    // base 30000 destroyed = 30000, deposit 5000 captured, overage 25000
    expect(invoiceMock.mock.calls[0]![0].overageCents).toBe(25000);
    expect(r.overage_invoice_id).toBe("INV2-TEST-0001");
    expect(db.listEvents(id).map((e) => e.type)).toContain("overage_invoice_sent");
  });

  it("a failed PayPal call leaves a failed state with an event, and retry reuses the request id", async () => {
    const id = makeRental([finding("f1", "moderate")]);
    captureFails = true;
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow(/retried safely/);
    expect(db.getRental(id)?.status).toBe("failed");
    expect(db.getRental(id)?.captured_cents).toBe(0);
    expect(db.listEvents(id).map((e) => e.type)).toContain("settlement_failed");

    // Only the original authority may retry.
    await expect(settle.retrySettlement(id, "owner_approved")).rejects.toThrow(/retried by whoever/);
    // Accept/approve themselves no longer restart a failed settlement; retry is the only way.
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow(/retry/i);

    captureFails = false;
    await settle.retrySettlement(id, "renter_accepted");
    expect(db.getRental(id)?.status).toBe("settled");
    const ids = capCalls().map((c) => c.headers["PayPal-Request-Id"]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBeTruthy();
  });
});

type RouteLike = { POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };

describe("safe retry", () => {
  it("never sends invoice_id on capture (PayPal needs it unique per merchant)", async () => {
    const id = makeRental([finding("f1", "minor")]);
    await settle.settleRental(id, { kind: "renter_accepted" });
    expect(capCalls()[0]!.body).not.toHaveProperty("invoice_id");
  });

  it("capture succeeded but the response was lost: retry adopts the capture and never recaptures", async () => {
    const id = makeRental([finding("f1", "moderate")]);
    loseCaptureResponse = true;
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow(/retried safely/);
    expect(db.getRental(id)?.status).toBe("failed");
    expect(capCalls()).toHaveLength(1);

    loseCaptureResponse = false;
    const done = await settle.retrySettlement(id, "renter_accepted");
    expect(capCalls()).toHaveLength(1); // no second capture, so no 409 and no double charge
    expect(done.status).toBe("settled");
    expect(done.paypal_capture_id).toBe("CAP-LOST");
    expect(done.captured_cents).toBe(7600); // fee 4000 + moderate 3600
    expect(done.released_cents).toBe(1400);
    const capEvent = db.listEvents(id).find((e) => e.type === "capture_completed");
    expect(capEvent?.payload.recoveredFromLostResponse).toBe(true);
  });

  it("retry after a real capture failure resends the same request id and the frozen amount", async () => {
    const findings = [finding("f1", "major"), finding("f2", "moderate")];
    const id = makeRental(findings, "contested");
    captureFails = true;
    await expect(settle.settleRental(id, { kind: "owner_approved", excludeFindingIds: ["f1"] })).rejects.toThrow(/retried safely/);
    // The inspection changes behind our back. The frozen quote must not follow it.
    db.saveInspection({ rental_id: id, photo_hash: "other", findings: [finding("f1", "destroyed")], summary: "", model: "t" });
    captureFails = false;
    const done = await settle.retrySettlement(id, "owner_approved");
    expect(done.captured_cents).toBe(7600);
    const [a, b] = capCalls();
    expect(a!.headers["PayPal-Request-Id"]).toBe(b!.headers["PayPal-Request-Id"]);
    expect(a!.body).toEqual(b!.body);
    expect(db.getSettlementPrivate(id).excludedFindingIds).toEqual(["f1"]);
    expect(db.getSettlementPrivate(id).quote?.findings.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("invoice failure after a successful capture resumes at the invoice and never recaptures", async () => {
    const id = makeRental([finding("f1", "destroyed")]);
    invoiceMock.mockRejectedValueOnce(new Error("invoice service down"));
    await expect(settle.settleRental(id, { kind: "renter_accepted" })).rejects.toThrow(/overage_invoice/);
    const failed = db.getRental(id)!;
    expect(failed.status).toBe("failed");
    expect(failed.captured_cents).toBe(9000);
    expect(failed.paypal_capture_id).toBe("CAP1");
    expect(capCalls()).toHaveLength(1);

    const done = await settle.retrySettlement(id, "renter_accepted");
    expect(capCalls()).toHaveLength(1);
    expect(authReads()).toBe(1); // the retry did not even look at the authorization again
    expect(invoiceMock).toHaveBeenCalledTimes(2);
    expect(done.status).toBe("settled");
    expect(done.captured_cents).toBe(9000);
  });

  it("a lost void response (zero charge) is treated as done on retry", async () => {
    const r = db.createRental({ item_name: "Free loan", daily_rate_cents: 0, days: 1, deposit_cents: 5000, replacement_cents: 30000, purchase_year: YEAR });
    db.updateRental(r.id, { status: "verdict_ready", paypal_order_id: "ORD1", paypal_authorization_id: "AUTH1", authorized_cents: 5000 });
    db.saveInspection({ rental_id: r.id, photo_hash: `h-${r.id}`, findings: [], summary: "", model: "t" });
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/void") && authStatus !== "VOIDED") {
          authStatus = "VOIDED"; // PayPal voided it, but the response never reached us
          return new Response(JSON.stringify({ name: "INTERNAL_SERVER_ERROR", message: "lost" }), { status: 500 });
        }
        return original(url, init);
      }),
    );
    await expect(settle.settleRental(r.id, { kind: "renter_accepted" })).rejects.toThrow(/retried safely/);
    const done = await settle.retrySettlement(r.id, "renter_accepted");
    expect(done.status).toBe("settled");
    expect(done.captured_cents).toBe(0);
    expect(done.released_cents).toBe(5000);
  });

  it("an owner token cannot accept for the renter, and retry needs the original authority", async () => {
    const created = db.createRentalWithToken({ item_name: "x", daily_rate_cents: 2000, days: 2, deposit_cents: 5000, replacement_cents: 30000, purchase_year: YEAR });
    const id = created.rental.id;
    db.updateRental(id, { status: "verdict_ready", paypal_order_id: "ORD1", paypal_authorization_id: "AUTH1", authorized_cents: 9000 });
    db.setRenterToken(id, "renter-secret");
    db.saveInspection({ rental_id: id, photo_hash: `h-${id}`, findings: [finding("f1", "minor")], summary: "", model: "t" });
    const accept = (await import("../app/api/rentals/[id]/settlement/accept/route")) as RouteLike;
    const retry = (await import("../app/api/rentals/[id]/settlement/retry/route")) as RouteLike;
    const call = (route: RouteLike, headers: Record<string, string>) =>
      route.POST(new Request("http://x/api", { method: "POST", headers }), { params: Promise.resolve({ id }) });

    expect((await call(accept, {})).status).toBe(401);
    expect((await call(accept, { "x-owner-token": created.ownerToken })).status).toBe(401);
    expect((await call(accept, { "x-renter-token": "wrong" })).status).toBe(401);
    expect(capCalls()).toHaveLength(0);
    expect(db.getRental(id)?.status).toBe("verdict_ready");

    captureFails = true;
    expect((await call(accept, { "x-renter-token": "renter-secret" })).status).toBe(502);
    expect(db.getRental(id)?.status).toBe("failed");
    captureFails = false;
    expect((await call(retry, {})).status).toBe(401);
    expect((await call(retry, { "x-owner-token": created.ownerToken })).status).toBe(401);
    expect(db.getRental(id)?.status).toBe("failed");
    const ok = await call(retry, { "x-renter-token": "renter-secret" });
    expect(ok.status).toBe(200);
    expect(db.getRental(id)?.status).toBe("settled");
  });

  it("contest needs the renter token too", async () => {
    const created = db.createRentalWithToken({ item_name: "x", daily_rate_cents: 1, days: 1, deposit_cents: 1, replacement_cents: 1 });
    const id = created.rental.id;
    db.updateRental(id, { status: "verdict_ready" });
    db.setRenterToken(id, "renter-secret");
    const contest = (await import("../app/api/rentals/[id]/settlement/contest/route")) as RouteLike;
    const call = (headers: Record<string, string>) =>
      contest.POST(new Request("http://x", { method: "POST", headers, body: JSON.stringify({ note: "not mine" }) }), { params: Promise.resolve({ id }) });
    expect((await call({})).status).toBe(401);
    expect((await call({ "x-owner-token": created.ownerToken })).status).toBe(401);
    expect(db.getRental(id)?.status).toBe("verdict_ready");
    expect((await call({ "x-renter-token": "renter-secret" })).status).toBe(200);
    expect(db.getRental(id)?.status).toBe("contested");
  });

  it("rental GET exposes settlementAuthority and captureTotalCents, never a token", async () => {
    const created = db.createRentalWithToken({ item_name: "x", daily_rate_cents: 2000, days: 2, deposit_cents: 5000, replacement_cents: 30000, purchase_year: YEAR });
    const id = created.rental.id;
    db.updateRental(id, { status: "verdict_ready", paypal_order_id: "ORD1", paypal_authorization_id: "AUTH1", authorized_cents: 9000 });
    db.setRenterToken(id, "renter-secret");
    db.saveInspection({ rental_id: id, photo_hash: `h-${id}`, findings: [finding("f1", "minor")], summary: "", model: "t" });
    const get = await import("../app/api/rentals/[id]/route");
    const read = async () => (await get.GET(new Request("http://x"), { params: Promise.resolve({ id }) })).json();
    let body = await read();
    expect(body.settlementAuthority).toBeNull();
    expect(body.settlement.captureTotalCents).toBe(4000 + 900);
    expect(body.settlement).not.toHaveProperty("captureCents");
    await settle.settleRental(id, { kind: "renter_accepted" });
    body = await read();
    expect(body.settlementAuthority).toBe("renter");
    const text = JSON.stringify(body);
    expect(text).not.toContain("renter-secret");
    expect(text).not.toContain(created.ownerToken);
    expect(text).not.toContain("renter_token");
  });
});

describe("rental list scoping and creation limits", () => {
  it("GET /api/rentals returns samples plus only the rentals whose owner tokens are sent", async () => {
    const a = db.createRentalWithToken({ item_name: "A", daily_rate_cents: 1, days: 1, deposit_cents: 1, replacement_cents: 1 });
    const b = db.createRentalWithToken({ item_name: "B", daily_rate_cents: 1, days: 1, deposit_cents: 1, replacement_cents: 1 });
    db.updateRental(a.rental.id, { status: "held", authorized_cents: 700 });
    db.updateRental(b.rental.id, { status: "held", authorized_cents: 5000 });
    const list = await import("../app/api/rentals/route");
    const get = async (tokens?: string) =>
      (await list.GET(new Request("http://x", { headers: tokens ? { "x-owner-tokens": tokens } : {} }))).json();

    const none = await get();
    expect(none.rentals.every((r: { is_sample: boolean }) => r.is_sample)).toBe(true);
    expect(none.rentals.length).toBeGreaterThan(0);
    expect(none.totals.heldCents).toBe(0);

    const onlyA = await get(`${a.ownerToken}, bogus`);
    const ids = onlyA.rentals.map((r: { id: string }) => r.id);
    expect(ids).toContain(a.rental.id);
    expect(ids).not.toContain(b.rental.id);
    expect(onlyA.totals.heldCents).toBe(700);
    expect(JSON.stringify(onlyA)).not.toContain(a.ownerToken);

    const both = await get(`${a.ownerToken},${b.ownerToken}`);
    expect(both.totals.heldCents).toBe(5700);
  });

  it("rejects rentals longer than 3 days with a clear message", async () => {
    const route = await import("../app/api/rentals/route");
    const make = (days: number) =>
      route.POST(
        new Request("http://x", {
          method: "POST",
          body: JSON.stringify({ itemName: "Drill", dailyRateCents: 1000, days, depositCents: 1000, replacementCents: 5000 }),
        }),
      );
    const bad = await make(4);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/days.*3 days or fewer.*PayPal/);
    expect((await make(3)).status).toBe(201);
  });

  it("a sample rental's hold order is a 409 with a clear message", async () => {
    const order = (await import("../app/api/rentals/[id]/hold/order/route")) as unknown as RouteLike;
    const sample = db.listRentals().find((r) => r.is_sample)!;
    const res = await order.POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: sample.id }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/sample rental/i);
  });
});
