import { config } from '../config/index.ts';
import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { createMockFetch } from './mock.ts';

const realFetch: FetchLike = (url, init) => fetch(url, init);

export const api = createApiClient({
  baseUrl: config.useMock ? 'http://mock.local' : config.apiBaseUrl,
  fetchFn: config.useMock ? createMockFetch() : realFetch,
  getToken: () => null,
});
