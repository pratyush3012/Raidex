import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const CACHE_PREFIX = "raidex_cache:";
const QUEUE_KEY = "raidex_retry_queue";

type QueuedRequest = {
  id: string;
  path: string;
  method: string;
  body?: any;
  createdAt: string;
};

export async function isOnline() {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCached(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, cachedAt: new Date().toISOString() }));
  } catch {}
}

export async function enqueueRequest(req: Omit<QueuedRequest, "id" | "createdAt">) {
  const current = await getQueue();
  current.push({ ...req, id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString() });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(current.slice(-50)));
}

export async function getQueue(): Promise<QueuedRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearQueue() {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
