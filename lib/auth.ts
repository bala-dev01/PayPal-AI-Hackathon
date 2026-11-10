import "server-only";
import { NextResponse } from "next/server";
import { verifyOwnerToken, verifyRenterToken } from "./db";

/** Header carrying the renter token, minted once when the hold is authorized. */
export const RENTER_HEADER = "x-renter-token";
export const OWNER_HEADER = "x-owner-token";

/** True when the request carries this rental's renter token. Constant-time compare. */
export function isRenter(req: Request, rentalId: string): boolean {
  return verifyRenterToken(rentalId, req.headers.get(RENTER_HEADER));
}

/** True when the request carries this rental's owner token. Constant-time compare. */
export function isOwner(req: Request, rentalId: string): boolean {
  return verifyOwnerToken(rentalId, req.headers.get(OWNER_HEADER));
}

export const renterRequired = () =>
  NextResponse.json({ error: "Renter token required. Send the x-renter-token you received when the hold was placed." }, { status: 401 });

export const ownerRequired = () =>
  NextResponse.json({ error: "Owner token required." }, { status: 401 });
