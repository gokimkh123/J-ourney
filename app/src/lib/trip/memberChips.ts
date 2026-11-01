import type { Chip, Member } from '../persona/types.ts';

/**
 * 캐릭터 소품을 정할 성향 칩. 서버가 구성원 칩을 보내 주면 그걸 쓰고,
 * 아니면 나만 이 폰에 저장된 성향 칩으로 채운다(친구는 소품 없이 선다).
 * 성향 검사 전이면 캐릭터가 없으니 빈 목록.
 */
export function memberChips(member: Pick<Member, 'id' | 'personaReady' | 'chips'>, myMemberId: string | undefined, myChips: Chip[]): Chip[] {
  if (!member.personaReady) return [];
  if (member.chips !== undefined) return member.chips;
  return member.id === myMemberId ? myChips : [];
}
