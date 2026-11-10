import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ALL_ANGLES, fakeClient, message, toolUse, validFinding } from "./testkit";

vi.mock("server-only", () => ({}));

type Db = typeof import("../db");
let db: Db;
let photos: typeof import("../../app/api/rentals/[id]/photos/route");
let photoGet: typeof import("../../app/api/rentals/[id]/photos/[photoId]/route");
let phase: typeof import("../../app/api/rentals/[id]/phase/route");
let inspection: typeof import("../../app/api/rentals/[id]/inspection/route");
let client: typeof import("./client");
const created: string[] = [];

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  process.env.DEMO_DAILY_INSPECTION_LIMIT = "100";
  delete process.env.ANTHROPIC_API_KEY;
  db = await import("../db");
  client = await import("./client");
  photos = await import("../../app/api/rentals/[id]/photos/route");
  photoGet = await import("../../app/api/rentals/[id]/photos/[photoId]/route");
  phase = await import("../../app/api/rentals/[id]/phase/route");
  inspection = await import("../../app/api/rentals/[id]/inspection/route");
});

afterAll(() => {
  for (const id of created) rmSync(path.join(db.UPLOADS_DIR, id), { recursive: true, force: true });
  client.setClientForTests(null);
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ctx2 = (id: string, photoId: string) => ({ params: Promise.resolve({ id, photoId }) });
const png = (n: number) =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: { r: n, g: 5, b: 9 } } })
    .png()
    .toBuffer();

const TOKEN = "renter-test-token";
const auth = { "x-renter-token": TOKEN };

async function upload(id: string, ph: string, angle: string, bytes: Buffer, name = "../../evil.php", type = "image/png", headers: Record<string, string> = auth) {
  const form = new FormData();
  form.set("phase", ph);
  form.set("angle", angle);
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return photos.POST(new Request("http://x/api", { method: "POST", body: form, headers }), ctx(id));
}

function newRental(status: "held" | "picked_up" | "returned") {
  const r = db.createRental({ item_name: "Route test", daily_rate_cents: 1, days: 1, deposit_cents: 1, replacement_cents: 1, status });
  created.push(r.id);
  db.setRenterToken(r.id, TOKEN);
  return r;
}

async function fullSet(id: string, seedA: number, seedB: number) {
  for (const a of ALL_ANGLES) await upload(id, "pickup", a, await png(seedA));
  db.setRentalStatus(id, "picked_up");
  for (const a of ALL_ANGLES) await upload(id, "return", a, await png(seedB));
  db.setRentalStatus(id, "returned");
}

