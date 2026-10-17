import { busanAgents } from '../meeting/fixtures/busan.ts';
import type { MemberRef } from '../meeting/view.ts';
import { busanPlan } from './fixtures/busanPlan.ts';
import type { Plan } from './types.ts';

/** 서버 연결 전까지 일정 화면이 보여 주는 가짜 합의 일정(부산). */
export const currentPlan: Plan = busanPlan;

/** 일정의 memberId를 이름·색으로 바꾸기 위한 구성원 목록 */
export const currentMembers: MemberRef[] = busanAgents.map((a) => ({
  memberId: a.memberId,
  name: a.nickname,
  color: a.color,
}));
