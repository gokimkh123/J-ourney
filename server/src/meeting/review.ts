import type { MemberInput, RetrieveResult } from './retrieve.js';
import { placeIdOf } from './runs.js';
import type { Board, ReviewChoice, ReviewDecision, ReviewRequest } from './types.js';

/**
 * 5단계 사람 확인 (코드, LLM 0회, 사용자 결정 10/19)
 * - 고르는 안건: 4단계 안건 중 장소가 있는 것 (⚠·✕가 붙은 곳 · 여행지 밖 장소 · 이름이 달라 AI가 맞춘 꼭 지킬 곳), 메모는 보기만 함
 * - 안건마다 다수결, 같으면 방장의 응답으로 정함 · 시간 제한 없음 · 방장이 '진행'으로 마감하면 응답하지 않은 사람은 '남김'으로 셈
 */
export const REVIEW = {
  /** 응답하지 않은 사람의 몫 (방장 '진행' 때) */
  defaultKeep: true,
} as const;

/** 받침이 있으면 '을', 없으면 '를' (한글로 끝나지 않으면 '을(를)') — 문장 틀에 값을 넣을 때만 씀 */
function objectParticle(word: string): string {
  const code = word.trim().charCodeAt(word.trim().length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '을(를)';
  return (code - 0xac00) % 28 ? '을' : '를';
}

/**
 * 4단계 보드에서 사람 확인 요청을 만듦. 안건이 없으면 items가 비어 회의가 멈추지 않음
 * consequence: 그 곳을 빼면 누군가의 꼭 지킬 것을 지킬 곳이 보드에 하나도 남지 않을 때 그 사실을 적음
 */
export function reviewRequestOf(board: Board, pool: RetrieveResult, members: readonly MemberInput[]): ReviewRequest {
  const marksOf = new Map([...pool.candidates, ...pool.lodgings].map((c) => [placeIdOf(c.id), c.marks]));
  const mustLabels = (placeId: string, memberId: string) => (marksOf.get(placeId)?.[memberId] ?? []).filter((k) => k.kind === 'must').map((k) => k.label);
  const items = board.agenda.flatMap((a) => {
    if (a.placeId === null) return [];
    const placeId = a.placeId;
    const name = board.candidates.find((c) => c.placeId === placeId)?.name ?? placeId;
    const lost = members.flatMap((m) =>
      mustLabels(placeId, m.memberId)
        .filter((label) => !board.candidates.some((c) => c.placeId !== placeId && mustLabels(c.placeId, m.memberId).includes(label)))
        .map((label) => `빼면 ${m.nickname}의 '${label}'${objectParticle(label)} 지킬 곳이 없어짐`),
    );
    return [{ placeId, name, text: a.text, consequence: lost.length ? lost.join(' · ') : null }];
  });
  return { items, memos: board.agenda.filter((a) => a.placeId === null).map((a) => a.text) };
}

/**
 * 마감: 안건마다 남김·뺌을 셈. 응답하지 않은 사람은 REVIEW.defaultKeep으로 셈 (4명이 모두 응답했으면 없음)
 * 같으면 방장의 응답(방장이 응답하지 않았으면 기본값)으로 정함
 */
export function tallyReview(
  request: ReviewRequest,
  responses: ReadonlyMap<string, readonly ReviewChoice[]>,
  members: readonly { id: string; isHost: boolean }[],
  closedBy: ReviewDecision['closedBy'],
): ReviewDecision {
  const host = members.find((m) => m.isHost);
  const choiceOf = (memberId: string, placeId: string) => responses.get(memberId)?.find((c) => c.placeId === placeId)?.keep ?? REVIEW.defaultKeep;
  const votes = request.items.map(({ placeId }) => {
    const keep = members.filter((m) => choiceOf(m.id, placeId)).length;
    const drop = members.length - keep;
    const tie = keep === drop;
    return { placeId, keep, drop, tie, kept: tie ? (host ? choiceOf(host.id, placeId) : REVIEW.defaultKeep) : keep > drop };
  });
  return {
    kept: votes.filter((v) => v.kept).map((v) => v.placeId),
    dropped: votes.filter((v) => !v.kept).map((v) => v.placeId),
    votes,
    responded: members.filter((m) => responses.has(m.id)).map((m) => m.id),
    defaulted: members.filter((m) => !responses.has(m.id)).map((m) => m.id),
    closedBy,
  };
}

/** 사람 확인 결과를 보드에 반영: 뺀 곳은 후보와 안건에서 지움 (메모는 그대로) */
export function applyReview(board: Board, decision: ReviewDecision): Board {
  const dropped = new Set(decision.dropped);
  return {
    candidates: board.candidates.filter((c) => !dropped.has(c.placeId)),
    agenda: board.agenda.filter((a) => a.placeId === null || !dropped.has(a.placeId)),
  };
}
