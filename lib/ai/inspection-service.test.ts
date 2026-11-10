import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { ALL_ANGLES, fakeClient, message, toolUse, validFinding } from "./testkit";

vi.mock("server-only", () => ({}));

type Svc = typeof import("./inspection-service");
type Db = typeof import("../db");
type Client = typeof import("./client");
type Rate = typeof import("./ratelimit");
type Inspect = typeof import("./inspect");

let svc: Svc;
let db: Db;
let client: Client;
let rate: Rate;
let inspect: Inspect;
const created: string[] = [];

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  process.env.DEMO_DAILY_INSPECTION_LIMIT = "100";
  delete process.env.ANTHROPIC_API_KEY;
  db = await import("../db");
  svc = await import("./inspection-service");
  client = await import("./client");
  rate = await import("./ratelimit");
  inspect = await import("./inspect");
});

afterAll(() => {
  for (const id of created) rmSync(path.join(db.UPLOADS_DIR, id), { recursive: true, force: true });
});

beforeEach(() => {
  svc.resetRunsForTests();
  rate.resetRateLimitsForTests();
  client.setClientForTests(null);
});

/** A returned rental with twelve distinct photos. `seed` picks the colors, so equal seeds mean identical files. */
async function makeRental(seed: number) {
  const rental = db.createRental({
    item_name: `Test item ${seed}`,
    daily_rate_cents: 1000,
    days: 1,
    deposit_cents: 5000,
    replacement_cents: 20000,
    status: "returned",
  });
  created.push(rental.id);
  mkdirSync(path.join(db.UPLOADS_DIR, rental.id), { recursive: true });
  let n = 0;
  for (const phase of ["pickup", "return"] as const) {
    for (const angle of ALL_ANGLES) {
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: seed, g: n * 10, b: phase === "pickup" ? 1 : 2 } } })
        .png()
        .toBuffer();
      n++;
      const rel = `${rental.id}/${phase}-${angle}.png`;
      writeFileSync(path.join(db.UPLOADS_DIR, rel), bytes);
      db.savePhoto({ rental_id: rental.id, phase, angle, path: rel });
    }
  }
  return rental;
}

const happyScript = (i: number) => {
  if (i === 0) return message([toolUse("get_rental_terms", {}), ...ALL_ANGLES.map((angle) => toolUse("view_angle_pair", { angle }))]);
  if (i === 1) return message([toolUse("record_finding", validFinding()), toolUse("finish_inspection", { summary: "One small dent at the front." })]);
  throw new Error("unexpected extra call");
};

function collect(res: ReturnType<Svc["openInspection"]>) {
  if (res.kind !== "stream") throw new Error(`expected a stream, got ${res.status} ${res.message}`);
  const events = [...res.backlog];
  if (res.finished) return Promise.resolve(events);
  return new Promise<typeof events>((resolve) => {
    const off = res.subscribe((e) => {
      events.push(e);
      if (e.type === "done" || e.type === "error") {
        off();
        resolve(events);
      }
    });
  });
}

