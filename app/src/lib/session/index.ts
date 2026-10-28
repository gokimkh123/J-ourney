import { asyncStorageAdapter } from '../storage/asyncStorage.ts';
import { createPartyActions, createPartyBook } from './parties.ts';
import { createSessionStore } from './session.ts';

/** 지금 들어가 있는 파티의 세션. 없으면(null) 초기 화면이다. */
export const session = createSessionStore(asyncStorageAdapter);
/** 이 폰이 참여 중인 모든 파티 */
export const parties = createPartyBook(asyncStorageAdapter);
export const partyActions = createPartyActions(session, parties);
