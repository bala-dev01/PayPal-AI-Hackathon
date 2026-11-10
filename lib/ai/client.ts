import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../env";

/** Model and API settings for every Claude call in the app. */
export const MODEL = "claude-haiku-5-5";
/** Per-shot usability checks run on every photo. */
export const QUALITY_MODEL = "claude-haiku-5-5";

/** Raised when no Anthropic key is configured. Routes turn it into a 503. */
export class AiUnavailableError extends Error {
  constructor(message = "The AI inspector is not configured on this server (ANTHROPIC_API_KEY is missing).") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

let cached: Anthropic | null = null;
let override: Anthropic | null = null;

/** Tests inject a fake client here. Pass null to restore the real one. */
export function setClientForTests(client: unknown): void {
  override = client as Anthropic | null;
}

export function aiConfigured(): boolean {
  return override !== null || Boolean(getEnv().ANTHROPIC_API_KEY);
}

export function getClient(): Anthropic {
  if (override) return override;
  if (cached) return cached;
  const apiKey = getEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiUnavailableError();
  cached = new Anthropic({ apiKey, maxRetries: 2 });
  return cached;
}

export interface DescribedAiError {
  /** HTTP status to report from a route that surfaces this error. */
  status: number;
  /** Safe to show a user. Never contains keys or raw provider payloads. */
  message: string;
  retryable: boolean;
}

/**
 * Typed SDK error chain, most specific first. Never matches on message text.
 */
export function describeAiError(error: unknown): DescribedAiError {
  if (error instanceof AiUnavailableError) {
    return { status: 503, message: error.message, retryable: false };
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: 504, message: "The AI service took too long to respond. Please try again.", retryable: true };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: "Could not reach the AI service. Please try again.", retryable: true };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 502, message: "The AI service rejected the request (the photos may be unreadable).", retryable: false };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 503, message: "The AI service credentials were rejected. The server key needs attention.", retryable: false };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { status: 503, message: "The AI service denied access for this key.", retryable: false };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { status: 503, message: "The configured AI model is not available to this key.", retryable: false };
  }
  if (error instanceof Anthropic.UnprocessableEntityError) {
    return { status: 502, message: "The AI service could not process the request.", retryable: false };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "The AI service is busy right now. Please try again in a minute.", retryable: true };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return { status: 502, message: "The AI service had a temporary problem. Please try again.", retryable: true };
  }
  if (error instanceof Anthropic.APIError) {
    return { status: 502, message: `The AI service returned an error (${error.status ?? "unknown"}).`, retryable: false };
  }
  return { status: 500, message: "The inspection could not be completed.", retryable: true };
}
