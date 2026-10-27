/**
 * 같은 키의 작업을 한 줄로 세워 차례로 실행하는 함수를 만듦 (앞 작업이 실패해도 다음 작업은 실행함)
 * 줄이 비면 키를 지워 메모리에 남지 않음. 서버는 한 대라 메모리로 충분함
 */
export function laneQueue() {
  const tails = new Map<string, Promise<unknown>>();
  const run = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const result = (tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
  /** 지금 줄이 남은 키 수 (시험·확인용) */
  run.size = () => tails.size;
  return run;
}
