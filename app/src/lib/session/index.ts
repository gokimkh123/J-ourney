import { asyncStorageAdapter } from '../storage/asyncStorage.ts';
import { createSessionStore } from './session.ts';

export const session = createSessionStore(asyncStorageAdapter);
