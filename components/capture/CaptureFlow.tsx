"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANGLES, type Angle, type Photo, type PhotoQuality, type Phase } from "@/lib/types";
import { Button, Stamp } from "@/components/ui";
import { fileToJpeg, toJpeg } from "./compress";
import { renterHeaders } from "@/app/r/_lib/renter-token";

const COPY: Record<Angle, { short: string; title: string; how: string }> = {
  front: { short: "Front", title: "Front", how: "Stand square to the front. Fit the whole item in the frame, edge to edge." },
  back: { short: "Back", title: "Back", how: "Walk around to the back. Keep the same distance and height as the front shot." },
  left: { short: "Left", title: "Left side", how: "Face the left side straight on, so the whole side is in the frame." },
  right: { short: "Right", title: "Right side", how: "Face the right side straight on, so the whole side is in the frame." },
  top: { short: "Top", title: "Top", how: "Hold the phone above the item, pointing down, so the top fills the frame." },
  detail: { short: "Close", title: "Close-up", how: "Move in on the part most likely to get scratched or dented: a corner, screen, lens or edge." },
};

type Cam = "starting" | "live" | "denied" | "unavailable";
interface Shot {
  photoId: string;
  quality: PhotoQuality | null;
}
interface Pending {
  previewUrl: string;
  uploading: boolean;
  error: string | null;
}

const photoSrc = (rentalId: string, photoId: string) => `/api/rentals/${rentalId}/photos/${photoId}`;

