import type { ConditionsBody } from './conditions.ts';

/** 서버 명세의 현지 이동 수단: transit(대중교통·택시, 기본) 또는 car(자차) */
export type MoveMode = 'transit' | 'car';

export type ServerConditions = ConditionsBody & { moveMode: MoveMode };

/** 앱의 이동 수단 글자("자동차" 등)로 서버가 길찾기에 쓰는 moveMode를 정한다. 자동차만 car, 나머지는 transit. */
export function moveModeOf(transport: string): MoveMode {
  return transport.trim() === '자동차' ? 'car' : 'transit';
}

/** 서버가 받는 라운드 수 상한(명세 rules.maxRounds 1~5). 앱 화면은 7까지 고르게 되어 있어 보낼 때 맞춘다. */
export const SERVER_MAX_ROUNDS = 5;

export function toServerConditions(body: ConditionsBody): ServerConditions {
  return {
    ...body,
    moveMode: moveModeOf(body.transport),
    rules: { ...body.rules, maxRounds: Math.min(body.rules.maxRounds, SERVER_MAX_ROUNDS) },
  };
}

/** PUT /trips/{id}/conditions 응답: 서버가 목적지를 법정동 코드로 바꿔 저장한 결과 */
export type SavedConditions = { regionCode: string; label: string };

export function parseSavedConditions(json: unknown): SavedConditions {
  const d = (json as { destination?: { regionCode?: unknown; label?: unknown } } | null)?.destination;
  if (typeof d?.regionCode !== 'string' || typeof d.label !== 'string') {
    throw new Error('조건 저장 응답을 읽을 수 없어요');
  }
  return { regionCode: d.regionCode, label: d.label };
}
