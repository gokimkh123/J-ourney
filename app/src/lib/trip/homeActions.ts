import type { HomeStep } from './homeStep.ts';

/** 한 여행에 들어올 수 있는 최대 인원(방장 포함). 서버 명세 v1.5와 같다. */
export const MAX_MEMBERS = 4;

export type ActionMember = { id: string; nickname: string; isHost: boolean; personaReady: boolean };

export type HomeActions = {
  isHost: boolean;
  /** 초대 코드 공유 버튼: 내 성향 검사를 마친 뒤 자리가 남아 있을 때 */
  canShare: boolean;
  /** 성향 검사를 안 한 사람들(나 제외)의 닉네임. 비어 있으면 재촉 버튼을 숨긴다. */
  nudgeTargets: string[];
  /** 회의 시작하기 버튼: 방장이고 모두 준비됐을 때 */
  canStart: boolean;
  /** 방장 재촉하기 버튼: 방장이 아니고 모두 준비됐을 때 */
  canNudgeHost: boolean;
};

/**
 * 홈의 "지금 할 일" 카드에 어떤 버튼을 띄울지 정한다. 단계(homeStep)가 정해진 뒤에 쓴다.
 * 성향 검사 전(persona) 단계에서는 아무 버튼도 더하지 않고, 회의가 진행된 뒤(meeting·result)에도 더하지 않는다.
 */
export function homeActions(
  members: ActionMember[] | null,
  myMemberId: string,
  step: HomeStep,
): HomeActions {
  const list = members ?? [];
  const isHost = list.find((m) => m.id === myMemberId)?.isHost ?? false;
  const preparing = step === 'waiting' || step === 'conditions';
  return {
    isHost,
    canShare: preparing && list.length < MAX_MEMBERS,
    nudgeTargets:
      step === 'waiting' ? list.filter((m) => !m.personaReady && m.id !== myMemberId).map((m) => m.nickname) : [],
    canStart: step === 'conditions' && isHost,
    canNudgeHost: step === 'conditions' && !isHost,
  };
}
