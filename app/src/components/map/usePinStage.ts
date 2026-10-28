import { useEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";

import type { MapAgentData } from "../../lib/meeting/agentPositions.ts";
import { arrive, backlog, initialPinStage, isPlanted, sameStage, stageSpot, syncPins, type PinStage } from "../../lib/meeting/pinStage.ts";
import type { BoardCandidate } from "../../lib/meeting/types.ts";
import { VIEW_W, projectGeo } from "./regionArt.ts";
import { walkMs } from "./walk.ts";

// 도착한 뒤 핀이 꽂히는 짧은 멈춤
const PLANT_DWELL_MS = 350;
// 기다리는 후보가 한 곳 늘 때마다 걷는 속도를 이만큼 올려 밀린 핀을 따라잡는다(최대 4배).
const HURRY_STEP = 1;
const HURRY_MAX = 4;

export type StagedAgent = MapAgentData & { speed: number };

const keyOf = (a: { lat: number; lng: number }) => `${a.lat},${a.lng}`;

/**
 * 조사 단계에서 AI가 새 후보로 걸어가 핀을 꽂는 연출을 이끈다(순서 계산은 lib/meeting/pinStage).
 * 돌려주는 agents는 연출 위치를 반영한 목록이고, isVisible은 지도에 보일 핀인지 알려 준다.
 * animate가 false면 모든 핀을 바로 보이게 한다. 도착 시각은 걷는 시간(walkMs)과 같은 식으로 잰다.
 */
export function usePinStage(opts: { candidates: BoardCandidate[]; agents: MapAgentData[]; animate: boolean }) {
  const { candidates, agents, animate } = opts;
  const { width } = useWindowDimensions();
  const scale = width > 0 ? width / VIEW_W : 1;
  const [stage, setStage] = useState<PinStage>(initialPinStage);

  const agentKey = agents.map((a) => a.id).join("|");
  useEffect(() => {
    // 후보 목록이 매번 새 배열로 와도(재생 시작 전 빈 상태 등) 내용이 같으면 상태를 그대로 둬서 다시 그리기가 이어지지 않게 한다.
    setStage((prev) => {
      const next = syncPins(prev, candidates, agentKey === "" ? [] : agentKey.split("|"), animate);
      return sameStage(prev, next) ? prev : next;
    });
  }, [candidates, agentKey, animate]);

  const staged: StagedAgent[] = agents.map((a) => {
    const spot = stageSpot(stage, a.id, candidates, keyOf(a));
    const speed = 1 + Math.min(HURRY_MAX - 1, backlog(stage, a.id) * HURRY_STEP);
    return spot === undefined ? { ...a, speed } : { ...a, lat: spot.lat, lng: spot.lng, speed };
  });

  const shown = useRef(new Map<string, { lat: number; lng: number }>());
  const derivedKeys = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  for (const a of agents) derivedKeys.current.set(a.id, keyOf(a));

  useEffect(() => {
    const live = new Set<string>();
    for (const a of staged) {
      const target = stage.walking[a.id];
      if (target === undefined) continue;
      const id = `${a.id}:${target}`;
      live.add(id);
      if (timers.current.has(id)) continue;
      const from = projectGeo(shown.current.get(a.id) ?? a);
      const to = projectGeo(a);
      const distance = Math.hypot(from.x - to.x, from.y - to.y) * scale;
      const delay = walkMs(distance, a.speed) + PLANT_DWELL_MS / a.speed;
      const agentId = a.id;
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setStage((prev) => arrive(prev, agentId, derivedKeys.current.get(agentId) ?? ""));
        }, delay),
      );
    }
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    for (const a of staged) shown.current.set(a.id, { lat: a.lat, lng: a.lng });
  });

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { agents: staged, isVisible: (placeId: string) => !animate || isPlanted(stage, placeId) };
}
