/** Resize to a longest edge of about 1600px and encode as JPEG. Honors EXIF orientation for uploaded files. */
export const MAX_EDGE = 1600;

type Source = HTMLVideoElement | ImageBitmap | HTMLImageElement;

function sizeOf(src: Source): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

export async function toJpeg(src: Source, quality = 0.85): Promise<Blob> {
  const { w, h } = sizeOf(src);
  if (!w || !h) throw new Error("That image has no size. Try a different photo.");
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images. Try another browser.");
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't compress that photo."))), "image/jpeg", quality),
  );
}

export async function fileToJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image. Choose a photo.");
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      try {
        return await toJpeg(bmp);
      } finally {
        bmp.close();
      }
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("We couldn't read that photo. Try a JPEG or PNG.");
    });
    return await toJpeg(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
