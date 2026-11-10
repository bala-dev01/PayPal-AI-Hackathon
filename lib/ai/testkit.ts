/** Shared helpers for AI-layer tests. Not imported by app code. */
import type { Angle } from "../types";

export const ALL_ANGLES: Angle[] = ["front", "back", "left", "right", "top", "detail"];

let toolSeq = 0;
export const toolUse = (name: string, input: unknown) => ({
  type: "tool_use" as const,
  id: `toolu_${++toolSeq}`,
  name,
  input,
});

export function message(content: unknown[], stop_reason: string = "tool_use") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

export interface RecordedCall {
  params: Record<string, unknown>;
  /** JSON snapshot of the messages at call time (the live array is mutated afterwards). */
  messages: Array<{ role: string; content: unknown }>;
}

/**
 * A stand-in for the Anthropic client. `script` receives the zero-based call index and
 * returns a message, or throws to simulate an SDK error.
 */
export function fakeClient(script: (call: number, rec: RecordedCall) => unknown | Promise<unknown>) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          const rec: RecordedCall = { params, messages: JSON.parse(JSON.stringify(params.messages)) };
          const index = calls.push(rec) - 1;
          return { finalMessage: async () => script(index, rec) };
        },
        create: async () => {
          throw new Error("create not used in the inspection loop");
        },
      },
    },
  };
}

/** The tool_result blocks in the last user turn of a recorded call. */
export function lastToolResults(rec: RecordedCall): Array<{ is_error?: boolean; content: unknown; tool_use_id: string }> {
  const last = rec.messages[rec.messages.length - 1]!;
  return last.content as Array<{ is_error?: boolean; content: unknown; tool_use_id: string }>;
}

export const validFinding = (over: Record<string, unknown> = {}) => ({
  damage_key: "corner-dent",
  angle: "front",
  title: "Dent on lower left corner",
  description: "A new dent is visible at the lower left corner that is absent in the pickup photo.",
  classification: "new_damage",
  severity: "minor",
  confidence: 0.9,
  region_before: { x: 0.1, y: 0.6, w: 0.2, h: 0.2 },
  region_after: { x: 0.1, y: 0.6, w: 0.2, h: 0.2 },
  ...over,
});
