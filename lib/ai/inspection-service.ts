import "server-only";
import { createHash } from "node:crypto";
import { ANGLES, PHASES, type Angle, type Finding, type Inspection, type Phase, type Photo, type RentalEvent } from "../types";
import { addEvent, claimStatus, findInspectionByHash, getLatestInspection, getPayPalOrderId, getRental, listEvents, listPhotos, saveInspection, setRentalStatus } from "../db";
import { MODEL, aiConfigured, describeAiError, getClient } from "./client";
import { mediaTypeForPath, readStoredPhoto } from "./images";
import { InspectionError, runInspectionAgent, type AgentImage, type StreamEvent } from "./inspect";
import { takeInspectionSlot } from "./ratelimit";

type Listener = (event: StreamEvent) => void;

interface Run {
  rentalId: string;
  listeners: Set<Listener>;
}

const g = globalThis as unknown as { __handbackRuns?: Map<string, Run> };
/** Live inspections by rental id. One entry means one running agent: this is the no-double-run guard. */
const runs = (g.__handbackRuns ??= new Map<string, Run>());

export function runningInspectionCount(): number {
  return runs.size;
}

export type OpenResult =
  | { kind: "error"; status: number; message: string; retryAfterSec?: number }
  | {
      kind: "stream";
      /** Events already recorded for this run, to replay first. */
      backlog: StreamEvent[];
      /** True when backlog already ends in a terminal event and nothing more will come. */
      finished: boolean;
      /** Subscribe to live events. Returns an unsubscribe function. */
      subscribe: (listener: Listener) => () => void;
    };

/* ------------------------------ event recording ----------------------------- */

const EVENT_PREFIX = "inspection.";

function persist(rentalId: string, event: StreamEvent | { type: "started" }): void {
  const { type, ...rest } = event;
  addEvent(rentalId, `${EVENT_PREFIX}${type}`, rest as Record<string, unknown>);
}

function toStreamEvent(e: RentalEvent): StreamEvent | null {
  if (!e.type.startsWith(EVENT_PREFIX)) return null;
  const type = e.type.slice(EVENT_PREFIX.length);
  const p = e.payload;
  switch (type) {
    case "step":
      return { type: "step", label: String(p.label ?? ""), ...(typeof p.detail === "string" ? { detail: p.detail } : {}) };
    case "finding":
      return p.finding ? { type: "finding", finding: p.finding as Finding } : null;
    case "done":
      return { type: "done", inspectionId: String(p.inspectionId ?? "") };
    case "error":
      return { type: "error", message: String(p.message ?? "The inspection failed.") };
    default:
      return null; // "started" is internal
  }
}

/** Events of the most recent run (everything after the last "started" marker). */
function currentRunBacklog(rentalId: string): StreamEvent[] {
  const all = listEvents(rentalId).filter((e) => e.type.startsWith(EVENT_PREFIX));
  let start = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.type === `${EVENT_PREFIX}started`) {
      start = i;
      break;
    }
  }
  return all.slice(start).map(toStreamEvent).filter((e): e is StreamEvent => e !== null);
}

const isTerminal = (e: StreamEvent) => e.type === "done" || e.type === "error";

/* --------------------------------- photo set -------------------------------- */

type PhotoSet = Map<string, Photo>;
const keyOf = (phase: Phase, angle: Angle) => `${phase}/${angle}`;

function photoSet(rentalId: string): PhotoSet {
  const map: PhotoSet = new Map();
  for (const p of listPhotos(rentalId)) map.set(keyOf(p.phase, p.angle), p);
  return map;
}

export function missingPhotos(set: PhotoSet): string[] {
  const out: string[] = [];
  for (const phase of PHASES) for (const angle of ANGLES) if (!set.has(keyOf(phase, angle))) out.push(keyOf(phase, angle));
  return out;
}

/** SHA-256 over the twelve photo files, in fixed phase and angle order. */
export function hashPhotoSet(set: PhotoSet): string {
  const h = createHash("sha256");
  for (const phase of PHASES) {
    for (const angle of ANGLES) {
      const photo = set.get(keyOf(phase, angle))!;
      const fileHash = createHash("sha256").update(readStoredPhoto(photo.path)).digest("hex");
      h.update(`${keyOf(phase, angle)}:${fileHash}\n`);
    }
  }
  return h.digest("hex");
}

/* --------------------------------- opening --------------------------------- */

function attach(run: Run, backlog: StreamEvent[]): OpenResult {
  return {
    kind: "stream",
    backlog,
    finished: backlog.some(isTerminal),
    subscribe: (listener) => {
      run.listeners.add(listener);
      return () => run.listeners.delete(listener);
    },
  };
}

function replayOf(inspection: Inspection): OpenResult {
  const backlog: StreamEvent[] = [{ type: "step", label: "Showing the saved inspection" }];
  for (const finding of inspection.findings) backlog.push({ type: "finding", finding });
  backlog.push({ type: "done", inspectionId: inspection.id });
  return { kind: "stream", backlog, finished: true, subscribe: () => () => {} };
}

const SETTLED_STATES = new Set(["verdict_ready", "contested", "settling", "settled"]);

