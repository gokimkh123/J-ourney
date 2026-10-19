import type { OpenHours } from './hours.js';
import { type Candidate, type MemberInput, RETRIEVE, type RetrieveResult } from './retrieve.js';
import { agentIdOf, placeIdOf } from './runs.js';
import type { Board, BoardCandidate, Reaction, ReactionKind } from './types.js';

/**
 * 4단계 후보 보드 반응 규칙 값 (모두 여기서만 바꿈, 10/15 사용자 결정)
 * score: 6단계 일정 배치가 장소 조합을 고를 때 쓰는 반응 점수 (고름 +2 · 👍 +1 · ⚠ −1, ✕가 하나라도 붙은 곳은 일정안에서 뺌)
 * dayEnd: 끝 시각을 정하지 않은 사람의 하루 끝 · tightMinutes: 하루 시간대가 영업시간을 잘라 이보다 적게 겹치면 ⚠
 * queuePopularity: 줄 서기 싫어요인 사람에게 인기도가 이 값 이상인 음식점은 ⚠ (줄 자료가 없어 인기도로 가늠)
 * 가격 규칙은 장소별 가격 자료가 없어 넣지 않음
 */
export const REACT = {
  score: { proposed: 2, like: 1, warn: -1 },
  dayEnd: '23:00',
  tightMinutes: 60,
  queuePopularity: 85,
  agendaMax: 5,
  reasonsMax: 2,
} as const;

