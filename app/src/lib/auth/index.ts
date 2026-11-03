import { asyncStorageAdapter } from '../storage/asyncStorage.ts';
import { createLoginStore } from './loginStore.ts';

/** 이 폰의 카카오 로그인. 없으면(null) 로그인하지 않은 채로 쓴다. */
export const login = createLoginStore(asyncStorageAdapter);
