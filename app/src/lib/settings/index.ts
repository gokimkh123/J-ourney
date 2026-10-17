import { asyncStorageAdapter } from '../storage/asyncStorage.ts';
import { createThemeModeStore } from './themeMode.ts';

export const themeMode = createThemeModeStore(asyncStorageAdapter);
