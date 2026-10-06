import type { NtfyMessage } from "./types";

export const EVENT_MESSAGE = "message";
export const EVENT_MESSAGE_DELETE = "message_delete";
export const EVENT_MESSAGE_CLEAR = "message_clear";
const NOTIFICATION_EVENTS = new Set([EVENT_MESSAGE, EVENT_MESSAGE_DELETE, EVENT_MESSAGE_CLEAR]);

/** Parses one line of ntfy's JSON stream. Returns null for keepalives, open events, junk. */
export function parseLine(line: string): NtfyMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const data = JSON.parse(trimmed);
    if (!data || typeof data !== "object") return null;
    if (!NOTIFICATION_EVENTS.has(data.event)) return null;
    if (typeof data.id !== "string" || typeof data.time !== "number" || typeof data.topic !== "string") return null;
    return data as NtfyMessage;
  } catch {
    return null;
  }
}

/** Parses a newline-delimited JSON body (poll response). */
export function parseNdjson(body: string): NtfyMessage[] {
  return body.split("\n").map(parseLine).filter((m): m is NtfyMessage => m !== null);
}

/** The id ntfy uses to address a message for update/delete/clear. */
export const sequenceId = (m: NtfyMessage) => m.sequence_id || m.id;

/** True when a sync-topic message asks clients to refetch the catalog (contract §14.3). */
export function isSyncEvent(m: NtfyMessage): boolean {
  if (m.event !== EVENT_MESSAGE || !m.message) return false;
  try {
    return JSON.parse(m.message)?.event === "sync";
  } catch {
    return false;
  }
}

const backoff = [1, 2, 5, 10, 20, 30, 60];
/** Reconnect delay in seconds for the n-th consecutive failure. */
export const retryDelay = (attempt: number) => backoff[Math.min(attempt, backoff.length - 1)];