export function CaptureFlow({
  rentalId,
  phase,
  photos,
  itemName,
  finishing,
  finishError,
  onFinish,
}: {
  rentalId: string;
  phase: Phase;
  photos: Photo[];
  itemName: string;
  finishing: boolean;
  finishError: string | null;
  onFinish: () => void;
}) {
  const isReturn = phase === "return";
  const [index, setIndex] = useState(0);
  const angle: Angle = ANGLES[index] ?? "front";

  const [shots, setShots] = useState<Partial<Record<Angle, Shot>>>(() => {
    const init: Partial<Record<Angle, Shot>> = {};
    for (const p of photos) if (p.phase === phase) init[p.angle] = { photoId: p.id, quality: p.quality };
    return init;
  });
  const [pending, setPending] = useState<Partial<Record<Angle, Pending>>>({});
  const [retaking, setRetaking] = useState<Partial<Record<Angle, boolean>>>({});
  const [flash, setFlash] = useState(0);

  const pickupByAngle = useMemo(() => {
    const m: Partial<Record<Angle, string>> = {};
    for (const p of photos) if (p.phase === "pickup") m[p.angle] = p.id;
    return m;
  }, [photos]);

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<Cam>("starting");
  const [aspect, setAspect] = useState(3 / 4);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCam("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam("unavailable");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setCam("live");
    } catch (e) {
      const name = (e as DOMException).name;
      setCam(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }, [stopCamera]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  // Release the camera when the page is hidden; ask again when it returns.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) stopCamera();
      else if (!streamRef.current && cam === "live") void startCamera();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cam, startCamera, stopCamera]);

  // Revoke preview object URLs on unmount.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(
    () => () => {
      Object.values(pendingRef.current).forEach((p) => p && URL.revokeObjectURL(p.previewUrl));
    },
    [],
  );

  const upload = useCallback(
    async (a: Angle, blob: Blob) => {
      const previewUrl = URL.createObjectURL(blob);
      setPending((p) => {
        const old = p[a];
        if (old) URL.revokeObjectURL(old.previewUrl);
        return { ...p, [a]: { previewUrl, uploading: true, error: null } };
      });
      try {
        const fd = new FormData();
        fd.set("phase", phase);
        fd.set("angle", a);
        fd.set("file", blob, `${a}.jpg`);
        let res: Response;
        try {
          res = await fetch(`/api/rentals/${rentalId}/photos`, { method: "POST", body: fd, headers: renterHeaders(rentalId) });
        } catch {
          throw new Error("The photo didn't upload because the connection dropped. Retake it when you're back online.");
        }
        if (!res.ok) {
          let m = "The photo didn't upload. Retake it and try again.";
          try {
            const b = (await res.json()) as { error?: string };
            if (b.error) m = b.error;
          } catch {
            /* ignore */
          }
          throw new Error(m);
        }
        const body = (await res.json()) as {
          photo: { id: string };
          quality?: { ok: boolean; feedback: string; issues?: string[] } | null;
        };
        const q: PhotoQuality | null = body.quality
          ? { ok: body.quality.ok, feedback: body.quality.feedback, issues: body.quality.issues ?? [] }
          : null;
        setShots((s) => ({ ...s, [a]: { photoId: body.photo.id, quality: q } }));
        setRetaking((r) => ({ ...r, [a]: false }));
        setPending((p) => {
          const cur = p[a];
          if (cur) URL.revokeObjectURL(cur.previewUrl);
          const { [a]: _gone, ...rest } = p;
          void _gone;
          return rest;
        });
      } catch (e) {
        setPending((p) => (p[a] ? { ...p, [a]: { ...p[a]!, uploading: false, error: (e as Error).message } } : p));
      }
    },
    [phase, rentalId],
  );

  const shoot = useCallback(async () => {
    const v = videoRef.current;
    if (!v || cam !== "live") return;
    try {
      const blob = await toJpeg(v);
      setFlash((k) => k + 1);
      void upload(angle, blob);
    } catch (e) {
      setPending((p) => ({ ...p, [angle]: { previewUrl: "", uploading: false, error: (e as Error).message } }));
    }
  }, [angle, cam, upload]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const blob = await fileToJpeg(file);
        setFlash((k) => k + 1);
        void upload(angle, blob);
      } catch (e) {
        setPending((p) => ({ ...p, [angle]: { previewUrl: "", uploading: false, error: (e as Error).message } }));
      }
    },
    [angle, upload],
  );

  // Ghost overlay (return only)
  const [ghostOn, setGhostOn] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(45);
  const ghostId = isReturn ? pickupByAngle[angle] : undefined;

  const doneCount = ANGLES.filter((a) => shots[a]).length;
  const allDone = doneCount === ANGLES.length;
  const pend = pending[angle];
  const shot = shots[angle];
  const showingReview = !!pend || (!!shot && !retaking[angle]);
  const reviewSrc = pend?.previewUrl || (shot ? photoSrc(rentalId, shot.photoId) : "");
  const fileRef = useRef<HTMLInputElement>(null);
  const noLiveCam = cam === "denied" || cam === "unavailable";
  const copy = COPY[angle];

  const retake = () => {
    setRetaking((r) => ({ ...r, [angle]: true }));
    setPending((p) => {
      const cur = p[angle];
      if (cur) URL.revokeObjectURL(cur.previewUrl);
      const { [angle]: _g, ...rest } = p;
      void _g;
      return rest;
    });
  };

  return (
    <div>
      {/* Six tags */}
      <ol className="mb-5 grid grid-cols-6 gap-1.5 border-b-2 border-dashed border-rule pb-4" aria-label="Photo angles">
        {ANGLES.map((a, i) => {
          const s = shots[a];
          const flagged = s?.quality && !s.quality.ok;
          const current = i === index;
          return (
            <li key={a}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={current ? "step" : undefined}
                aria-label={`${COPY[a].title}: ${s ? (flagged ? "needs a look" : "captured") : "not taken"}`}
                className={`cap-cell relative flex min-h-16 w-full flex-col items-center justify-end rounded-[3px] border-2 px-0.5 pb-1 pt-4 font-mono text-[0.6875rem] font-bold leading-tight transition-transform duration-150 ${
                  current ? "-translate-y-0.5 border-ink bg-ink text-paper shadow-[0_3px_0_var(--stamp-red)]" : s ? (flagged ? "border-amber bg-amber-wash text-amber" : "border-clear bg-clear-wash text-clear") : "border-rule bg-card text-ink-soft"
                }`}
              >
                {s || pending[a]?.previewUrl ? (
                  <span
                    aria-hidden="true"
                    className="cap-cell-thumb"
                    style={{ backgroundImage: `url(${pending[a]?.previewUrl || photoSrc(rentalId, s!.photoId)})`, opacity: current ? 0.5 : 0.7 }}
                  />
                ) : null}
                <span aria-hidden="true" className="absolute left-1/2 top-1.5 z-10 h-2 w-2 -translate-x-1/2 rounded-full border-2 border-current bg-paper" />
                <span className="relative z-10 bg-inherit px-0.5">{COPY[a].short}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mb-3">
        <p className="font-mono text-[0.8125rem] text-ink-soft">
          Photo {index + 1} of 6, {isReturn ? "return" : "pickup"} of {itemName}
        </p>
        <h2 className="text-[2.4rem]">{copy.title}</h2>
        <p className="mt-1" id="angle-how">{copy.how}</p>
      </div>

      {/* Viewfinder */}
      <div
        className={`relative mx-auto w-full overflow-hidden border-2 border-ink bg-ink shadow-[4px_4px_0_var(--ink)] ${isReturn ? "cap-return" : ""}`}
        style={{ aspectRatio: noLiveCam ? 4 / 3 : aspect, maxHeight: "68dvh" }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Live camera preview"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          }}
          className={`absolute inset-0 h-full w-full object-cover ${cam === "live" ? "" : "invisible"}`}
        />

        {ghostId && ghostOn && !showingReview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc(rentalId, ghostId)}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            style={{ opacity: ghostOpacity / 100 }}
          />
        ) : null}

        {/* viewfinder: corner reticles, thirds grid, readout */}
        {!showingReview && cam === "live" ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="cap-grid" />
            <span className="cap-corner" data-pos="tl" />
            <span className="cap-corner" data-pos="tr" />
            <span className="cap-corner" data-pos="bl" />
            <span className="cap-corner" data-pos="br" />
            <div className="cap-hud">
              <span>{isReturn ? "Return" : "Pickup"} {index + 1}/6</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-[#ff5a47]" />{copy.short}</span>
            </div>
            <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 opacity-70">
              <span className="absolute left-1/2 top-0 h-full w-px bg-paper" />
              <span className="absolute left-0 top-1/2 h-px w-full bg-paper" />
            </span>
          </div>
        ) : null}
        {flash > 0 ? <div key={flash} aria-hidden="true" className="cap-flash" /> : null}

        {cam === "starting" ? (
          <p role="status" className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-paper">
            Waiting for the camera. If your phone asks, choose Allow.
          </p>
        ) : null}

        {noLiveCam && !showingReview ? (
          <div className="absolute inset-0 grid place-items-center p-5 text-center text-paper">
            <div>
              <p className="font-display text-3xl">{cam === "denied" ? "Camera is blocked" : "No camera found"}</p>
              <p className="mx-auto mt-1 max-w-xs text-[0.95rem]">
                {cam === "denied"
                  ? "Allow camera access for this site in your browser settings, or take the photo with your phone's camera and upload it."
                  : "This device or browser can't open a camera. Take the photo another way and upload it."}
              </p>
            </div>
          </div>
        ) : null}

        {showingReview && reviewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reviewSrc} alt={`${copy.title} photo of ${itemName}, ${phase}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}

        {pend?.uploading ? (
          <div role="status" className="absolute inset-x-0 bottom-0 bg-ink/85 px-3 py-2 font-mono text-sm text-paper">
            Uploading and checking the shot...
          </div>
        ) : null}
        {shot && !pend && showingReview ? (
          <div className="absolute right-3 top-3">
            <Stamp tone={shot.quality && !shot.quality.ok ? "damage" : "clear"} tilt={5} className="bg-card/80 text-base">
              {shot.quality && !shot.quality.ok ? "CHECK" : "LOGGED"}
            </Stamp>
          </div>
        ) : null}
      </div>

      {/* Ghost controls */}
      {isReturn ? (
        <div className="mt-3 border-2 border-ink bg-card p-3">
          {ghostId ? (
            <>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoSrc(rentalId, ghostId)} alt="" aria-hidden="true" className="aspect-[4/3] w-20 shrink-0 border-2 border-ink object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[0.8125rem] font-bold">Pickup photo overlay</p>
                  <p className="text-sm text-ink-soft">Match the live view to this frame.</p>
                </div>
                <button
                  type="button"
                  aria-pressed={ghostOn}
                  onClick={() => setGhostOn((v) => !v)}
                  className="min-h-11 min-w-24 border-2 border-ink px-3 font-mono text-sm font-bold aria-pressed:bg-ink aria-pressed:text-paper"
                >
                  {ghostOn ? "Shown" : "Hidden"}
                </button>
              </div>
              <label className="mt-2 block">
                <span className="flex items-baseline justify-between font-mono text-[0.8125rem]">
                  <span className={ghostOpacity < 50 ? "font-bold" : "text-ink-soft"}>Live camera</span>
                  <span className="text-ink-soft">Strength {ghostOpacity}%</span>
                  <span className={ghostOpacity >= 50 ? "font-bold" : "text-ink-soft"}>Pickup photo</span>
                </span>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={ghostOpacity}
                  disabled={!ghostOn}
                  onChange={(e) => setGhostOpacity(Number(e.target.value))}
                  aria-label="Pickup photo overlay opacity"
                  className="block h-11 w-full accent-[var(--stamp-red)]"
                />
              </label>
              <p className="text-sm text-ink-soft">Line the item up with its ghost, then press the shutter. Matching shots make the comparison fair.</p>
            </>
          ) : (
            <p className="text-sm">There's no pickup photo for this angle, so there's nothing to line up with. Shoot it straight on.</p>
          )}
        </div>
      ) : null}

      {/* Shutter / actions */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {showingReview ? (
          <>
            <Button variant="ghost" onClick={retake} disabled={pend?.uploading} aria-describedby="angle-how">
              Retake
            </Button>
            {index < ANGLES.length - 1 ? (
              <Button onClick={() => setIndex(index + 1)} disabled={!shot || !!pend}>
                Next: {COPY[ANGLES[index + 1] ?? "front"].title}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {!noLiveCam ? (
              <button
                type="button"
                onClick={shoot}
                disabled={cam !== "live"}
                aria-label={`Take the ${copy.title} photo`}
                className="cap-shutter"
              >
                <span />
              </button>
            ) : null}
            <Button variant={noLiveCam ? "ink" : "ghost"} onClick={() => fileRef.current?.click()}>
              {noLiveCam ? "Take or upload a photo" : "Upload instead"}
            </Button>
            {cam === "denied" || cam === "unavailable" ? (
              <Button variant="ghost" onClick={() => void startCamera()}>
                Try camera again
              </Button>
            ) : null}
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label={`Choose a ${copy.title} photo from this device`}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {/* Per-shot feedback */}
      <div aria-live="polite" className="mt-4">
        {pend?.error ? (
          <p role="alert" className="border-l-4 border-stamp bg-stamp-wash px-3 py-2">{pend.error}</p>
        ) : null}
        {shot && showingReview && !pend ? (
          shot.quality ? (
            <div
              className={`border-l-4 px-3 py-2 ${shot.quality.ok ? "border-clear bg-clear-wash" : "border-amber bg-amber-wash"}`}
            >
              <p className="font-mono text-[0.8125rem] font-bold">
                {shot.quality.ok ? "Shot accepted" : "Worth retaking"}
              </p>
              <p>{shot.quality.feedback}</p>
              {!shot.quality.ok ? <p className="mt-1 text-sm">You can keep it, but a clearer photo protects you both.</p> : null}
            </div>
          ) : (
            <p className="border-l-4 border-rule bg-card px-3 py-2">Saved. No feedback came back for this shot.</p>
          )
        ) : null}
      </div>

      {/* Finish */}
      <div className="ticket mt-8 p-5">
        <p className="font-mono text-[0.8125rem] text-ink-soft">{doneCount} of 6 angles logged</p>
        {allDone ? (
          <>
            <h3 className="mt-1 text-3xl">All six angles are in</h3>
            <p className="mt-1">
              {isReturn
                ? "Finishing sends the item for inspection. You'll watch the AI work and then review the verdict."
                : "Finishing locks in the pickup record. Keep this link for the return."}
            </p>
            {finishError ? <p role="alert" className="mt-3 border-l-4 border-stamp bg-stamp-wash px-3 py-2">{finishError}</p> : null}
            <Button className="mt-4 w-full" onClick={onFinish} disabled={finishing || !!Object.keys(pending).length}>
              {finishing ? "Saving..." : isReturn ? "Finish return and inspect" : "Finish pickup"}
            </Button>
          </>
        ) : (
          <p className="mt-1">
            Take all six angles to finish. Still missing: {ANGLES.filter((a) => !shots[a]).map((a) => COPY[a].title.toLowerCase()).join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}
