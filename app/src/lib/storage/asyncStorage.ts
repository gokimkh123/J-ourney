import AsyncStorage from '@react-native-async-storage/async-storage';

import type { KeyValueStore } from '../session/session.ts';

export const asyncStorageAdapter: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
