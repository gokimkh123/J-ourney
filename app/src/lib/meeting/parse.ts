import { MEETING_EVENT_TYPES } from './types.ts';
import type { MeetingEventType, ServerEvent } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMeetingEventType(type: unknown): type is MeetingEventType {
  return (MEETING_EVENT_TYPES as readonly unknown[]).includes(type);
}

export function parseEvent(text: string): ServerEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  if (raw.type === 'ping') return raw as ServerEvent;
  if (!isMeetingEventType(raw.type)) return null;
  if (!Number.isInteger(raw.seq)) return null;
  if (!isRecord(raw.data)) return null;
  return raw as ServerEvent;
}

export function buildInstruction(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return JSON.stringify({ type: 'user.instruction', data: { text: trimmed } });
}
