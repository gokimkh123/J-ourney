import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useSyncExternalStore } from 'react';

import { endpoints } from '../api/index.ts';
import { ApiError } from '../api/errors.ts';
import { config } from '../config/index.ts';
import { parties } from '../session/index.ts';
import { kakaoStartUrl, parseLoginReturn, type LoginReturn } from './login.ts';
import { login } from './index.ts';
import { restoreMyTrips, type RestoreResult } from './restore.ts';

// 가짜 데이터 모드는 브라우저를 열지 않고 가짜 서버의 카카오 로그인을 바로 부른다(카카오 토큰 자리에 아무 글자나).
const MOCK_KAKAO_TOKEN = 'mock-kakao-user';

/**
 * 카카오 로그인(브라우저, 명세 v2.6 4.8절): 서버 로그인 시작 주소를 로그인 창으로 열고, 서버가 앱 주소로 돌려준 로그인 토큰을 받는다.
 * 앱 주소: APK journey://auth · Expo Go exp://…/--/auth. 카카오 키는 서버에만 있다(앱에는 없음).
 * 성공하면 저장까지 한다. 사람이 창을 닫았거나(cancel·dismiss) 카카오 동의 화면에서 취소하면 cancelled.
 */
export async function signInWithKakao(): Promise<LoginReturn> {
  let result: LoginReturn;
  if (config.useMock) {
    result = { kind: 'ok', login: await endpoints.loginKakao(MOCK_KAKAO_TOKEN) };
  } else {
    const returnTo = Linking.createURL('auth');
    const opened = await WebBrowser.openAuthSessionAsync(kakaoStartUrl(config.apiBaseUrl, returnTo), returnTo);
    if (opened.type !== 'success') return { kind: 'cancelled' };
    result = parseLoginReturn(opened.url);
  }
  if (result.kind === 'ok') await login.save(result.login);
  return result;
}

/** 로그인 뒤 내 여행 되찾기. 로그인 토큰이 만료·무효(401)면 로그아웃 상태로 돌리고 null. */
export async function restoreAfterLogin(): Promise<RestoreResult | null> {
  try {
    return await restoreMyTrips({
      getMyTripIds: () => endpoints.getMyTripIds(),
      reissueTripToken: (tripId) => endpoints.reissueTripToken(tripId),
      localTripIds: () => parties.list().map((p) => p.tripId),
      add: (session) => parties.add(session),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) await login.clear();
    return null;
  }
}

/** 로그아웃: 서버에서 이 기기 토큰을 지우고(실패해도) 폰에서도 지운다. 들어가 있는 파티는 그대로 둔다. */
export async function signOut(): Promise<void> {
  await endpoints.logout().catch(() => undefined);
  await login.clear();
}

export function useLogin() {
  return useSyncExternalStore(login.subscribe, login.get, login.get);
}

// 로그인 화면을 이번 실행에서 넘겼는지(카카오 로그인·네이버·구글). 앱을 다시 켜면 로그인 전이면 다시 나온다.
let passed = false;
const gateListeners = new Set<() => void>();
const setPassed = (value: boolean) => {
  passed = value;
  for (const listener of [...gateListeners]) listener();
};

export const loginGate = {
  /** 로그인 화면을 지나 홈으로 */
  pass: () => setPassed(true),
  /** 설정의 '카카오로 로그인': 로그인 화면을 다시 띄운다 */
  reopen: () => setPassed(false),
  subscribe(listener: () => void) {
    gateListeners.add(listener);
    return () => {
      gateListeners.delete(listener);
    };
  },
  get: () => passed,
};

/** 로그인 화면을 보여야 하면 true: 로그인하지 않았고 이번 실행에서 아직 넘기지 않았을 때 */
export function useLoginGateOpen(): boolean {
  const me = useLogin();
  const done = useSyncExternalStore(loginGate.subscribe, loginGate.get, loginGate.get);
  return me === null && !done;
}
