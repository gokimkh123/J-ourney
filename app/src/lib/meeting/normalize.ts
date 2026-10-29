import type { MeetingAgreedData, ServerEvent } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 명세 v2.3의 meeting.agreed(두 안 plans[])를 앱이 읽는 한 안짜리 모양으로 바꾼다.
 * 대표 안은 만족도 평균이 높은 쪽(같으면 앞의 안). 서버의 양보는 "못 지킨 것"뿐이라 gave에 담고 got은 비운다.
 */
function normalizeAgreed(data: Record<string, unknown>): MeetingAgreedData {
  const plans = Array.isArray(data.plans) ? data.plans.filter(isRecord) : [];
  const average = (p: Record<string, unknown>): number => (isRecord(p.satisfaction) ? num(p.satisfaction.average) : 0);
  let best: Record<string, unknown> | undefined;
  for (const p of plans) if (best === undefined || average(p) > average(best)) best = p;

  const members = best !== undefined && isRecord(best.satisfaction) && Array.isArray(best.satisfaction.members) ? best.satisfaction.members : [];
  const satisfaction: MeetingAgreedData['satisfaction'] = [];
  for (const m of members) {
    if (isRecord(m) && typeof m.memberId === 'string') satisfaction.push({ memberId: m.memberId, score: num(m.score) });
  }

  const concessions: MeetingAgreedData['concessions'] = [];
  for (const c of best !== undefined && Array.isArray(best.concessions) ? best.concessions : []) {
    if (!isRecord(c) || typeof c.memberId !== 'string') continue;
    const names = (list: unknown): string[] => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
    const gave = [...names(c.mustMissed), ...names(c.warned)].join(', ');
    if (gave !== '') concessions.push({ memberId: c.memberId, gave, got: '' });
  }

  return {
    planId: typeof best?.planId === 'string' ? best.planId : '',
    round: num(data.rounds ?? data.round),
    durationSec: num(data.durationSec),
    proposalCount: num(data.proposalCount),
    editCount: num(data.editCount),
    satisfaction,
    concessions,
  };
}

/**
 * 서버(실서버)가 보내는 모양과 앱이 읽는 모양의 차이를 맞춘다. 맞출 게 없으면 받은 객체를 그대로 돌려준다.
 * - meeting.started: 성향 칩이 글자 목록(["..."])으로 오면 {label, emoji: ''}로 바꾼다
 * - board.updated: 좌표가 없는 후보는 지도에 둘 수 없어 뺀다
 * - meeting.agreed: v2.3의 두 안(plans[]) 모양이면 한 안짜리로 바꾼다(옛 모양은 그대로)
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
  if (event.type === 'meeting.agreed') {
    const data: Record<string, unknown> = event.data;
    if (Array.isArray(data.satisfaction) && Array.isArray(data.concessions)) return event;
    return { ...event, data: normalizeAgreed(data) };
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
