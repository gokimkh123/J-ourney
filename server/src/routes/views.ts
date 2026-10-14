import type { members, trips } from '../db/schema.js';

/** 구성원 색상: 참여 순서(자리 번호)대로 배정 (명세서 3장) */
export const MEMBER_COLORS = ['#F97316', '#EC4899', '#0EA5E9', '#10B981'] as const;

type Trip = typeof trips.$inferSelect;
type Member = typeof members.$inferSelect;

export const memberColor = (m: Member) => MEMBER_COLORS[m.seat - 1];

export const tripView = (t: Trip) => ({ id: t.id, title: t.title, inviteCode: t.inviteCode, status: t.status });

/** title: 페르소나 유형명 (페르소나를 만들기 전에는 null) */
export const memberView = (m: Member, title: string | null) => ({
  id: m.id,
  nickname: m.nickname,
  color: memberColor(m),
  isHost: m.isHost,
  personaReady: title !== null,
  title,
});
