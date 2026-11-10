import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { UPLOADS_DIR } from "../db";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Anthropic rejects base64 images above 5 MB. */
const CLAUDE_IMAGE_LIMIT = 5 * 1024 * 1024;
const LONG_EDGE = 1600;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export class ImageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ImageError";
  }
}

/** Identifies the format from magic bytes. The client-declared type is never trusted. */
export function sniffImageType(buf: Buffer): ImageMediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const EXT: Record<ImageMediaType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const extensionFor = (t: ImageMediaType) => EXT[t];
export function mediaTypeForPath(p: string): ImageMediaType {
  const ext = path.extname(p).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
}

export interface NormalizedImage {
  data: Buffer;
  mediaType: ImageMediaType;
}

/**
 * Validates the bytes, applies EXIF rotation, strips metadata (GPS) and downsizes to a
 * Claude-friendly JPEG. Falls back to the original bytes only when sharp is unavailable
 * and the file is small enough for the API.
 */
export async function normalizeUpload(buf: Buffer): Promise<NormalizedImage> {
  const sniffed = sniffImageType(buf);
  if (!sniffed) throw new ImageError("Unsupported file. Upload a JPEG, PNG or WebP photo.", 415);

  let sharpFactory: typeof import("sharp").default | null = null;
  try {
    sharpFactory = (await import("sharp")).default;
  } catch {
    sharpFactory = null;
  }
  if (!sharpFactory) {
    if (buf.length > CLAUDE_IMAGE_LIMIT) throw new ImageError("Photo is too large to process. Try a smaller photo.", 413);
    return { data: buf, mediaType: sniffed };
  }
  try {
    const data = await sharpFactory(buf, { failOn: "error", limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { data, mediaType: "image/jpeg" };
  } catch {
    throw new ImageError("That file could not be read as a photo. Try another one.", 422);
  }
}

/** Resolves a stored relative path, refusing anything outside the uploads directory. */
export function resolveUploadPath(relative: string): string {
  const root = path.resolve(UPLOADS_DIR);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new ImageError("Invalid photo path.", 400);
  return full;
}

export function readStoredPhoto(relative: string): Buffer {
  return readFileSync(resolveUploadPath(relative));
}