describe("photo upload route", () => {
  it("saves under a server-chosen name, ignores the client filename, and replaces on retake", async () => {
    const r = newRental("held");
    const res = await upload(r.id, "pickup", "front", await png(1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quality).toEqual({ ok: true, feedback: expect.any(String) }); // no key: neutral
    const first = db.getPhoto(body.photo.id)!;
    expect(first.path).toMatch(new RegExp(`^${r.id}/pickup-front-[0-9a-f]{12}\\.jpg$`));
    expect(first.path).not.toContain("evil");
    const firstFile = path.join(db.UPLOADS_DIR, first.path);
    expect(existsSync(firstFile)).toBe(true);

    const retake = await (await upload(r.id, "pickup", "front", await png(2))).json();
    expect(db.listPhotos(r.id, "pickup")).toHaveLength(1);
    expect(retake.photo.id).not.toBe(first.id);
    expect(existsSync(firstFile)).toBe(false); // old file removed

    const got = await photoGet.GET(new Request("http://x"), ctx2(r.id, retake.photo.id));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    const other = await photoGet.GET(new Request("http://x"), ctx2("rnt_other", retake.photo.id));
    expect(other.status).toBe(404);
  });

  it("rejects non-images, oversize files, bad fields, and the wrong phase", async () => {
    const r = newRental("held");
    expect((await upload(r.id, "pickup", "front", Buffer.from("<script>alert(1)</script>"), "a.png", "image/png")).status).toBe(415);
    expect((await upload(r.id, "pickup", "front", Buffer.alloc(12 * 1024 * 1024 + 1, 1))).status).toBe(413);
    expect((await upload(r.id, "pickup", "sideways", await png(3))).status).toBe(400);
    expect((await upload(r.id, "return", "front", await png(3))).status).toBe(409);
    expect((await upload("rnt_nope", "pickup", "front", await png(3))).status).toBe(404);
    expect(db.listPhotos(r.id)).toHaveLength(0);
  });
});

describe("phase route", () => {
  it("transitions held to picked_up to returned only when six angles exist, and is idempotent", async () => {
    const r = newRental("held");
    const post = (p: string) => phase.POST(new Request("http://x", { method: "POST", headers: auth, body: JSON.stringify({ phase: p }) }), ctx(r.id));

    expect((await post("pickup")).status).toBe(409); // no photos yet
    for (const a of ALL_ANGLES.slice(0, 5)) await upload(r.id, "pickup", a, await png(10));
    expect((await post("pickup")).status).toBe(409); // five of six
    await upload(r.id, "pickup", "detail", await png(11));
    expect((await post("pickup")).status).toBe(200);
    expect(db.getRental(r.id)?.status).toBe("picked_up");
    expect((await post("pickup")).status).toBe(200); // repeat is harmless
    expect((await post("return")).status).toBe(409); // return photos missing

    for (const a of ALL_ANGLES) await upload(r.id, "return", a, await png(20));
    const done = await post("return");
    expect(done.status).toBe(200);
    expect((await done.json()).rental.status).toBe("returned");
    expect((await phase.POST(new Request("http://x", { method: "POST", headers: auth, body: "{}" }), ctx(r.id))).status).toBe(400);
  });
});

describe("inspection route (SSE)", () => {
  async function readEvents(res: Response) {
    const text = await res.text();
    return text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
  }

  it("streams step, finding and done events as data lines", async () => {
    const r = newRental("held");
    await fullSet(r.id, 30, 40);
    client.setClientForTests(
      fakeClient((i) => {
        if (i > 0) throw new Error("extra call");
        return message([
          ...ALL_ANGLES.map((angle) => toolUse("view_angle_pair", { angle })),
          toolUse("record_finding", validFinding()),
          toolUse("finish_inspection", { summary: "One new dent." }),
        ]);
      }),
    );
    const res = await inspection.POST(new Request("http://x", { method: "POST", headers: { "x-forwarded-for": "20.0.0.1", ...auth } }), ctx(r.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toContain("step");
    expect(events.filter((e) => e.type === "finding")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", inspectionId: expect.stringMatching(/^ins_/) });
    expect(db.getRental(r.id)?.status).toBe("verdict_ready");
  });

  it("returns clear JSON errors: 503 without a key, 404, 409", async () => {
    client.setClientForTests(null);
    const r = newRental("held");
    await fullSet(r.id, 50, 60);
    const noKey = await inspection.POST(new Request("http://x", { method: "POST", headers: auth }), ctx(r.id));
    expect(noKey.status).toBe(503);
    expect((await noKey.json()).error).toMatch(/ANTHROPIC_API_KEY/);
    expect(db.getRental(r.id)?.status).toBe("returned");

    expect((await inspection.POST(new Request("http://x", { method: "POST", headers: auth }), ctx("rnt_none"))).status).toBe(404);
    const held = newRental("held");
    expect((await inspection.POST(new Request("http://x", { method: "POST", headers: auth }), ctx(held.id))).status).toBe(409);
  });
});

/** A Request whose body the test feeds by hand, so a request can be held open mid-body. */
function heldOpenRequest(headers: Record<string, string>) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const req = new Request("http://x/api", { method: "POST", headers, body, duplex: "half" } as RequestInit);
  return { req, ctrl: () => ctrl };
}

describe("renter authority on evidence routes", () => {
  it("photo POST, phase POST and inspection POST all 401 without the renter token", async () => {
    const r = newRental("held");
    expect((await upload(r.id, "pickup", "front", await png(70), "a.png", "image/png", {})).status).toBe(401);
    expect((await upload(r.id, "pickup", "front", await png(70), "a.png", "image/png", { "x-owner-token": "nope" })).status).toBe(401);
    expect((await upload(r.id, "pickup", "front", await png(70), "a.png", "image/png", { "x-renter-token": "wrong" })).status).toBe(401);
    expect(db.listPhotos(r.id)).toHaveLength(0);
    expect((await phase.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ phase: "pickup" }) }), ctx(r.id))).status).toBe(401);
    expect((await inspection.POST(new Request("http://x", { method: "POST" }), ctx(r.id))).status).toBe(401);
    // Reads stay open by rental id.
    const up = await (await upload(r.id, "pickup", "front", await png(71))).json();
    expect((await photoGet.GET(new Request("http://x"), ctx2(r.id, up.photo.id))).status).toBe(200);
  });
});