describe("inspection service", () => {
  it("runs the agent, persists the inspection with usage, and sets verdict_ready", async () => {
    const r = await makeRental(10);
    const fake = fakeClient(happyScript);
    client.setClientForTests(fake);

    const events = await collect(svc.openInspection(r.id, "1.1.1.1"));
    expect(events.at(-1)?.type).toBe("done");
    expect(events.some((e) => e.type === "finding")).toBe(true);

    expect(db.getRental(r.id)?.status).toBe("verdict_ready");
    const saved = db.getLatestInspection(r.id)!;
    expect(saved.findings).toHaveLength(1);
    expect(saved.photo_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.usage).toMatchObject({ input_tokens: 200, output_tokens: 40, turns: 2 });
    expect(db.listEvents(r.id).some((e) => e.type === "inspection.done")).toBe(true);
  });

  it("serves an identical photo set from cache without calling the model", async () => {
    const a = await makeRental(20);
    client.setClientForTests(fakeClient(happyScript));
    await collect(svc.openInspection(a.id, "2.2.2.2"));

    const b = await makeRental(20); // byte-identical photos
    const fake = fakeClient(() => {
      throw new Error("model must not be called on a cache hit");
    });
    client.setClientForTests(fake);
    const events = await collect(svc.openInspection(b.id, "2.2.2.2"));

    expect(fake.calls).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((e) => e.type === "finding")).toHaveLength(1);
    const copy = db.getLatestInspection(b.id)!;
    expect(copy.photo_hash).toBe(db.getLatestInspection(a.id)!.photo_hash);
    expect(copy.usage).toMatchObject({ cached: true });
    expect(db.getRental(b.id)?.status).toBe("verdict_ready");
  });

  it("serves a cache hit even when no API key is set", async () => {
    const a = await makeRental(30);
    client.setClientForTests(fakeClient(happyScript));
    await collect(svc.openInspection(a.id, "3.3.3.3"));
    client.setClientForTests(null);
    const b = await makeRental(30);
    const res = svc.openInspection(b.id, "3.3.3.3");
    expect(res.kind).toBe("stream");
  });

  it("rate limits by the daily ceiling (cache hits are exempt, billed runs are not)", async () => {
    const env = (await import("../env")).getEnv() as { DEMO_DAILY_INSPECTION_LIMIT: number };
    const original = env.DEMO_DAILY_INSPECTION_LIMIT;
    env.DEMO_DAILY_INSPECTION_LIMIT = rate.countBilledInspectionsToday(); // the day is now "spent"
    try {
      const fresh = await makeRental(60);
      client.setClientForTests(fakeClient(happyScript));
      const res = svc.openInspection(fresh.id, "4.4.4.4");
      expect(res).toMatchObject({ kind: "error", status: 429 });
      expect((res as { retryAfterSec?: number }).retryAfterSec).toBeGreaterThan(0);
      expect(db.getRental(fresh.id)?.status).toBe("returned"); // untouched
    } finally {
      env.DEMO_DAILY_INSPECTION_LIMIT = original;
    }
  });

  it("counts running inspections against the daily ceiling", () => {
    const now = Date.now() + 5 * 24 * 3600 * 1000; // an empty day
    expect(rate.takeInspectionSlot("5.5.5.5", 0, now).ok).toBe(true);
    expect(rate.takeInspectionSlot("5.5.5.6", 100, now)).toMatchObject({ ok: false, reason: "daily" });
  });

  it("limits a single IP per hour", () => {
    const future = Date.now() + 9 * 24 * 3600 * 1000;
    const results = Array.from({ length: rate.INSPECTIONS_PER_IP_PER_HOUR + 1 }, () => rate.takeInspectionSlot("6.6.6.6", 0, future));
    expect(results.slice(0, rate.INSPECTIONS_PER_IP_PER_HOUR).every((r) => r.ok)).toBe(true);
    expect(results.at(-1)).toMatchObject({ ok: false, reason: "ip" });
    expect(rate.takeInspectionSlot("7.7.7.7", 0, future).ok).toBe(true); // other IPs unaffected
    expect(rate.takeInspectionSlot("6.6.6.6", 0, future + 61 * 60 * 1000).ok).toBe(true); // window slides
  });

  it("returns 503 without an API key (and does not touch the rental)", async () => {
    const r = await makeRental(70);
    const res = svc.openInspection(r.id, "8.8.8.8");
    expect(res).toMatchObject({ kind: "error", status: 503 });
    expect(db.getRental(r.id)?.status).toBe("returned");
  });

  it("recovers from a failure: back to returned, error event, then retry succeeds", async () => {
    const r = await makeRental(80);

    client.setClientForTests(
      fakeClient(() => {
        throw new Anthropic.APIConnectionError({ message: "socket hang up" });
      }),
    );
    const failed = await collect(svc.openInspection(r.id, "9.9.9.9"));
    expect(failed.at(-1)).toMatchObject({ type: "error" });
    expect((failed.at(-1) as { message: string }).message).toMatch(/reach the AI service/);
    expect(db.getRental(r.id)?.status).toBe("returned");
    expect(db.listEvents(r.id).some((e) => e.type === "inspection.error")).toBe(true);
    expect(svc.runningInspectionCount()).toBe(0);

    client.setClientForTests(fakeClient(happyScript));
    const retried = await collect(svc.openInspection(r.id, "9.9.9.9"));
    expect(retried.at(-1)?.type).toBe("done");
    expect(db.getRental(r.id)?.status).toBe("verdict_ready");
  });

  it("turns a refusal into an error event and a retryable rental", async () => {
    const r = await makeRental(81);
    client.setClientForTests(fakeClient(() => message([{ type: "text", text: "no" }], "refusal")));
    const events = await collect(svc.openInspection(r.id, "10.0.0.1"));
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((events.at(-1) as { message: string }).message).toMatch(/declined/);
    expect(db.getRental(r.id)?.status).toBe("returned");
  });

  it("never starts a second agent: a second request joins the running one", async () => {
    const r = await makeRental(90);
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const fake = fakeClient(async (i) => {
      await gate;
      return happyScript(i);
    });
    client.setClientForTests(fake);

    const first = svc.openInspection(r.id, "11.0.0.1");
    expect(first.kind).toBe("stream");
    expect(db.getRental(r.id)?.status).toBe("inspecting");
    const second = svc.openInspection(r.id, "11.0.0.2"); // a reconnecting client
    expect(second.kind).toBe("stream");
    expect(svc.runningInspectionCount()).toBe(1);

    const both = Promise.all([collect(first), collect(second)]);
    release();
    const [a, b] = await both;

    expect(fake.calls).toHaveLength(2); // one agent: two turns, not four
    expect(a.at(-1)?.type).toBe("done");
    expect(b.at(-1)?.type).toBe("done");
    expect(db.getRental(r.id)?.status).toBe("verdict_ready");
    // The late joiner saw the earlier steps from the recorded events.
    expect(b.some((e) => e.type === "step")).toBe(true);
  });

  it("lets a reconnecting client replay recorded events mid-run", async () => {
    const r = await makeRental(91);
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    client.setClientForTests(
      fakeClient(async (i) => {
        if (i === 1) await gate;
        return happyScript(i);
      }),
    );
    svc.openInspection(r.id, "12.0.0.1");
    await new Promise((res) => setTimeout(res, 20)); // turn 0 completes, turn 1 waits
    const joined = svc.openInspection(r.id, "12.0.0.2");
    if (joined.kind !== "stream") throw new Error("expected stream");
    expect(joined.backlog.some((e) => e.type === "step" && e.label.startsWith("Comparing the front"))).toBe(true);
    const done = collect(joined);
    release();
    expect((await done).at(-1)?.type).toBe("done");
  });

  it("recovers an orphaned inspecting status after a restart", async () => {
    const r = await makeRental(92);
    db.setRentalStatus(r.id, "inspecting"); // no live run in memory
    client.setClientForTests(fakeClient(happyScript));
    const events = await collect(svc.openInspection(r.id, "13.0.0.1"));
    expect(events.at(-1)?.type).toBe("done");
  });

  it("replays a saved inspection instead of rerunning", async () => {
    const r = await makeRental(93);
    client.setClientForTests(fakeClient(happyScript));
    await collect(svc.openInspection(r.id, "14.0.0.1"));
    const fake = fakeClient(() => {
      throw new Error("must not run");
    });
    client.setClientForTests(fake);
    const events = await collect(svc.openInspection(r.id, "14.0.0.1"));
    expect(fake.calls).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("rejects an inspection with missing photos or the wrong status", async () => {
    const r = db.createRental({ item_name: "x", daily_rate_cents: 1, days: 1, deposit_cents: 1, replacement_cents: 1, status: "returned" });
    expect(svc.openInspection(r.id, "15.0.0.1")).toMatchObject({ kind: "error", status: 409 });
    const held = db.createRental({ item_name: "y", daily_rate_cents: 1, days: 1, deposit_cents: 1, replacement_cents: 1, status: "held" });
    expect(svc.openInspection(held.id, "15.0.0.1")).toMatchObject({ kind: "error", status: 409 });
    expect(svc.openInspection("rnt_missing", "15.0.0.1")).toMatchObject({ kind: "error", status: 404 });
    expect(inspect.MAX_TURNS).toBeGreaterThan(0);
  });
});
