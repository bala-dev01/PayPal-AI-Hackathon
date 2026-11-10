import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UPLOADS_DIR, getRental, listPhotos, savePhoto, updatePhotoQuality } from "@/lib/db";
import { isRenter, renterRequired } from "@/lib/auth";
import { ANGLES, PHASES, type Angle, type Phase } from "@/lib/types";
import { ImageError, MAX_UPLOAD_BYTES, extensionFor, normalizeUpload, resolveUploadPath } from "@/lib/ai/images";
import { NEUTRAL_QUALITY, checkPhotoQuality } from "@/lib/ai/quality";
import { aiConfigured } from "@/lib/ai/client";
import { clientIp, takePhotoCheckSlot } from "@/lib/ai/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Multipart overhead allowance on top of the file limit. */
const BODY_LIMIT = MAX_UPLOAD_BYTES + 64 * 1024;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Reads the request body into memory but stops as soon as `limit` bytes are exceeded, so a
 * request with no Content-Length (or a lying one) cannot make the server buffer an unbounded body.
 */
async function readBodyLimited(req: Request, limit: number): Promise<Uint8Array | "too_large"> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** The phase each rental status accepts photos for. */
const PHASE_FOR_STATUS: Record<string, Phase> = { held: "pickup", picked_up: "return" };


export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return fail(404, "Rental not found.");
  if (!getRental(id)) return fail(404, "Rental not found.");
  if (!isRenter(req, id)) return renterRequired();

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > BODY_LIMIT) return fail(413, "Photo is too large. The limit is 12 MB.");

  // Read the whole body FIRST, with the size limit enforced while reading. The rental's state is
  // only read after this await, because a held-open request could otherwise act on stale state.
  const raw = await readBodyLimited(req, BODY_LIMIT);
  if (raw === "too_large") return fail(413, "Photo is too large. The limit is 12 MB.");
  let form: FormData;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    form = await new Response(raw as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch {
    return fail(400, "Expected a multipart form with phase, angle and file.");
  }

  const phase = String(form.get("phase") ?? "");
  const angle = String(form.get("angle") ?? "");
  if (!(PHASES as readonly string[]).includes(phase)) return fail(400, "phase must be pickup or return.");
  if (!(ANGLES as readonly string[]).includes(angle)) return fail(400, `angle must be one of ${ANGLES.join(", ")}.`);

  const file = form.get("file");
  if (!(file instanceof Blob)) return fail(400, "Missing file.");
  if (file.size === 0) return fail(400, "The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "Photo is too large. The limit is 12 MB.");

  const stateError = (): NextResponse | null => {
    const current = getRental(id);
    if (!current) return fail(404, "Rental not found.");
    const expected = PHASE_FOR_STATUS[current.status];
    if (expected !== phase) {
      return fail(409, expected ? `This rental is waiting for ${expected} photos.` : "This rental is not accepting photos right now.");
    }
    return null;
  };
  const early = stateError();
  if (early) return early;

  // Validate by content, normalize, and name the file ourselves. The client's filename and type are ignored.
  let stored: Awaited<ReturnType<typeof normalizeUpload>>;
  try {
    stored = await normalizeUpload(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof ImageError) return fail(e.status, e.message);
    return fail(400, "That file could not be read as a photo.");
  }

  // Re-check the status synchronously and save in the same turn (no await between the check, the
  // file write and savePhoto), so evidence can never be replaced after the rental moved on.
  const late = stateError();
  if (late) return late;
  const previous = listPhotos(id, phase as Phase).find((p) => p.angle === angle);
  const relative = `${id}/${phase}-${angle}-${randomBytes(6).toString("hex")}.${extensionFor(stored.mediaType)}`;
  const full = resolveUploadPath(relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, stored.data);

  // Saving replaces any earlier photo for this phase and angle (a retake).
  const saved = savePhoto({ rental_id: id, phase: phase as Phase, angle: angle as Angle, path: relative });
  if (previous) {
    try {
      unlinkSync(resolveUploadPath(previous.path));
    } catch {
      /* already gone */
    }
  }

  const rental = getRental(id)!;
  const quality =
    aiConfigured() && takePhotoCheckSlot(clientIp(req))
      ? await checkPhotoQuality({
          data: stored.data,
          mediaType: stored.mediaType,
          angle: angle as Angle,
          phase: phase as Phase,
          itemName: rental.item_name,
        })
      : NEUTRAL_QUALITY;
  updatePhotoQuality(saved.id, quality);

  return NextResponse.json({
    photo: { ...saved, quality },
    quality: { ok: quality.ok, feedback: quality.feedback },
  });
}
