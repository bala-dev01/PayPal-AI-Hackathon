import { beforeAll, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

let quality: typeof import("./quality");
let client: typeof import("./client");
let images: typeof import("./images");

beforeAll(async () => {
  process.env.HANDBACK_DB_PATH = ":memory:";
  quality = await import("./quality");
  client = await import("./client");
  images = await import("./images");
});

const input = { data: Buffer.from("x"), mediaType: "image/jpeg" as const, angle: "front" as const, phase: "pickup" as const, itemName: "Drill" };
const withCreate = (create: () => unknown) => client.setClientForTests({ beta: { messages: { create } } });
const reply = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });

describe("photo quality check", () => {
  it("returns the model verdict as one short sentence", async () => {
    withCreate(async () => reply(JSON.stringify({ ok: false, issues: ["dark"], feedback: "Too dark, move closer to a light." })));
    expect(await quality.checkPhotoQuality(input)).toEqual({ ok: false, issues: ["dark"], feedback: "Too dark, move closer to a light." });
  });

  it("accepts the photo with neutral feedback when the AI call fails", async () => {
    withCreate(async () => {
      throw new Anthropic.APIConnectionError({ message: "down" });
    });
    expect(await quality.checkPhotoQuality(input)).toEqual(quality.NEUTRAL_QUALITY);
    expect(quality.NEUTRAL_QUALITY.ok).toBe(true);
  });

  it("accepts on a refusal, on malformed output and when no key is configured", async () => {
    withCreate(async () => reply("{}", "refusal"));
    expect((await quality.checkPhotoQuality(input)).ok).toBe(true);
    withCreate(async () => reply("not json"));
    expect((await quality.checkPhotoQuality(input)).ok).toBe(true);
    client.setClientForTests(null);
    expect(await quality.checkPhotoQuality(input)).toEqual(quality.NEUTRAL_QUALITY);
  });
});

describe("upload validation", () => {
  it("identifies images by content, not by claimed type", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(images.sniffImageType(png)).toBe("image/png");
    expect(images.sniffImageType(Buffer.from("<html>not an image</html>"))).toBeNull();
    await expect(images.normalizeUpload(Buffer.from("GIF89a-not-allowed"))).rejects.toMatchObject({ status: 415 });
  });

  it("normalizes to a bounded JPEG and strips the original format", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#369" } }).png().toBuffer();
    const out = await images.normalizeUpload(big);
    expect(out.mediaType).toBe("image/jpeg");
    const meta = await sharp(out.data).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
  });

  it("refuses paths that escape the uploads directory", () => {
    expect(() => images.resolveUploadPath("../../etc/passwd")).toThrow();
    expect(() => images.resolveUploadPath("rnt_1/pickup-front-ab.jpg")).not.toThrow();
  });
});
