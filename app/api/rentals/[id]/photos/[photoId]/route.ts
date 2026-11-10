import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/db";
import { mediaTypeForPath, readStoredPhoto } from "@/lib/ai/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await ctx.params;
  const photo = getPhoto(photoId);
  if (!photo || photo.rental_id !== id) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = readStoredPhoto(photo.path);
  } catch {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mediaTypeForPath(photo.path),
      "Content-Length": String(bytes.length),
      // A retake creates a new photo id, so a given id never changes.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
