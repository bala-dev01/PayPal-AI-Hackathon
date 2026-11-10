import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let rl: typeof import("./ratelimit");

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  rl = await import("./ratelimit");
});

beforeEach(() => rl.resetRateLimitsForTests());
afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.DEMO_DAILY_PHOTO_CHECK_LIMIT;
});

const req = (headers: Record<string, string>) => new Request("http://x", { headers });

describe("clientIp", () => {
  it("takes the address the platform appended (last), not the spoofable leftmost", () => {
    expect(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(rl.clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("a client cannot dodge the limit by rotating a forged leading address", () => {
    const ips = new Set([1, 2, 3, 4].map((n) => rl.clientIp(req({ "x-forwarded-for": `10.0.0.${n}, 203.0.113.9` }))));
    expect(ips.size).toBe(1);
  });

  it("honours TRUSTED_PROXY_HOPS and falls back to x-real-ip then local", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.1.1.1" }))).toBe("198.51.100.4");
    expect(rl.clientIp(req({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(rl.clientIp(req({}))).toBe("local");
  });
});

describe("photo quality check daily cap", () => {
  it("stops granting AI checks once the daily cap is reached, so photos fall back to neutral feedback", () => {
    process.env.DEMO_DAILY_PHOTO_CHECK_LIMIT = "3";
    const now = Date.UTC(2026, 10, 10, 12);
    expect([1, 2, 3, 4, 5].map((i) => rl.takePhotoCheckSlot(`ip${i}`, now))).toEqual([true, true, true, false, false]);
    // A new UTC day resets the counter.
    expect(rl.takePhotoCheckSlot("ip9", Date.UTC(2026, 10, 11, 0, 1))).toBe(true);
  });

  it("the per-IP hourly limit still applies and does not burn the daily budget", () => {
    process.env.DEMO_DAILY_PHOTO_CHECK_LIMIT = "1000";
    const now = Date.UTC(2026, 10, 10, 12);
    let granted = 0;
    for (let i = 0; i < rl.PHOTO_CHECKS_PER_IP_PER_HOUR + 10; i++) if (rl.takePhotoCheckSlot("same", now)) granted++;
    expect(granted).toBe(rl.PHOTO_CHECKS_PER_IP_PER_HOUR);
  });
});
