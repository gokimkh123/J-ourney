import { createValueStore } from '../store/valueStore.ts';

/** 회의 재생 빠르기(1배·2배). 실서버 재생 속도 장치와 가짜 회의 재생이 쉬는 시간을 이 값으로 나눈다. 앱을 끄면 1배로 돌아간다. */
export type MeetingSpeed = 1 | 2;

export const meetingSpeed = createValueStore<MeetingSpeed>(1);

/** 쉬는 시간을 지금 빠르기에 맞춘다. 늦추지 않는 이벤트(0)는 그대로 0. */
export function atSpeed(delayMs: number, speed: MeetingSpeed = meetingSpeed.get()): number {
  return delayMs / speed;
}
