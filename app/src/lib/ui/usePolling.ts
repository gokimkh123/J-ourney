import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * 화면이 보이는 동안 fn을 반복해서 부른다. 다음 호출은 이전 호출이 끝난 뒤 intervalMs 후에 예약하므로
 * 응답이 느려도 요청이 겹치지 않는다. 앱이 백그라운드로 가면 멈추고, 돌아오면 바로 한 번 부른 뒤 이어 간다.
 * enabled가 false이거나 restartKey가 바뀌면 이전 반복을 끝내고 새로 시작한다.
 */
export function usePolling(fn: () => Promise<void>, intervalMs: number, enabled: boolean, restartKey: unknown): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let alive = true;
      let active = AppState.currentState !== 'background';
      let inFlight = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const clear = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      const run = async () => {
        timer = null;
        if (!alive || !active || inFlight) return;
        inFlight = true;
        try {
          await fnRef.current();
        } catch {
          // 오류 표시는 fn이 맡는다. 반복은 계속한다.
        } finally {
          inFlight = false;
        }
        if (alive && active && timer === null) timer = setTimeout(() => void run(), intervalMs);
      };

      const sub = AppState.addEventListener('change', (state) => {
        const wasActive = active;
        active = state === 'active';
        if (!active) clear();
        else if (!wasActive) {
          clear();
          void run();
        }
      });

      void run();
      return () => {
        alive = false;
        clear();
        sub.remove();
      };
    }, [enabled, intervalMs, restartKey]),
  );
}
