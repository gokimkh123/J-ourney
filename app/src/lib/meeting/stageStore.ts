import { createValueStore } from '../store/valueStore.ts';

/**
 * 회의가 재생되는 동안 true. 탭바가 이 값을 보고 숨어서 지도가 화면을 더 넓게 쓴다.
 * 일시정지·종료하거나 회의 화면을 벗어나면 false로 돌아와 탭바가 다시 나온다.
 */
export const meetingImmersive = createValueStore(false);