/**
 * Starts the inspection, or joins one that is already running. Everything up to and including
 * the registration of the run is synchronous, so two simultaneous requests cannot both start an agent.
 */
export function openInspection(rentalId: string, ip: string): OpenResult {
  const rental = getRental(rentalId);
  if (!rental) return { kind: "error", status: 404, message: "Rental not found." };

  // Join a run that is already in progress, from this or an earlier connection.
  const live = runs.get(rentalId);
  if (live) return attach(live, currentRunBacklog(rentalId));

  if (SETTLED_STATES.has(rental.status)) {
    const existing = getLatestInspection(rentalId);
    if (existing) return replayOf(existing);
    return { kind: "error", status: 409, message: "This rental has no saved inspection." };
  }

  // "inspecting" with no live run means the server restarted mid-run. Recover so it can be retried.
  if (rental.status === "inspecting") setRentalStatus(rentalId, "returned");
  else if (rental.status !== "returned") {
    return { kind: "error", status: 409, message: "The inspection starts after the return photos are submitted." };
  }

  const set = photoSet(rentalId);
  const missing = missingPhotos(set);
  if (missing.length > 0) {
    return { kind: "error", status: 409, message: `Missing photos: ${missing.join(", ")}.` };
  }

  let photoHash: string;
  try {
    photoHash = hashPhotoSet(set);
  } catch {
    return { kind: "error", status: 500, message: "A stored photo could not be read. Please retake the photos." };
  }

  const cached = findInspectionByHash(photoHash);
  if (!cached) {
    if (!aiConfigured()) {
      return { kind: "error", status: 503, message: "The AI inspector is not configured on this server (ANTHROPIC_API_KEY is missing)." };
    }
    const slot = takeInspectionSlot(ip, runs.size);
    if (!slot.ok) return { kind: "error", status: 429, message: slot.message, retryAfterSec: slot.retryAfterSec };
  }

  // Register the run before any await.
  // Claim the status atomically, so an owner release that got there first (or a concurrent start) wins cleanly.
  if (!claimStatus(rentalId, ["returned"], "inspecting")) {
    return { kind: "error", status: 409, message: "This rental changed state. Reload and check its status." };
  }
  const run: Run = { rentalId, listeners: new Set() };
  runs.set(rentalId, run);
  persist(rentalId, { type: "started" });

  const emit = (event: StreamEvent) => {
    try {
      persist(rentalId, event);
    } catch {
      /* recording must never break the run */
    }
    for (const l of [...run.listeners]) {
      try {
        l(event);
      } catch {
        run.listeners.delete(l);
      }
    }
  };

  void execute(run, set, photoHash, cached, emit);
  // execute() may already have emitted (a cache hit finishes synchronously), so read the backlog now.
  return attach(run, currentRunBacklog(rentalId));
}

/* ---------------------------------- running --------------------------------- */

async function execute(
  run: Run,
  set: PhotoSet,
  photoHash: string,
  cached: Inspection | null,
  emit: (e: StreamEvent) => void,
): Promise<void> {
  const rentalId = run.rentalId;
  try {
    const rental = getRental(rentalId)!;
    let inspection: Inspection;

    if (cached) {
      emit({ type: "step", label: "Matched an earlier inspection of these exact photos" });
      for (const finding of cached.findings) emit({ type: "finding", finding });
      inspection =
        cached.rental_id === rentalId
          ? cached
          : saveInspection({
              rental_id: rentalId,
              photo_hash: photoHash,
              findings: cached.findings,
              summary: cached.summary,
              model: cached.model,
              usage: { cached: true, source_inspection_id: cached.id },
            });
    } else {
      const images = new Map<string, Promise<AgentImage>>();
      const loadImage = (phase: Phase, angle: Angle) => {
        const k = keyOf(phase, angle);
        if (!images.has(k)) {
          const photo = set.get(k)!;
          images.set(
            k,
            Promise.resolve().then(() => ({
              mediaType: mediaTypeForPath(photo.path),
              data: readStoredPhoto(photo.path).toString("base64"),
            })),
          );
        }
        return images.get(k)!;
      };
      const result = await runInspectionAgent({
        rental,
        paypalOrderId: getPayPalOrderId(rentalId),
        loadImage,
        emit: (e) => emit(e),
        client: getClient(),
      });
      inspection = saveInspection({
        rental_id: rentalId,
        photo_hash: photoHash,
        findings: result.findings,
        summary: result.summary,
        model: result.model || MODEL,
        usage: result.usage,
      });
    }

    setRentalStatus(rentalId, "verdict_ready");
    emit({ type: "done", inspectionId: inspection.id });
  } catch (error) {
    const message = error instanceof InspectionError ? error.message : describeAiError(error).message;
    console.error("[inspection] failed", rentalId, error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    try {
      setRentalStatus(rentalId, "returned"); // back to a retryable state
    } catch {
      /* ignore */
    }
    emit({ type: "error", message });
  } finally {
    runs.delete(rentalId);
  }
}

/** Test helper: forget any in-memory runs. */
export function resetRunsForTests(): void {
  runs.clear();
}
