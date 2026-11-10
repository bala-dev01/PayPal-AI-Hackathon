import "server-only";
import { z } from "zod/v4";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  PAYPAL_CLIENT_ID: optional,
  PAYPAL_CLIENT_SECRET: optional,
  // Case-insensitive: PayPal's own tooling documents the upper-case form (SANDBOX).
  PAYPAL_ENVIRONMENT: optional
    .transform((v) => v?.toLowerCase())
    .pipe(z.enum(["sandbox", "live"]).optional()),
  PAYPAL_WEBHOOK_ID: optional,
  ANTHROPIC_API_KEY: optional,
  CHANNEL3_API_KEY: optional,
  APP_ORIGIN: optional.pipe(z.url().optional()),
  DEMO_DAILY_INSPECTION_LIMIT: optional.pipe(z.string().regex(/^[1-9][0-9]*$/).transform(Number).optional()),
});

export type Env = Omit<
  z.infer<typeof schema>,
  "PAYPAL_ENVIRONMENT" | "APP_ORIGIN" | "DEMO_DAILY_INSPECTION_LIMIT"
> & {
  PAYPAL_ENVIRONMENT: "sandbox" | "live";
  APP_ORIGIN: string;
  DEMO_DAILY_INSPECTION_LIMIT: number;
};

let cached: Env | null = null;

/** Server-only. Validated on first call, never at import, so builds work without keys. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variable(s): ${bad}`);
  }
  const e = parsed.data;
  cached = {
    ...e,
    PAYPAL_ENVIRONMENT: e.PAYPAL_ENVIRONMENT ?? "sandbox",
    APP_ORIGIN: e.APP_ORIGIN ?? "http://localhost:3000",
    DEMO_DAILY_INSPECTION_LIMIT: e.DEMO_DAILY_INSPECTION_LIMIT ?? 10,
  };
  return cached;
}

/** Throws a readable error naming missing keys. Call at the point of use. */
export function requireEnv<K extends keyof Env>(...keys: K[]): Env & { [P in K]: NonNullable<Env[P]> } {
  const env = getEnv();
  const missing = keys.filter((k) => env[k] === undefined);
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  return env as Env & { [P in K]: NonNullable<Env[P]> };
}

/** Which integrations are configured. Booleans only, safe to render. */
export function configuredFeatures() {
  const e = getEnv();
  return {
    paypal: Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET),
    anthropic: Boolean(e.ANTHROPIC_API_KEY),
    channel3: Boolean(e.CHANNEL3_API_KEY),
  };
}
