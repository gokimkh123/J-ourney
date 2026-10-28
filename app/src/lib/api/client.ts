import { createNetworkError, createTimeoutError, parseApiError } from './errors.ts';

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type QueryValue = string | number | boolean | undefined;

export type RequestOptions = {
  body?: unknown;
  query?: Record<string, QueryValue>;
  auth?: boolean;
  timeoutMs?: number;
};

export type ApiClientOptions = {
  baseUrl: string;
  fetchFn: FetchLike;
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** 접근 키. 값이 있으면 모든 요청에 X-Access-Key 헤더로 보낸다(서버가 터널 요청에만 확인함). */
  getAccessKey?: () => string | undefined;
  timeoutMs?: number;
};

export type ApiClient = {
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
  get(path: string, options?: Omit<RequestOptions, 'body'>): Promise<unknown>;
  post(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<unknown>;
  put(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<unknown>;
};

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function createApiClient({
  baseUrl,
  fetchFn,
  getToken,
  getAccessKey,
  timeoutMs = 10000,
}: ApiClientOptions): ApiClient {
  async function request(
    method: string,
    path: string,
    { body, query, auth = true, timeoutMs: requestTimeoutMs }: RequestOptions = {},
  ): Promise<unknown> {
    const limitMs = requestTimeoutMs ?? timeoutMs;
    const url = `${baseUrl}/api/v1${path}${buildQuery(query)}`;
    const headers: Record<string, string> = {};
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const accessKey = getAccessKey?.();
    if (accessKey) headers['X-Access-Key'] = accessKey;
    if (auth && getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(createTimeoutError());
      }, limitMs);
    });

    const work = (async (): Promise<unknown> => {
      let status: number;
      let ok: boolean;
      let text: string;
      try {
        const response = await fetchFn(url, {
          method,
          headers,
          body: payload,
          signal: controller.signal,
        });
        status = response.status;
        ok = response.ok;
        text = await response.text();
      } catch {
        throw createNetworkError();
      }

      if (!ok) throw parseApiError(status, text);
      if (text.trim() === '') return null;
      try {
        return JSON.parse(text);
      } catch {
        throw parseApiError(status, text);
      }
    })();
    // 시간 초과로 경쟁에서 진 뒤의 거부가 처리되지 않은 rejection이 되지 않게 한다.
    work.catch(() => {});

    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
  };
}
