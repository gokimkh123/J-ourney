import { resolveAccessKey, resolveConfig } from './config.ts';

export const config = resolveConfig({
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_USE_MOCK: process.env.EXPO_PUBLIC_USE_MOCK,
});

/** 팀 접근 키. 비어 있으면 ''. 값을 화면·로그에 내보내지 않는다. */
export const accessKey = resolveAccessKey({
  EXPO_PUBLIC_ACCESS_KEY: process.env.EXPO_PUBLIC_ACCESS_KEY,
});
