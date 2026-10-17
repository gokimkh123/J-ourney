import type { AgentInfo } from './types.ts';

export type Position = { lat: number; lng: number };

export type MapAgentData = {
  id: string;
  name: string;
  color: string;
  chips: AgentInfo['chips'];
  lat: number;
  lng: number;
  searching: boolean;
};

/** 회의가 시작되면 AI들이 처음 모여 있는 곳(부산역 앞). 조사할 곳이 정해지면 여기서 걸어 나간다. */
export const GATHER_POINT: Position = { lat: 35.1152, lng: 129.0422 };

/**
 * 지도에 올릴 AI 목록을 "항상 모두" 보이게 한다.
 * 위치가 아직 없는 AI(회의 시작 직후)는 모이는 곳에, 위치가 잠깐 비는 AI(조사를 마치고 후보가 나오기 전)는
 * 마지막으로 있던 곳에 둔다. 그래서 캐릭터가 나타났다 사라지지 않고, 새 위치로는 걸어서 이동한다.
 * memory는 AI별 마지막 위치를 담는 바탕 저장소이고, 이 함수가 갱신한다. 참가자가 비면(새 회의) 비운다.
 */
export function keepAgentsVisible(
  current: MapAgentData[],
  roster: AgentInfo[],
  memory: Map<string, Position>,
): MapAgentData[] {
  if (roster.length === 0) {
    memory.clear();
    return current;
  }
  return roster.map((agent) => {
    const now = current.find((a) => a.id === agent.agentId);
    if (now !== undefined) {
      memory.set(agent.agentId, { lat: now.lat, lng: now.lng });
      return now;
    }
    const pos = memory.get(agent.agentId) ?? GATHER_POINT;
    memory.set(agent.agentId, pos);
    return {
      id: agent.agentId,
      name: agent.nickname,
      color: agent.color,
      chips: agent.chips,
      lat: pos.lat,
      lng: pos.lng,
      searching: false,
    };
  });
}
