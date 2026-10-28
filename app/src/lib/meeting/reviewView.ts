import type { ReviewChoice } from './serverMeeting.ts';
import type { Board, MeetingState, ReviewItemData } from './types.ts';

/** 안건별로 사람이 고른 것: true 넣기, false 빼기. 안 고른 안건은 키가 없다. */
export type ReviewPicks = Record<string, boolean>;

export function remainingCount(items: ReviewItemData[], picks: ReviewPicks): number {
  return items.filter((item) => picks[item.placeId] === undefined).length;
}

/** 서버는 안건 전부에 답을 받는다. 하나라도 안 골랐으면 보낼 수 없다. */
export function canSend(items: ReviewItemData[], picks: ReviewPicks): boolean {
  return items.length > 0 && remainingCount(items, picks) === 0;
}

export function sendLabel(items: ReviewItemData[], picks: ReviewPicks): string {
  const left = remainingCount(items, picks);
  return left === 0 ? '내 선택 보내기' : `${left}개 더 골라 주세요`;
}

/** 오른쪽 위 "1/2" */
export function pickedCountLabel(items: ReviewItemData[], picks: ReviewPicks): string {
  return `${items.length - remainingCount(items, picks)}/${items.length}`;
}

/** 서버가 받는 모양으로 바꾼다. 안건 순서를 지키고, 안 고른 안건이 있으면 null. */
export function toChoices(items: ReviewItemData[], picks: ReviewPicks): ReviewChoice[] | null {
  if (!canSend(items, picks)) return null;
  return items.map((item) => ({ placeId: item.placeId, keep: picks[item.placeId] === true }));
}

/**
 * 시연 모드에서 앱이 대신 고르는 답. 그 사람의 AI가 후보 보드에서 조심·반대를 단 곳은 빼고, 나머지는 넣는다.
 * 보드에 없는 안건은 넣는다.
 */
export function autoChoices(items: ReviewItemData[], board: Board, agentId: string): ReviewChoice[] {
  return items.map((item) => {
    const candidate = board.candidates.find((c) => c.placeId === item.placeId);
    const reaction = candidate?.reactions.find((r) => r.agentId === agentId);
    return { placeId: item.placeId, keep: !(reaction?.kind === 'warn' || reaction?.kind === 'block') };
  });
}

/** 방장이 아닌 구성원 몫의 시연 자동 답. 방장 본인 몫은 사람이 직접 낸다. */
export function demoAnswers(state: MeetingState, hostMemberId: string): { memberId: string; choices: ReviewChoice[] }[] {
  const items = state.review?.items ?? [];
  return state.agents
    .filter((agent) => agent.memberId !== hostMemberId)
    .map((agent) => ({ memberId: agent.memberId, choices: autoChoices(items, state.board, agent.agentId) }));
}

export type ReviewPerson = { memberId: string; name: string; answered: boolean };

/** "✓ 규민  ✓ 지은  현우  서연" 한 줄에 쓸 사람 목록 */
export function reviewPeople(state: MeetingState): ReviewPerson[] {
  const answeredBy = state.review?.answeredBy ?? [];
  return state.agents.map((agent) => ({
    memberId: agent.memberId,
    name: agent.nickname,
    answered: answeredBy.includes(agent.memberId),
  }));
}

/** 오른쪽 위 "2/4" 와 화면 읽기용 문장 */
export function answeredLabel(state: MeetingState): { short: string; spoken: string } {
  const answered = state.review?.answered ?? 0;
  const total = state.review?.total ?? 0;
  return { short: `${answered}/${total}`, spoken: `${total}명 중 ${answered}명 답했어요` };
}

/** 아직 안 답한 사람 이름(진행 확인 창에 쓴다). */
export function pendingNames(state: MeetingState): string[] {
  return reviewPeople(state)
    .filter((p) => !p.answered)
    .map((p) => p.name);
}

/** 내가 이미 보냈는가 */
export function hasAnswered(state: MeetingState, memberId: string): boolean {
  return state.review?.answeredBy.includes(memberId) ?? false;
}

/** 안건 번호(1부터). 지도 핀과 카드가 같은 번호를 쓴다. */
export function itemNumber(items: ReviewItemData[], placeId: string): number {
  return items.findIndex((i) => i.placeId === placeId) + 1;
}

/** 사람 확인 중 지도 핀: 확인할 안건의 핀에 안건 번호(카드와 같은 번호)를 단다. */
export function reviewPins<T extends { id: string }>(pins: T[], items: ReviewItemData[]): (T & { label?: string })[] {
  return pins.map((pin) => {
    const n = itemNumber(items, pin.id);
    return n === 0 ? pin : { ...pin, label: String(n) };
  });
}
