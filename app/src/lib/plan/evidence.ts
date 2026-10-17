import type { PlanPlace } from './types.ts';

const SOURCE_LABELS: Record<string, string> = {
  tourapi: '한국관광공사',
  tour: '한국관광공사',
  kakao: '카카오맵',
  naver: '네이버',
};

function sourceLabel(source: string): string {
  return Object.hasOwn(SOURCE_LABELS, source) ? SOURCE_LABELS[source]! : source;
}

/** "2026-10-01" → "2026.10.01". 형식이 다르면 받은 글자 그대로. */
function dotDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m === null ? iso : `${m[1]}.${m[2]}.${m[3]}`;
}

/** "2026-10-24T14:00:00+09:00" → "10월 24일 14:00". 서버가 준 시각(한국 시간)을 그대로 읽는다. */
function checkedLabel(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m === null ? iso : `${Number(m[1])}월 ${Number(m[2])}일 ${m[3]}:${m[4]}`;
}

/** C2 근거 보기 아래에 붙는 "이 정보는 어디서 왔나" 줄들. 빈 값은 "정보 없음". */
export function placeEvidenceRows(place: PlanPlace): { label: string; value: string }[] {
  const sources = [...new Set(place.sources.map(sourceLabel))];
  return [
    { label: '출처', value: sources.length > 0 ? sources.join(' · ') : '정보 없음' },
    { label: '기준일', value: place.baseDate.trim() === '' ? '정보 없음' : dotDate(place.baseDate) },
    { label: '확인일', value: place.checkedAt.trim() === '' ? '정보 없음' : checkedLabel(place.checkedAt) },
  ];
}
