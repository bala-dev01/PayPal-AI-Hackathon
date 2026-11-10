import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { SettlementError } from "../settlement";
import { PayPalApiError, PayPalNotConfiguredError } from "./client";
import { ToolkitError } from "./toolkit";

export const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Maps thrown errors to the contract's `{ error }` shape. Never includes secrets. */
export function handleError(e: unknown): NextResponse {
  if (e instanceof PayPalNotConfiguredError) return jsonError(e.message, 503);
  if (e instanceof SettlementError) return jsonError(e.message, e.status);
  if (e instanceof z.ZodError) {
    return jsonError(`Invalid request: ${e.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ")}`, 400);
  }
  if (e instanceof PayPalApiError) return jsonError(`PayPal error: ${e.issue}. ${e.message}`, 502);
  if (e instanceof ToolkitError) return jsonError(`PayPal toolkit error: ${e.message}`, 502);
  if (e instanceof Error && /Invalid environment variable/.test(e.message)) return jsonError(e.message, 503);
  console.error("[api] unexpected error", e instanceof Error ? e.message : "unknown");
  return jsonError("Unexpected server error.", 500);
}

/** Parses a JSON body with zod; an empty or malformed body counts as invalid. */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "must be valid JSON", input: undefined }]);
  }
  return schema.parse(raw);
}

export { isOwner, isRenter } from "../auth";
