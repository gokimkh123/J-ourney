export type HomeStep = 'persona' | 'waiting' | 'conditions' | 'meeting' | 'result';

export type HomeMember = { id: string; personaReady: boolean };

export type HomeStepInput = {
  /** 구성원 목록을 아직 못 받았으면 null */
  members: HomeMember[] | null;
  myMemberId: string;
  hasConditions: boolean;
  hasResult: boolean;
};

export type HomeStepView = {
  step: HomeStep;
  readyCount: number;
  total: number;
  /** 단계 표시줄에서 몇 번째까지 끝났는지(0~4). persona=0, waiting=1, conditions=2, meeting=3, result=4 */
  doneCount: number;
};

const ORDER: HomeStep[] = ['persona', 'waiting', 'conditions', 'meeting', 'result'];

/**
 * 홈의 "지금 할 일"을 정한다. 앞 단계가 끝나지 않았으면 뒤 단계로 건너뛰지 않는다.
 * 1) 내 성향 검사 전 → persona  2) 아직 준비 안 된 사람이 있음 → waiting
 * 3) 조건 없음 → conditions  4) 합의안 없음 → meeting  5) 합의안 있음 → result
 * 목록을 아직 못 받았으면 가장 앞 단계(persona)로 보되, 화면은 불러오는 중으로 표시한다.
 */
export function homeStep({ members, myMemberId, hasConditions, hasResult }: HomeStepInput): HomeStepView {
  const list = members ?? [];
  const readyCount = list.filter((m) => m.personaReady).length;
  const total = list.length;
  const me = list.find((m) => m.id === myMemberId);

  let step: HomeStep;
  if (members === null || me === undefined || !me.personaReady) step = 'persona';
  else if (readyCount < total) step = 'waiting';
  else if (!hasConditions) step = 'conditions';
  else if (!hasResult) step = 'meeting';
  else step = 'result';

  return { step, readyCount, total, doneCount: ORDER.indexOf(step) };
}
