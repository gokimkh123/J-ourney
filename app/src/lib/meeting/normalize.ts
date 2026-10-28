import type { ServerEvent } from './types.ts';

/**
 * 서버(실서버)가 보내는 모양과 앱이 읽는 모양의 차이를 맞춘다. 맞출 게 없으면 받은 객체를 그대로 돌려준다.
 * - meeting.started: 성향 칩이 글자 목록(["..."])으로 오면 {label, emoji: ''}로 바꾼다
 * - board.updated: 좌표가 없는 후보는 지도에 둘 수 없어 뺀다
 */
export function normalizeServerEvent(event: ServerEvent): ServerEvent {
  if (event.type === 'meeting.started') {
    const agents = event.data.agents;
    if (!Array.isArray(agents)) return event;
    let changed = false;
    const next = agents.map((agent) => {
      const chips: unknown = agent?.chips;
      if (!Array.isArray(chips)) {
        changed = true;
        return { ...agent, chips: [] };
      }
      if (chips.every((c) => typeof c === 'object' && c !== null)) return agent;
      changed = true;
      return {
        ...agent,
        chips: chips.map((c: unknown) =>
          typeof c === 'string' ? { label: c, emoji: '' } : (c as { label: string; emoji: string }),
        ),
      };
    });
    return changed ? { ...event, data: { ...event.data, agents: next } } : event;
  }
  if (event.type === 'board.updated') {
    const candidates = event.data.candidates;
    if (!Array.isArray(candidates)) return { ...event, data: { candidates: [], agenda: event.data.agenda ?? [] } };
    const kept = candidates.filter((c) => typeof c?.lat === 'number' && typeof c?.lng === 'number');
    if (kept.length === candidates.length && Array.isArray(event.data.agenda)) return event;
    return { ...event, data: { ...event.data, candidates: kept, agenda: Array.isArray(event.data.agenda) ? event.data.agenda : [] } };
  }
  return event;
}
