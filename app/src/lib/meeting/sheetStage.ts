import type { MeetingPhase } from './types.ts';

/** 회의 화면 아래 시트 높이. 0 접힘 · 1 가운데(처음) · 2 펼침 */
export type SheetLevel = 0 | 1 | 2;

/**
 * 회의 단계가 바뀔 때 시트를 옮길 높이(옮기지 않으면 null). 사람이 읽고 골라야 하는 때만 펼친다.
 * ① 조사 시작 → 가운데 · ③ 사람 확인 → 펼침 · ⑤ 사람 확인 뒤 동선 짜기 → 가운데 · ⑧ 합의 뒤 A·B 고르기(실서버) → 펼침
 */
export function sheetLevelFor(prev: MeetingPhase, next: MeetingPhase, live: boolean): SheetLevel | null {
  if (prev === next) return null;
  if (next === 'reviewing') return 2;
  if (next === 'researching') return 1;
  if (next === 'agreed' && live) return 2;
  return null;
}
