import { accessKey, config } from '../config/index.ts';
import { session } from '../session/index.ts';
import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import { createMockFetch } from './mock.ts';
import { createMockRoutes } from './mockRoutes.ts';

const realFetch: FetchLike = (url, init) => fetch(url, init);

export const api = createApiClient({
  baseUrl: config.useMock ? 'http://mock.local' : config.apiBaseUrl,
  fetchFn: config.useMock ? createMockFetch(createMockRoutes()) : realFetch,
  getToken: () => session.getToken(),
  getAccessKey: () => (config.useMock || accessKey === '' ? undefined : accessKey),
});

export const endpoints = createEndpoints(api);
