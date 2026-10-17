import { createValueStore } from '../store/valueStore.ts';
import type { MeetingState } from './types.ts';

/** 회의가 합의로 끝났을 때의 최종 상태. B2 회의 화면이 넣고 B3 합의안 화면이 읽는다. 서버가 열리면 서버 값으로 바뀐다. */
export const meetingResultStore = createValueStore<MeetingState | null>(null);
