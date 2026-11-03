import type { MeetingPhase } from './types.ts';

/** 회의 화면 아래 시트 높이. 0 접힘 · 1 가운데(처음) · 2 펼침 · 3 끝까지 */
export type SheetLevel = 0 | 1 | 2 | 3;

/**
 * 회의 단계가 바뀔 때 시트를 옮길 높이(옮기지 않으면 null). 사람이 읽고 골라야 하는 때만 펼친다.
 * ① 조사 시작 → 가운데 · ③ 사람 확인 → 끝까지(11/3) · ⑤ 사람 확인 뒤 동선 짜기 → 가운데 · ⑧ 합의 뒤 A·B 고르기(실서버) → 끝까지
 */
export function sheetLevelFor(prev: MeetingPhase, next: MeetingPhase, live: boolean): SheetLevel | null {
  if (prev === next) return null;
  // 사람 확인("이 장소들, 넣을까요?")은 안건을 다 읽고 골라야 해서 시트를 끝까지 올린다(11/3 결정).
  if (next === 'reviewing') return 3;
  if (next === 'researching') return 1;
  // 합의안이 나오면(실서버: A·B 고르기) 시트를 끝까지 올린다(11/3 결정).
  if (next === 'agreed' && live) return 3;
  return null;
}
