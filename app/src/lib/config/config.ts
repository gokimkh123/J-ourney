export type ConfigEnv = {
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_USE_MOCK?: string;
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
