import "server-only";
import { getDb } from "../db";
import { getEnv } from "../env";

/** Per-IP ceilings for the public demo. In memory: resets on restart, which is fine for a demo. */
export const INSPECTIONS_PER_IP_PER_HOUR = 8;
export const PHOTO_CHECKS_PER_IP_PER_HOUR = 150;
/** Global daily ceiling on per-photo Claude quality checks. Past it, photos are accepted with neutral feedback. */
export const DEFAULT_DAILY_PHOTO_CHECK_LIMIT = 400;
const HOUR_MS = 60 * 60 * 1000;

const g = globalThis as unknown as { __handbackHits?: Map<string, number[]> };
const hits = (g.__handbackHits ??= new Map<string, number[]>());
const g2 = globalThis as unknown as { __handbackPhotoDay?: { day: string; n: number } };

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

function dailyPhotoLimit(): number {
  const raw = Number(process.env.DEMO_DAILY_PHOTO_CHECK_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DAILY_PHOTO_CHECK_LIMIT;
}

export type LimitResult = { ok: true } | { ok: false; reason: "ip" | "daily"; message: string; retryAfterSec: number };

function takeIp(bucket: string, ip: string, max: number, now: number): number | null {
  const key = `${bucket}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0]! + HOUR_MS - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  return null;
}

/** Real model-backed inspections created since the start of the UTC day (cache hits excluded). */
export function countBilledInspectionsToday(now: number = Date.now()): number {
  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM inspections
       WHERE created_at >= ? AND (usage_json IS NULL OR usage_json NOT LIKE '%"cached":true%')`,
    )
    .get(start);
  return Number(row?.n ?? 0);
}

/**
 * Checks and, when allowed, consumes one inspection slot for this IP.
 * `inFlight` is the number of inspections currently running, so a burst cannot overshoot the day limit.
 */
export function takeInspectionSlot(ip: string, inFlight: number, now: number = Date.now()): LimitResult {
  const limit = getEnv().DEMO_DAILY_INSPECTION_LIMIT;
  if (countBilledInspectionsToday(now) + inFlight >= limit) {
    const d = new Date(now);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return {
      ok: false,
      reason: "daily",
      message: "The demo has reached today's inspection limit. Please try again tomorrow.",
      retryAfterSec: Math.max(1, Math.ceil((next - now) / 1000)),
    };
  }
  const wait = takeIp("inspect", ip, INSPECTIONS_PER_IP_PER_HOUR, now);
  if (wait !== null) {
    return {
      ok: false,
      reason: "ip",
      message: "Too many inspections from your connection. Please wait a while and try again.",
      retryAfterSec: wait,
    };
  }
  return { ok: true };
}

/**
 * Soft limits for per-photo quality checks: a per-IP hourly cap and a global daily cap (UTC day,
 * in memory). When either is hit the photo is still accepted, just without an AI check.
 */
export function takePhotoCheckSlot(ip: string, now: number = Date.now()): boolean {
  const day = utcDay(now);
  const counter = g2.__handbackPhotoDay?.day === day ? g2.__handbackPhotoDay : (g2.__handbackPhotoDay = { day, n: 0 });
  if (counter.n >= dailyPhotoLimit()) return false;
  if (takeIp("photo", ip, PHOTO_CHECKS_PER_IP_PER_HOUR, now) !== null) return false;
  counter.n++;
  return true;
}

/**
 * The caller's IP for rate limiting. Behind a proxy, clients can send their own X-Forwarded-For,
 * and a proxy only APPENDS the address it saw, so the leftmost entries are attacker-controlled.
 * Render's load balancer appends the real client address as the last entry, so by default we take
 * the last one. Set TRUSTED_PROXY_HOPS if more proxies of yours sit in front (it counts from the right).
 */
export function clientIp(req: Request): string {
  const parts = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    const hops = Number(process.env.TRUSTED_PROXY_HOPS);
    const fromRight = Number.isInteger(hops) && hops >= 1 ? hops : 1;
    return parts[Math.max(0, parts.length - fromRight)]!;
  }
  return req.headers.get("x-real-ip")?.trim() || "local";
}

export function resetRateLimitsForTests(): void {
  hits.clear();
  g2.__handbackPhotoDay = undefined;
}
