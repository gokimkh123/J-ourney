import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveConfig } from './config.ts';

test('resolveConfig: 아무것도 지정하지 않으면 mock 모드', () => {
  assert.deepEqual(resolveConfig({}), { apiBaseUrl: '', useMock: true, warning: null });
});

test('resolveConfig: 주소만 지정하면 서버 모드', () => {
  assert.deepEqual(resolveConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:8080' }), {
    apiBaseUrl: 'http://10.0.2.2:8080',
    useMock: false,
    warning: null,
  });
});

test('resolveConfig: 앞뒤 공백과 끝 슬래시 제거', () => {
  assert.equal(
    resolveConfig({ EXPO_PUBLIC_API_BASE_URL: '  http://host:8080/  ' }).apiBaseUrl,
    'http://host:8080',
  );
  assert.equal(
    resolveConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://host///' }).apiBaseUrl,
    'http://host',
  );
});

test('resolveConfig: 주소 없이 useMock=false 요청 시 강제 mock과 경고', () => {
  for (const addr of [undefined, '', '   ', ' / ']) {
    const result = resolveConfig({
      EXPO_PUBLIC_API_BASE_URL: addr,
      EXPO_PUBLIC_USE_MOCK: 'false',
    });
    assert.equal(result.apiBaseUrl, '');
    assert.equal(result.useMock, true);
    assert.equal(typeof result.warning, 'string');
    assert.ok(result.warning !== null && result.warning.length > 0);
  }
});

test('resolveConfig: "true"/"1" 은 mock 사용', () => {
  for (const flag of ['true', '1']) {
    assert.deepEqual(
      resolveConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://host', EXPO_PUBLIC_USE_MOCK: flag }),
      { apiBaseUrl: 'http://host', useMock: true, warning: null },
    );
  }
});

test('resolveConfig: "false"/"0" 은 주소가 있으면 서버 모드', () => {
  for (const flag of ['false', '0']) {
    assert.deepEqual(
      resolveConfig({ EXPO_PUBLIC_API_BASE_URL: 'http://host', EXPO_PUBLIC_USE_MOCK: flag }),
      { apiBaseUrl: 'http://host', useMock: false, warning: null },
    );
  }
});

test('resolveConfig: 주소 없이 "true"/"1" 이면 경고 없이 mock', () => {
  for (const flag of ['true', '1']) {
    assert.deepEqual(resolveConfig({ EXPO_PUBLIC_USE_MOCK: flag }), {
      apiBaseUrl: '',
      useMock: true,
      warning: null,
    });
  }
});
