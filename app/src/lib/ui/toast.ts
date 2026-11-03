import { createValueStore } from '../store/valueStore.ts';

/** 잠깐 떴다 사라지는 알림 한 줄. 같은 글을 또 띄워도 다시 보이게 id가 늘 바뀐다. */
export type Toast = { id: number; text: string };

export const toastStore = createValueStore<Toast | null>(null);

let lastId = 0;

/** 동작이 끝났음을 짧게 알린다(파티 없애기·나가기, 진행하기, 후기 지우기 등). 화면 아래 ToastHost가 보여 준다. */
export function showToast(text: string): void {
  lastId += 1;
  toastStore.set({ id: lastId, text });
}
