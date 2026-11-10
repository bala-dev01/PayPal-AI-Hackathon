import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { lookupReplacementPrice } from "@/lib/channel3";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 200) return NextResponse.json({ cents: null });
  try {
    const key = getEnv().CHANNEL3_API_KEY;
    if (!key) return NextResponse.json({ cents: null });
    return NextResponse.json(await lookupReplacementPrice(q, key));
  } catch {
    return NextResponse.json({ cents: null });
  }
}
