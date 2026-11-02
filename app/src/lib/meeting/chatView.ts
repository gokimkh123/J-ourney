import type { AgentInfo } from './types.ts';

/** speechFeed 한 줄에서 대화 탭이 쓰는 칸 */
export type ChatSource = { seq: number; agentId: string; name: string; color: string; chips: AgentInfo['chips']; text: string; round: number };

export type ChatItem =
  | { type: 'divider'; key: string; label: string }
  | {
      type: 'message';
      key: string;
      /** 이 폰 주인의 AI 말(오른쪽) */
      mine: boolean;
      text: string;
      /** 이어서 말한 묶음의 첫 말에만(다른 AI만). 아니면 null */
      name: string | null;
      /** 묶음의 마지막 말에만 얼굴. 아니면 null(얼굴 자리만 비움) */
      face: { name: string; color: string; chips: AgentInfo['chips'] } | null;
    };

/** 라운드 구분 글: 조사 중 말(라운드 0)은 "조사 중" */
export function roundLabel(round: number): string {
  return round === 0 ? '조사 중' : `${round}라운드`;
}

/**
 * 회의 대화를 채팅처럼(오래된 말이 위). 라운드가 바뀔 때마다 구분 줄을 넣고,
 * 같은 AI가 같은 라운드에 이어서 말하면 한 묶음으로 본다(이름은 첫 말, 얼굴은 마지막 말에만).
 */
export function chatItems(feed: ChatSource[], myAgentId: string | null): ChatItem[] {
  const sorted = [...feed].sort((a, b) => a.seq - b.seq);
  const items: ChatItem[] = [];
  sorted.forEach((m, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    if (prev === undefined || prev.round !== m.round) items.push({ type: 'divider', key: `round-${m.round}-${m.seq}`, label: roundLabel(m.round) });
    const mine = myAgentId !== null && m.agentId === myAgentId;
    const first = prev === undefined || prev.agentId !== m.agentId || prev.round !== m.round;
    const last = next === undefined || next.agentId !== m.agentId || next.round !== m.round;
    items.push({
      type: 'message',
      key: `msg-${m.seq}`,
      mine,
      text: m.text,
      name: first && !mine ? m.name : null,
      face: last ? { name: m.name, color: m.color, chips: m.chips } : null,
    });
  });
  return items;
}

/** 이 폰 주인의 AI(구성원 id → 에이전트 id). 없으면 null */
export function myAgentIdOf(agents: Pick<AgentInfo, 'agentId' | 'memberId'>[], memberId: string | null): string | null {
  if (memberId === null) return null;
  return agents.find((a) => a.memberId === memberId)?.agentId ?? null;
}
