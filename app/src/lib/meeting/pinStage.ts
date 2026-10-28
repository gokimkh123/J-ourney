import type { BoardCandidate } from './types.ts';

/**
 * 조사 단계에서 "AI가 후보 장소로 걸어가 핀을 꽂는" 연출의 순서 계산. 순수 함수만 있고 시간은 다루지 않는다.
 * 새 후보가 생기면 제안한 AI의 줄에 서고, 그 AI는 한 번에 한 곳만 걷는다. 도착(arrive)은 화면이 알려 준다.
 */
export type Spot = { lat: number; lng: number };

export type PinStage = {
  /** 꽂힌 후보(꽂힌 순서) */
  planted: string[];
  /** AI별로 지금 걸어가는 후보 */
  walking: Record<string, string>;
  /** AI별로 기다리는 후보 */
  queues: Record<string, string[]>;
  /** AI별로 마지막에 핀을 꽂고 서 있는 후보. key는 그때의 서버 위치(조사 위치)라서 바뀌면 서버 위치를 따른다. */
  standing: Record<string, { placeId: string; key: string }>;
};

type CandidateRef = Pick<BoardCandidate, 'placeId' | 'proposedBy'>;

/** 두 상태가 같은 내용인가. 화면이 같은 내용으로 다시 맞출 때 상태를 바꾸지 않으려고(다시 그리기 반복 방지) 쓴다. */
export function sameStage(a: PinStage, b: PinStage): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function initialPinStage(): PinStage {
  return { planted: [], walking: {}, queues: {}, standing: {} };
}

function isKnown(stage: PinStage, placeId: string): boolean {
  return (
    stage.planted.includes(placeId) ||
    Object.values(stage.walking).includes(placeId) ||
    Object.values(stage.queues).some((queue) => queue.includes(placeId))
  );
}

/** 걷는 중이 아닌 AI에게 줄의 맨 앞을 걷게 한다. */
function startWalks(stage: PinStage): PinStage {
  const walking = { ...stage.walking };
  const queues: Record<string, string[]> = {};
  for (const [agentId, queue] of Object.entries(stage.queues)) {
    if (walking[agentId] === undefined && queue.length > 0) {
      walking[agentId] = queue[0] as string;
      if (queue.length > 1) queues[agentId] = queue.slice(1);
    } else if (queue.length > 0) {
      queues[agentId] = queue;
    }
  }
  return { ...stage, walking, queues };
}

/**
 * 후보 목록과 맞춘다. 사라진 후보는 빼고, 새 후보는 제안한 AI의 줄에 세운다.
 * animate가 false(조사 단계가 아님, 건너뛰기 등)면 남은 것을 모두 바로 꽂는다.
 * 제안한 AI가 목록에 없으면 걷게 하지 않고 바로 꽂는다.
 */
export function syncPins(
  stage: PinStage,
  candidates: CandidateRef[],
  agentIds: string[],
  animate: boolean,
): PinStage {
  const alive = new Set(candidates.map((c) => c.placeId));

  if (!animate) {
    const planted = stage.planted.filter((id) => alive.has(id));
    for (const c of candidates) if (!planted.includes(c.placeId)) planted.push(c.placeId);
    return { planted, walking: {}, queues: {}, standing: {} };
  }

  const planted = stage.planted.filter((id) => alive.has(id));
  const walking: Record<string, string> = {};
  for (const [agentId, placeId] of Object.entries(stage.walking)) {
    if (alive.has(placeId)) walking[agentId] = placeId;
  }
  const queues: Record<string, string[]> = {};
  for (const [agentId, queue] of Object.entries(stage.queues)) {
    const kept = queue.filter((id) => alive.has(id));
    if (kept.length > 0) queues[agentId] = kept;
  }
  const standing: PinStage['standing'] = {};
  for (const [agentId, s] of Object.entries(stage.standing)) {
    if (alive.has(s.placeId)) standing[agentId] = s;
  }

  const next: PinStage = { planted, walking, queues, standing };
  for (const c of candidates) {
    if (isKnown(next, c.placeId)) continue;
    const owner = c.proposedBy.find((id) => agentIds.includes(id));
    if (owner === undefined) {
      planted.push(c.placeId);
    } else {
      queues[owner] = [...(queues[owner] ?? []), c.placeId];
    }
  }
  return startWalks(next);
}

/** agentId가 걸어가던 곳에 도착해 핀을 꽂았다. key는 그 AI의 지금 서버 위치를 나타내는 문자열. */
export function arrive(stage: PinStage, agentId: string, key: string): PinStage {
  const placeId = stage.walking[agentId];
  if (placeId === undefined) return stage;
  const walking = { ...stage.walking };
  delete walking[agentId];
  return startWalks({
    ...stage,
    planted: [...stage.planted, placeId],
    walking,
    standing: { ...stage.standing, [agentId]: { placeId, key } },
  });
}

/** 연출 때문에 AI가 서 있어야 할 자리. 없으면 undefined(서버가 알려 준 위치를 따른다). */
export function stageSpot(
  stage: PinStage,
  agentId: string,
  candidates: Pick<BoardCandidate, 'placeId' | 'lat' | 'lng'>[],
  key: string,
): Spot | undefined {
  const target = stage.walking[agentId];
  const standing = stage.standing[agentId];
  const placeId = target ?? (standing !== undefined && standing.key === key ? standing.placeId : undefined);
  if (placeId === undefined) return undefined;
  const found = candidates.find((c) => c.placeId === placeId);
  return found === undefined ? undefined : { lat: found.lat, lng: found.lng };
}

/** 이 AI 뒤에 기다리는 후보 수. 많이 밀리면 화면이 더 빨리 걷게 한다. */
export function backlog(stage: PinStage, agentId: string): number {
  return stage.queues[agentId]?.length ?? 0;
}

export function isPlanted(stage: PinStage, placeId: string): boolean {
  return stage.planted.includes(placeId);
}
