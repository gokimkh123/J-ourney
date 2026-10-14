import type { FetchLike } from './client.ts';

export type MockRequest = {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
};

export type MockResult = { status: number; body: unknown };

export type MockRoute = {
  method: string;
  path: string;
  handler: (request: MockRequest) => MockResult;
};

const API_PREFIX = '/api/v1';

export const defaultRoutes: MockRoute[] = [
  {
    method: 'GET',
    path: `${API_PREFIX}/health`,
    handler: () => ({ status: 200, body: { status: 'ok', mock: true } }),
  },
];

function splitUrl(url: string): { path: string; query: Record<string, string> } {
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const [beforeHash] = rest.split('#');
  const index = beforeHash.indexOf('?');
  const path = index === -1 ? beforeHash : beforeHash.slice(0, index);
  const query: Record<string, string> = {};
  if (index !== -1) {
    for (const pair of beforeHash.slice(index + 1).split('&')) {
      if (pair === '') continue;
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      try {
        query[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        query[key] = value;
      }
    }
  }
  return { path: path === '' ? '/' : path, query };
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        params[expected.slice(1)] = actual;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function parseBody(text: string | undefined): unknown {
  if (text === undefined || text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function lowerHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

export function createMockFetch(extraRoutes: MockRoute[] = []): FetchLike {
  const routes = [...defaultRoutes, ...extraRoutes];

  return async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { path, query } = splitUrl(url);

    let result: MockResult | null = null;
    for (const route of routes) {
      if (route.method.toUpperCase() !== method) continue;
      const params = matchPath(route.path, path);
      if (params === null) continue;
      result = route.handler({
        params,
        query,
        headers: lowerHeaders(init?.headers),
        body: parseBody(init?.body),
      });
      break;
    }
    if (result === null) {
      result = {
        status: 404,
        body: {
          error: { code: 'NOT_FOUND', message: `${method} ${path} 경로를 찾을 수 없습니다.` },
        },
      };
    }

    const { status, body } = result;
    const text = body === undefined ? '' : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
}
