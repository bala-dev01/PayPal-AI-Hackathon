import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { handleError, jsonError } from "@/lib/paypal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public values only. The client secret never leaves the server. */
export async function GET() {
  try {
    const e = getEnv();
    if (!e.PAYPAL_CLIENT_ID || !e.PAYPAL_CLIENT_SECRET) {
      return jsonError("PayPal is not configured on this server.", 503);
    }
    return NextResponse.json({ clientId: e.PAYPAL_CLIENT_ID, environment: e.PAYPAL_ENVIRONMENT });
  } catch (err) {
    return handleError(err);
  }
}