describe("evidence cannot be rewound by a held-open request", () => {
  it("phase: a body that resolves after the rental moved on cannot reset a verdict_ready rental", async () => {
    const r = newRental("held");
    for (const a of ALL_ANGLES) await upload(r.id, "pickup", a, await png(80));
    db.setRentalStatus(r.id, "picked_up");
    for (const a of ALL_ANGLES) await upload(r.id, "return", a, await png(81));

    // The request starts while the rental is picked_up, but its body is still in flight.
    const held = heldOpenRequest(auth);
    const pending = phase.POST(held.req, ctx(r.id));
    await new Promise((res) => setTimeout(res, 10));

    // Meanwhile the rental finishes inspection and reaches verdict_ready.
    db.setRentalStatus(r.id, "verdict_ready");

    held.ctrl().enqueue(new TextEncoder().encode(JSON.stringify({ phase: "return" })));
    held.ctrl().close();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(db.getRental(r.id)?.status).toBe("verdict_ready"); // not reset to returned
    expect(db.listEvents(r.id).some((e) => e.type === "phase.return_complete")).toBe(false);
  });

  it("phase: claimStatus is atomic, so a second racing request cannot double-transition", async () => {
    const r = newRental("held");
    for (const a of ALL_ANGLES) await upload(r.id, "pickup", a, await png(82));
    const mk = () => phase.POST(new Request("http://x", { method: "POST", headers: auth, body: JSON.stringify({ phase: "pickup" }) }), ctx(r.id));
    const [a, b] = await Promise.all([mk(), mk()]);
    expect([a.status, b.status].sort()).toEqual([200, 200]); // second sees the finished state, harmlessly
    expect(db.listEvents(r.id).filter((e) => e.type === "phase.pickup_complete")).toHaveLength(1);
  });

  it("photos: a body that resolves after the rental moved on cannot replace evidence", async () => {
    const r = newRental("held");
    for (const a of ALL_ANGLES) await upload(r.id, "pickup", a, await png(90));
    db.setRentalStatus(r.id, "picked_up");
    for (const a of ALL_ANGLES) await upload(r.id, "return", a, await png(91));
    const before = db.listPhotos(r.id, "return").find((p) => p.angle === "front")!;

    // Build a valid multipart body, then deliver it late.
    const form = new FormData();
    form.set("phase", "return");
    form.set("angle", "front");
    form.set("file", new File([new Uint8Array(await png(99))], "late.png", { type: "image/png" }));
    const encoded = new Response(form);
    const contentType = encoded.headers.get("content-type")!;
    const bytes = new Uint8Array(await encoded.arrayBuffer());

    const held = heldOpenRequest({ ...auth, "content-type": contentType });
    const pending = photos.POST(held.req, ctx(r.id));
    await new Promise((res) => setTimeout(res, 10));
    db.setRentalStatus(r.id, "verdict_ready");
    held.ctrl().enqueue(bytes);
    held.ctrl().close();

    const res = await pending;
    expect(res.status).toBe(409);
    const after = db.listPhotos(r.id, "return").find((p) => p.angle === "front")!;
    expect(after.id).toBe(before.id); // the original evidence is untouched
    expect(existsSync(path.join(db.UPLOADS_DIR, after.path))).toBe(true);
  });

  it("photos: enforces the size limit while reading when Content-Length is missing", async () => {
    const r = newRental("held");
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 200) return c.close(); // would be 200 MB if the server kept reading
        c.enqueue(chunk);
      },
    });
    const req = new Request("http://x/api", {
      method: "POST",
      headers: { ...auth, "content-type": "multipart/form-data; boundary=x" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await photos.POST(req, ctx(r.id));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(40); // stopped reading shortly after the 12 MB limit
    expect(db.listPhotos(r.id)).toHaveLength(0);
  });
});
