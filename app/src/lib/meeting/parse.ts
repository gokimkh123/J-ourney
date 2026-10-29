import { normalizeServerEvent } from './normalize.ts';
import { MEETING_EVENT_TYPES, PLAN_FLOW_EVENT_TYPES, REVIEW_EVENT_TYPES } from './types.ts';
import type { MeetingEventType, PlanFlowEventType, ReviewEventType, ServerEvent } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMeetingEventType(type: unknown): type is MeetingEventType | ReviewEventType | PlanFlowEventType {
  return (
    (MEETING_EVENT_TYPES as readonly unknown[]).includes(type) ||
    (REVIEW_EVENT_TYPES as readonly unknown[]).includes(type) ||
    (PLAN_FLOW_EVENT_TYPES as readonly unknown[]).includes(type)
  );
}

export function parseEvent(text: string): ServerEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return parseEventObject(raw);
}

/** 이미 JSON으로 풀린 이벤트(놓친 이벤트 조회 응답 등)를 같은 규칙으로 걸러 낸다. */
export function parseEventObject(raw: unknown): ServerEvent | null {
  if (!isRecord(raw)) return null;

  if (raw.type === 'ping') return raw as ServerEvent;
  if (!isMeetingEventType(raw.type)) return null;
  if (!Number.isInteger(raw.seq)) return null;
  if (!isRecord(raw.data)) return null;
  return normalizeServerEvent(raw as ServerEvent);
}

export function buildInstruction(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return JSON.stringify({ type: 'user.instruction', data: { text: trimmed } });
}
