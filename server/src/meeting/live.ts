import { WebSocketServer } from 'ws';
import type { Db } from '../db/client.js';
import { nowKst } from '../lib/time.js';
import { type EventPublisher, type MeetingEnvelope, eventsAfter } from './runs.js';

/**
 * 실시간 연결(WebSocket) 규칙 값
 * pingMs: 연결이 살아 있는지 보내는 간격 (명세서 5장 ping 25초)
 * perMember: 구성원 1명이 동시에 여는 연결 수 (10/19 사용자 결정 2개). 넘으면 가장 오래된 연결을 닫음 (끊긴 연결이 남아도 새 연결이 바로 붙게)
 * maxPayloadBytes: 앱이 보내는 글 하나의 상한. 서버는 앱의 글을 받지 않으므로 작게 두고, 넘으면 연결을 닫음 (ws 기본 100MB를 메모리에 모으지 않게)
 */
export const LIVE = { pingMs: 25_000, perMember: 2, maxPayloadBytes: 1024 } as const;

/** 서버가 쓰는 WebSocket 받는 곳 (HTTP 서버의 업그레이드로만 받음, 앱이 보내는 글은 maxPayloadBytes까지) */
export const liveSocketServer = () => new WebSocketServer({ noServer: true, maxPayload: LIVE.maxPayloadBytes });

type Listener = (e: MeetingEnvelope) => void;

/** 여행별로 열린 연결에 이벤트를 보냄. 서버는 한 대라 메모리에 둠 (기록은 DB, 놓친 것은 afterSeq로 DB에서 다시 받음) */
export class EventHub implements EventPublisher {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly sockets = new Map<string, { close: () => void }[]>();

  subscribe(tripId: string, listener: Listener): () => void {
    let set = this.listeners.get(tripId);
    if (!set) this.listeners.set(tripId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size && this.listeners.get(tripId) === set) this.listeners.delete(tripId);
    };
  }

  publish(e: MeetingEnvelope): void {
    for (const listener of [...(this.listeners.get(e.tripId) ?? [])]) {
      try {
        listener(e);
      } catch (err) {
        console.warn('실시간 전송 실패:', err instanceof Error ? err.message : err);
      }
    }
  }

  /** 지금 열린 연결 수 (시험·확인용) */
  listening(tripId: string): number {
    return this.listeners.get(tripId)?.size ?? 0;
  }

  /** 메모리에 남은 여행·구성원 항목 수 (시험·확인용, 연결이 모두 닫히면 0) */
  entries(): { trips: number; members: number } {
    return { trips: this.listeners.size, members: this.sockets.size };
  }

  /** 구성원의 연결을 등록하고, perMember를 넘으면 가장 오래된 연결을 닫음. 돌려준 함수로 등록을 지움 */
  register(memberId: string, socket: { close: () => void }, perMember: number = LIVE.perMember): () => void {
    const list = this.sockets.get(memberId) ?? [];
    list.push(socket);
    this.sockets.set(memberId, list);
    while (list.length > perMember) list.shift()!.close();
    return () => {
      const i = list.indexOf(socket);
      if (i >= 0) list.splice(i, 1);
      if (!list.length && this.sockets.get(memberId) === list) this.sockets.delete(memberId);
    };
  }
}

/**
 * 연결 하나를 붙임: afterSeq 뒤 이벤트를 DB에서 먼저 보내고, 그 뒤 생기는 이벤트를 바로 보냄 (그 사이에 생긴 것은 모아 두었다가 순번으로 거름)
 * pingMs마다 ping을 보냄. 돌려준 함수를 부르면 멈춤
 */
export function streamTrip(
  db: Db,
  hub: EventHub,
  opts: { tripId: string; afterSeq: number; send: (text: string) => void; onError: (err: unknown) => void; pingMs?: number },
): () => void {
  let last = opts.afterSeq;
  let replaying = true;
  const held: MeetingEnvelope[] = [];
  const deliver = (e: MeetingEnvelope) => {
    if (e.seq <= last) return;
    last = e.seq;
    opts.send(JSON.stringify(e));
  };
  const unsubscribe = hub.subscribe(opts.tripId, (e) => (replaying ? held.push(e) : deliver(e)));
  void (async () => {
    for (const e of await eventsAfter(db, opts.tripId, opts.afterSeq)) deliver(e);
    replaying = false;
    for (const e of held.sort((a, b) => a.seq - b.seq)) deliver(e);
    held.length = 0;
  })().catch(opts.onError);
  const timer = setInterval(() => opts.send(JSON.stringify({ type: 'ping', tripId: opts.tripId, at: nowKst() })), opts.pingMs ?? LIVE.pingMs);
  timer.unref?.();
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
