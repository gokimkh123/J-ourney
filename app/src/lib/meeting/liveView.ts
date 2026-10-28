import type { FeedStatus } from './liveFeed.ts';
import type { MeetingPhase } from './types.ts';

export type LiveProgress = 'idle' | 'playing' | 'finished' | 'error';

const ENDED: readonly MeetingPhase[] = ['proposed', 'agreed', 'failed', 'confirmed'];

/**
 * 실서버 회의 화면의 진행 상태. 가짜 회의의 재생 상태(playing·finished·error)와 같은 말로 바꿔 준다.
 * 연결이 끊겨도 이미 받은 내용은 화면에 남기므로, 끊긴 것은 progress가 아니라 banner로 알린다.
 */
export function liveProgress(feed: FeedStatus, phase: MeetingPhase): LiveProgress {
  if (feed === 'failed' || feed === 'replaced') return 'error';
  if (ENDED.includes(phase)) return 'finished';
  if (phase === 'idle') return 'idle';
  return 'playing';
}

/** 화면 위에 띄울 연결 안내. 문제가 없으면 null. */
export function liveBanner(feed: FeedStatus): string | null {
  switch (feed) {
    case 'syncing':
      return '회의 내용을 불러오는 중이에요';
    case 'reconnecting':
      return '연결이 끊겨 다시 붙는 중이에요';
    case 'failed':
      return '서버와 연결하지 못했어요. 화면을 나갔다 다시 들어와 주세요';
    case 'replaced':
      return '다른 화면에서 같은 회의를 열어서 이 화면은 멈췄어요';
    default:
      return null;
  }
}
