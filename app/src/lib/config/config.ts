export type ConfigEnv = {
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_USE_MOCK?: string;
  EXPO_PUBLIC_ACCESS_KEY?: string;
};

export type AppConfig = {
  apiBaseUrl: string;
  useMock: boolean;
  warning: string | null;
};

const FORCED_MOCK_WARNING =
  '서버 주소(EXPO_PUBLIC_API_BASE_URL)가 설정되지 않아 가짜 데이터 모드로 실행합니다.';

export function resolveConfig(env: ConfigEnv): AppConfig {
  const apiBaseUrl = (env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const flag = (env.EXPO_PUBLIC_USE_MOCK ?? '').trim();

  let requested: boolean;
  if (flag === 'true' || flag === '1') {
    requested = true;
  } else if (flag === 'false' || flag === '0') {
    requested = false;
  } else {
    requested = apiBaseUrl === '';
  }

  if (!requested && apiBaseUrl === '') {
    return { apiBaseUrl, useMock: true, warning: FORCED_MOCK_WARNING };
  }
  return { apiBaseUrl, useMock: requested, warning: null };
}

/** 서버가 이보다 긴 값은 접근 키로 보지 않는다(명세서 3장) */
const ACCESS_KEY_MAX = 200;

/**
 * 팀 접근 키(EXPO_PUBLIC_ACCESS_KEY). 비어 있거나 헤더에 못 쓰는 값이면 ''이고, 그러면 헤더를 보내지 않는다.
 * 키는 .env.local에만 두고 코드·로그·화면에는 넣지 않는다.
 */
export function resolveAccessKey(env: ConfigEnv): string {
  const key = (env.EXPO_PUBLIC_ACCESS_KEY ?? '').trim();
  if (key === '' || key.length > ACCESS_KEY_MAX || /[\r\n]/.test(key)) return '';
  return key;
}
