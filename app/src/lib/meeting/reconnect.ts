const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export function nextDelayMs(attempt: number): number {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(BASE_DELAY_MS * 2 ** n, MAX_DELAY_MS);
}

export function buildWsUrl(params: {
  baseUrl: string;
  tripId: string;
  token: string;
  afterSeq?: number;
}): string {
  const { baseUrl, tripId, token, afterSeq = 0 } = params;
  const origin = baseUrl
    .replace(/\/+$/, '')
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');
  return `${origin}/api/v1/trips/${tripId}/ws?token=${encodeURIComponent(token)}&afterSeq=${afterSeq}`;
}
