import { createValueStore } from '../store/valueStore.ts';
import { initialMeetingState } from './reducer.ts';
import type { MeetingState } from './types.ts';

/** 이 폰에서 방금 시작한 회의의 번호(여행별). 회의 화면이 옛 회의를 숨기는 데 쓰고, 앱을 끄면 사라진다. */
export const startedMeetingStore = createValueStore<Record<string, string>>({});

export function rememberStartedMeeting(tripId: string, meetingId: string): void {
  startedMeetingStore.set({ ...startedMeetingStore.get(), [tripId]: meetingId });
}

/**
 * 시작한 회의가 아직 안 보인 동안(옛 회의가 마지막으로 남아 있을 때) 빈 상태를 돌려준다.
 * expected가 null이면(이 폰에서 시작하지 않음) 받은 그대로 둔다.
 */
export function onlyMeeting(state: MeetingState, expected: string | null): MeetingState {
  if (expected === null || state.meetingId === null || state.meetingId === expected) return state;
  return { ...initialMeetingState(), lastSeq: state.lastSeq };
}
