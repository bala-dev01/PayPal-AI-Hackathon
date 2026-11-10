import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  repo = await import("./repo");
});

describe("db repository", () => {
  it("seeds labelled samples with no PayPal ids or photos", () => {
    const samples = repo.listRentals().filter((r) => r.is_sample);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (const s of samples) {
      expect(s.item_name.startsWith("SAMPLE")).toBe(true);
      expect(s.paypal_authorization_id).toBeNull();
      expect(repo.listPhotos(s.id)).toHaveLength(0);
    }
  });

  it("creates, patches and reads a rental in integer cents", () => {
    const r = repo.createRental({
      item_name: "Test drill",
      daily_rate_cents: 2000,
      days: 2,
      deposit_cents: 5000,
      replacement_cents: 30000,
    });
    expect(r.is_sample).toBe(false);
    expect(repo.holdAmountCents(r)).toBe(9000);
    const u = repo.updateRental(r.id, { status: "held", authorized_cents: 9000 });
    expect(u?.status).toBe("held");
    expect(u?.authorized_cents).toBe(9000);
  });

  it("replaces a photo on retake and stores events and inspections", () => {
    const r = repo.createRental({
      item_name: "Cam",
      daily_rate_cents: 1,
      days: 1,
      deposit_cents: 1,
      replacement_cents: 1,
    });
    repo.savePhoto({ rental_id: r.id, phase: "pickup", angle: "front", path: "a.jpg" });
    repo.savePhoto({ rental_id: r.id, phase: "pickup", angle: "front", path: "b.jpg" });
    const photos = repo.listPhotos(r.id, "pickup");
    expect(photos).toHaveLength(1);
    expect(photos[0]?.path).toBe("b.jpg");

    repo.addEvent(r.id, "test", { ok: true });
    expect(repo.listEvents(r.id)[0]?.payload).toEqual({ ok: true });

    repo.saveInspection({ rental_id: r.id, photo_hash: "h", findings: [], summary: "none", model: "m" });
    expect(repo.getLatestInspection(r.id)?.summary).toBe("none");
    expect(repo.findInspectionByHash("h")?.rental_id).toBe(r.id);
  });
});
