import { busanAgents } from '../meeting/fixtures/busan.ts';
import type { MemberRef } from '../meeting/view.ts';
import { busanPlanAgreed } from './fixtures/busanPlanAgreed.ts';
import type { Plan } from './types.ts';

/** 서버 연결 전까지 일정 화면이 보여 주는 예시 일정(부산). 회의 재생이 끝나는 첫 합의안(pln_03)과 같은 안이다. */
export const currentPlan: Plan = busanPlanAgreed;

/** 일정의 memberId를 이름·색으로 바꾸기 위한 구성원 목록 */
export const currentMembers: MemberRef[] = busanAgents.map((a) => ({
  memberId: a.memberId,
  name: a.nickname,
  color: a.color,
}));