const DAY = 1440;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const clock = (v: number) => {
  const x = ((v % DAY) + DAY) % DAY;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** 영업시간과 하루 시간대(분)가 겹치는 분. 자정을 넘겨 여는 곳(예: 18:00–02:00)은 다음 날까지 셈 */
export function overlapMinutes(open: OpenHours, start: number, end: number): number {
  const close = open.close <= open.open ? open.close + DAY : open.close;
  const until = end <= start ? end + DAY : end;
  return Math.max(0, Math.min(close, until) - Math.max(open.open, start));
}

/**
 * 한 사람이 한 장소에 붙이는 반응. 가장 무거운 것 하나만 붙임 (✕ > ⚠ > 👍)
 * 근거는 2단계가 코드로 맞춘 표시(좋아요·꼭 지킬 것·싫어요·혼잡)와 숫자(인기도·영업시간)뿐이며 문장은 해석하지 않음
 * 고른 사람의 👍는 '고름'으로 이미 보이므로 붙이지 않음 · 숙소는 영업시간을 보지 않음
 */
export function reactionOf(c: Candidate, m: MemberInput, opts: { lodging: boolean; proposed: boolean }): Omit<Reaction, 'agentId'> | null {
  const like: string[] = [];
  const warn: string[] = [];
  const block: string[] = [];
  for (const k of c.marks[m.memberId] ?? []) {
    if (k.kind === 'must') like.unshift(`꼭 지킬 것: ${k.label}`);
    else if (k.kind === 'like') like.push(`좋아요: ${k.label}`);
    else if (k.kind === 'dislike') warn.push(`싫어요: ${k.label}`);
    else warn.push(`혼잡 예측 ${k.label} (상한 ${m.profile.maxCrowd})`);
  }
  if (m.profile.avoidQueue && c.type === RETRIEVE.foodType && c.popularity !== null && c.popularity >= REACT.queuePopularity) {
    warn.push(`인기가 많아서 줄 설 수도 있어요 (인기 ${c.popularity})`);
  }
  if (!opts.lodging && c.open) {
    const start = toMinutes(m.profile.startTime);
    const end = toMinutes(m.profile.endTime ?? REACT.dayEnd);
    const minutes = overlapMinutes(c.open, start, end);
    const length = (c.open.close <= c.open.open ? c.open.close + DAY : c.open.close) - c.open.open;
    if (minutes === 0) {
      const opensLate = c.open.open >= (end <= start ? end + DAY : end);
      block.push(opensLate ? `${clock(c.open.open)}부터 영업 (하루 일정은 ${clock(end)}까지)` : `${clock(c.open.close)}에 영업 끝 (하루 일정은 ${clock(start)}부터)`);
    } else if (minutes < REACT.tightMinutes && minutes < length) {
      // 하루 시간대가 영업시간을 잘라 조금만 남을 때만 (20분짜리 분수 쇼처럼 원래 짧은 곳은 아님)
      warn.push(`영업시간과 ${minutes}분만 겹침 (${clock(c.open.open)}~${clock(c.open.close)})`);
    }
  }
  const [kind, reasons]: [ReactionKind, string[]] | [null, string[]] = block.length ? ['block', block] : warn.length ? ['warn', warn] : like.length && !opts.proposed ? ['like', like] : [null, []];
  return kind ? { kind, reason: reasons.slice(0, REACT.reasonsMax).join(' · ') } : null;
}

/**
 * 회의 안건: ✕가 붙은 곳 먼저, 그다음 ⚠가 많은 곳(여행지 밖이면 ⚠ 하나로 셈, 같으면 고른 사람이 많은 곳), 최대 agendaMax개. 문장은 정해진 틀에 값만 넣음
 * outside: 보드 장소 id → 여행지 밖 시·군·구 이름 · notes: 장소가 없는 메모 (뒤에 붙임)
 */
export function agendaOf(
  candidates: readonly BoardCandidate[],
  members: readonly MemberInput[],
  extra: { outside?: ReadonlyMap<string, string>; notes?: readonly string[] } = {},
): Board['agenda'] {
  const nick = new Map(members.map((m) => [agentIdOf(m.memberId), m.nickname]));
  const mark: Record<ReactionKind, string> = { block: '✕', warn: '⚠', like: '👍' };
  const items = candidates
    .map((c) => ({ c, blocks: c.reactions.filter((r) => r.kind === 'block'), warns: c.reactions.filter((r) => r.kind === 'warn'), outside: extra.outside?.get(c.placeId) ?? null }))
    .filter((x) => x.blocks.length + x.warns.length > 0 || x.outside)
    .sort(
      (a, b) =>
        b.blocks.length - a.blocks.length ||
        b.warns.length + Number(!!b.outside) - (a.warns.length + Number(!!a.outside)) ||
        b.c.proposedBy.length - a.c.proposedBy.length ||
        a.c.placeId.localeCompare(b.c.placeId),
    )
    .slice(0, REACT.agendaMax)
    .map(({ c, blocks, warns, outside }) => {
      const by = c.proposedBy.map((id) => nick.get(id) ?? id).join('·');
      const who = [...blocks, ...warns].map((r) => `${nick.get(r.agentId) ?? r.agentId} ${mark[r.kind]} ${r.reason}`).join(' · ');
      return { placeId: c.placeId, text: `${c.name} — ${by} 고름${outside ? ` · 여행지 밖(${outside})` : ''}${who ? ` ↔ ${who}` : ''}` };
    });
  return [...items, ...(extra.notes ?? []).map((text) => ({ placeId: null, text }))];
}

/** 4단계: 후보 보드의 장소마다 4명의 반응을 붙이고, ⚠·✕가 붙은 곳·여행지 밖에서 넣은 곳을 회의 안건으로 정리함 (코드, LLM 0회) */
export function reactBoard(board: Board, pool: RetrieveResult, members: readonly MemberInput[]): Board {
  const spots = new Map(pool.candidates.map((c) => [placeIdOf(c.id), c]));
  const lodgings = new Map(pool.lodgings.map((c) => [placeIdOf(c.id), c]));
  const candidates = board.candidates.map((b) => {
    const c = spots.get(b.placeId) ?? lodgings.get(b.placeId);
    const reactions: Reaction[] = !c
      ? []
      : members.flatMap((m) => {
          const agentId = agentIdOf(m.memberId);
          const r = reactionOf(c, m, { lodging: lodgings.has(b.placeId), proposed: b.proposedBy.includes(agentId) });
          return r ? [{ agentId, ...r }] : [];
        });
    return { ...b, reactions };
  });
  // 여행지 밖 이름에 편도 어림을 붙여 사람이 5단계에서 넣을지 정하게 함 (예: 영도구, 편도 약 25분)
  const outside = new Map([...pool.candidates, ...pool.lodgings].flatMap((c) => (c.outside ? [[placeIdOf(c.id), c.outsideMinutes !== undefined ? `${c.outside}, 편도 약 ${c.outsideMinutes}분` : c.outside] as const] : [])));
  const nick = new Map(members.map((m) => [m.memberId, m.nickname]));
  const notes = (pool.outsideRules ?? [])
    .filter((r) => r.placeId === null)
    .map((r) =>
      r.minutes !== undefined
        ? `${nick.get(r.memberId) ?? r.memberId}의 꼭 지킬 것 '${r.label}' — 가장 가까운 곳도 여행지 밖(${r.district}) 편도 약 ${r.minutes}분이라 후보에 넣지 못함`
        : `${nick.get(r.memberId) ?? r.memberId}의 꼭 지킬 것 '${r.label}' — 여행지 밖(${r.district})이라 후보에 넣지 못함`,
    )
    // 이름이 달라 AI가 맞춘 꼭 지킬 곳은 사람이 확인할 수 있게 메모로 보임 (5단계 사람 확인 대상)
    .concat((pool.nameMatches ?? []).map((r) => `${nick.get(r.memberId) ?? r.memberId}의 꼭 지킬 것 '${r.keyword}' → ${r.places.join('·')} (이름이 달라 AI가 맞춤)`))
    // 후보에 하나도 없는 꼭 지킬 것은 까닭과 함께 메모로 남김 (표시 없이 빠지지 않게)
    .concat((pool.missingRules ?? []).map((r) => `${nick.get(r.memberId) ?? r.memberId}의 꼭 지킬 것 '${r.label}' — ${r.reason}`));
  return { candidates, agenda: agendaOf(candidates, members, { outside, notes }) };
}

/** 반응 점수 (6단계 일정 배치에서 씀). blocked면 그 장소는 일정안에서 뺌 */
export function reactionScore(c: BoardCandidate): { score: number; blocked: boolean } {
  const count = (k: ReactionKind) => c.reactions.filter((r) => r.kind === k).length;
  return {
    score: c.proposedBy.length * REACT.score.proposed + count('like') * REACT.score.like + count('warn') * REACT.score.warn,
    blocked: count('block') > 0,
  };
}
