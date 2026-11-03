import assert from 'node:assert/strict';
import test from 'node:test';

import { isExpired, kakaoStartUrl, loginErrorText, parseLoginReturn, parseMyTripIds, toLogin } from './login.ts';
import { createLoginStore } from './loginStore.ts';

test('로그인 시작 주소에 돌아올 앱 주소(returnTo)를 싣는다', () => {
  assert.equal(
    kakaoStartUrl('https://api.example.com/', 'exp://192.168.0.5:8081/--/auth'),
    'https://api.example.com/api/v1/auth/kakao/start?returnTo=exp%3A%2F%2F192.168.0.5%3A8081%2F--%2Fauth',
  );
  assert.equal(kakaoStartUrl('https://api.example.com', 'journey://auth'), 'https://api.example.com/api/v1/auth/kakao/start?returnTo=journey%3A%2F%2Fauth');
});

test('돌아온 주소에서 토큰과 만료 시각을 읽는다', () => {
  const r = parseLoginReturn('journey://auth?token=usr_abc&userId=usr_01&expiresAt=2026-12-02T21%3A00%3A00%2B09%3A00');
  assert.deepEqual(r, { kind: 'ok', login: { token: 'usr_abc', expiresAt: '2026-12-02T21:00:00+09:00' } });
});

test('취소·오류·이상한 값은 로그인이 아니다', () => {
  assert.deepEqual(parseLoginReturn('journey://auth?error=LOGIN_CANCELLED'), { kind: 'cancelled' });
  assert.deepEqual(parseLoginReturn('exp://192.168.0.5:8081/--/auth?error=LOGIN_UNAVAILABLE'), { kind: 'error', code: 'LOGIN_UNAVAILABLE' });
  assert.deepEqual(parseLoginReturn('journey://auth?error=UNAUTHORIZED'), { kind: 'error', code: 'UNAUTHORIZED' });
  assert.deepEqual(parseLoginReturn('journey://auth'), { kind: 'error', code: 'unknown' });
  // 구성원 토큰(tok_)이나 읽을 수 없는 시각은 받지 않는다.
  assert.deepEqual(parseLoginReturn('journey://auth?token=tok_x&expiresAt=2026-12-02T21:00:00%2B09:00'), { kind: 'error', code: 'unknown' });
  assert.deepEqual(parseLoginReturn('journey://auth?token=usr_x&expiresAt=nope'), { kind: 'error', code: 'unknown' });
});

test('만료 시각이 지났거나 읽을 수 없으면 만료', () => {
  const now = Date.parse('2026-11-02T12:00:00+09:00');
  assert.equal(isExpired({ token: 'usr_a', expiresAt: '2026-12-02T12:00:00+09:00' }, now), false);
  assert.equal(isExpired({ token: 'usr_a', expiresAt: '2026-11-01T12:00:00+09:00' }, now), true);
  assert.equal(isExpired({ token: 'usr_a', expiresAt: '' }, now), true);
});

test('저장된 값은 usr_ 토큰과 만료 시각이 있어야 로그인으로 읽는다', () => {
  assert.deepEqual(toLogin({ token: 'usr_a', expiresAt: 'x', extra: 1 }), { token: 'usr_a', expiresAt: 'x' });
  assert.equal(toLogin({ token: 'tok_a', expiresAt: 'x' }), null);
  assert.equal(toLogin(null), null);
  assert.equal(toLogin([]), null);
});

test('실패 코드는 화면 문장으로 바꾼다', () => {
  assert.match(loginErrorText('LOGIN_UNAVAILABLE'), /잠시 뒤/);
  assert.match(loginErrorText('뭔가'), /다시 시도/);
});

test('내 여행 목록에서 여행 id만 중복 없이 읽는다', () => {
  assert.deepEqual(parseMyTripIds({ trips: [{ trip: { id: 'trp_1' } }, { trip: { id: 'trp_2' } }, { trip: { id: 'trp_1' } }, { nope: 1 }, null] }), ['trp_1', 'trp_2']);
  assert.deepEqual(parseMyTripIds({}), []);
  assert.deepEqual(parseMyTripIds(null), []);
});

function memoryKv() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => void map.set(k, v),
    removeItem: async (k: string) => void map.delete(k),
  };
}

test('로그인 저장소: 저장·불러오기·지우기, 만료되면 없는 것으로 본다', async () => {
  const kv = memoryKv();
  let now = Date.parse('2026-11-02T12:00:00+09:00');
  const store = createLoginStore(kv, () => now);
  let calls = 0;
  store.subscribe(() => calls++);
  await store.save({ token: 'usr_a', expiresAt: '2026-11-03T12:00:00+09:00' });
  assert.equal(store.getToken(), 'usr_a');

  const again = createLoginStore(kv, () => now);
  assert.deepEqual(await again.load(), { token: 'usr_a', expiresAt: '2026-11-03T12:00:00+09:00' });

  now = Date.parse('2026-11-04T12:00:00+09:00');
  assert.equal(store.get(), null);
  assert.equal(store.getToken(), null);

  await store.clear();
  assert.equal(kv.map.size, 0);
  assert.equal(calls, 2);
});

test('로그인 저장소: 깨진 저장값은 로그아웃 상태로 읽는다', async () => {
  const kv = memoryKv();
  kv.map.set('journey.login.v1', '{깨짐');
  assert.equal(await createLoginStore(kv).load(), null);
});
