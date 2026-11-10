const key = (id: string) => `handback.owner.${id}`;

export function saveOwnerToken(id: string, token: string) {
  try {
    localStorage.setItem(key(id), token);
  } catch {
    /* private mode: the owner can still use the renter link */
  }
}

export function readOwnerToken(id: string): string | null {
  try {
    return localStorage.getItem(key(id));
  } catch {
    return null;
  }
}

/** Every owner token this browser holds, for the ledger request. */
export function readAllOwnerTokens(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("handback.owner.")) {
        const v = localStorage.getItem(k);
        if (v) out.push(v);
      }
    }
  } catch {
    /* storage blocked */
  }
  return out;
}
