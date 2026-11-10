"use client";

import { useEffect, useState } from "react";

const key = (id: string) => `handback.renter.${id}`;

/** Kept for this page session only, so a blocked-storage browser can still finish without a reload. */
const memory = new Map<string, string>();

/** Returns true when the token was stored durably. False means storage is unavailable. */
export function saveRenterToken(id: string, token: string): boolean {
  memory.set(id, token);
  try {
    localStorage.setItem(key(id), token);
    return localStorage.getItem(key(id)) === token;
  } catch {
    return false;
  }
}

export function readRenterToken(id: string): string | null {
  try {
    const t = localStorage.getItem(key(id));
    if (t) return t;
  } catch {
    /* fall through to the in-memory copy */
  }
  return memory.get(id) ?? null;
}

/** Header object to spread into fetch headers. Empty when this browser has no token. */
export function renterHeaders(id: string): Record<string, string> {
  const t = readRenterToken(id);
  return t ? { "x-renter-token": t } : {};
}

/** undefined until read on the client, then the token or null. */
export function useRenterToken(id: string): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(readRenterToken(id)), [id]);
  return token;
}

export const NO_RENTER_TOKEN_MESSAGE =
  "This rental can only be continued in the browser that placed the hold. Open the link on the phone or computer you used to authorize it.";

export function NoRenterTokenNotice() {
  return (
    <p role="alert" className="mb-4 border-l-4 border-amber bg-amber-wash px-3 py-2">
      {NO_RENTER_TOKEN_MESSAGE}
    </p>
  );
}
