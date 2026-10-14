import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';

export type HealthResult = { ok: true; latencyMs: number } | { ok: false; error: ApiError };

const UNKNOWN_MESSAGE = '알 수 없는 오류가 발생했습니다.';

export async function checkHealth(
  client: Pick<ApiClient, 'get'>,
  now: () => number = Date.now,
): Promise<HealthResult> {
  const start = now();
  try {
    await client.get('/health', { auth: false });
    return { ok: true, latencyMs: now() - start };
  } catch (error) {
    // 2xx 응답을 받았으나 본문이 JSON이 아니어서 파싱만 실패한 경우도 성공으로 본다.
    if (error instanceof ApiError && error.status >= 200 && error.status < 300) {
      return { ok: true, latencyMs: now() - start };
    }
    if (error instanceof ApiError) return { ok: false, error };
    return { ok: false, error: new ApiError(0, 'UNKNOWN_ERROR', UNKNOWN_MESSAGE) };
  }
}
