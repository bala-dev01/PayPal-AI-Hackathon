"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { renterHeaders } from "./renter-token";
import type { PayPalDispute } from "@/lib/dispute";
import type { Inspection, Photo, PricingResult, Rental, RentalEvent, RentalStatus } from "@/lib/types";

/** Code-computed settlement from the API. Extra fields are optional so we tolerate contract drift. */
export interface Settlement extends PricingResult {
  captureTotalCents?: number;
  feeCents?: number;
}

export type SettlementAuthority = "renter" | "owner" | null;

export interface RentalBundle {
  rental: Rental;
  photos: Photo[];
  inspection: Inspection | null;
  settlement: Settlement | null;
  events: RentalEvent[];
  /** Set only when PayPal reported a dispute for this rental. */
  paypalDispute?: PayPalDispute | null;
  resolutionCenterUrl?: string;
  /** Who started the settlement; the same party may retry a failed one. */
  settlementAuthority?: SettlementAuthority;
  /** Total hold in cents, when the API provides it. */
  holdAmount?: number;
}

export const tagNumber = (id: string) => `H-${id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()}`;

export const photoUrl = (rentalId: string, photoId: string) => `/api/rentals/${rentalId}/photos/${photoId}`;

/** Where a reopened link should land for each status. */
export function routeForStatus(id: string, status: RentalStatus): string {
  switch (status) {
    case "draft":
      return `/r/${id}`;
    case "held":
      return `/r/${id}/pickup`;
    case "picked_up":
      return `/r/${id}/return`;
    case "returned":
    case "inspecting":
      return `/r/${id}/inspection`;
    case "verdict_ready":
    case "contested":
    case "settling":
      return `/r/${id}/verdict`;
    case "settled":
    case "released":
    case "failed":
      return `/r/${id}/record`;
  }
}

/** Specific, human message for a failed response. */
export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 404) return "We couldn't find that. Check the link the owner sent you.";
  if (res.status === 429) return "Too many requests right now. Wait a minute and try again.";
  if (res.status >= 500) return `${fallback} The server hit a problem, so nothing was lost. Try again in a moment.`;
  return fallback;
}

export const NETWORK_MESSAGE = "We couldn't reach Handback. Check your connection, then try again.";

/** Pulls the rental id out of /api/rentals/<id>/..., or "" for other URLs. */
function rentalIdFromUrl(url: string): string {
  return /^\/api\/rentals\/([^/]+)\//.exec(url)?.[1] ?? "";
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...renterHeaders(rentalIdFromUrl(url)) },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error(NETWORK_MESSAGE);
  }
  if (!res.ok) throw new Error(await readError(res, "That didn't go through."));
  return (await res.json()) as T;
}

/**
 * Loads the rental bundle. When `allowed` is given and the status isn't in it,
 * redirects to the step the status belongs to.
 */
export function useRental(id: string, allowed?: RentalStatus[]) {
  const router = useRouter();
  const [data, setData] = useState<RentalBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const allowedKey = allowed?.join(",") ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const res = await fetch(`/api/rentals/${id}`, { cache: "no-store", signal });
        if (!res.ok) {
          setError(
            res.status === 404
              ? "This link doesn't match any rental. Check that you copied the whole link from the owner."
              : await readError(res, "We couldn't load this rental."),
          );
          setLoading(false);
          return null;
        }
        const bundle = (await res.json()) as RentalBundle;
        if (allowedKey && !allowedKey.split(",").includes(bundle.rental.status)) {
          setRedirecting(true);
          router.replace(routeForStatus(id, bundle.rental.status));
          return bundle;
        }
        setData(bundle);
        setLoading(false);
        return bundle;
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
        setError(NETWORK_MESSAGE);
        setLoading(false);
        return null;
      }
    },
    [id, allowedKey, router],
  );

  useEffect(() => {
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  const reload = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  return { data, setData, error, loading, redirecting, reload };
}

export function humanize(s: string): string {
  const t = s.replace(/[_.-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const ANGLE_LABEL: Record<string, string> = {
  front: "Front",
  back: "Back",
  left: "Left side",
  right: "Right side",
  top: "Top",
  detail: "Close-up",
};
