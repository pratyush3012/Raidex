import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const KEY = "ridex_token";

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(KEY);
}

export async function saveToken(token: string) {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(KEY, token);
    } catch {}
  } else {
    await SecureStore.setItemAsync(KEY, token);
  }
}

export async function clearToken() {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.removeItem(KEY);
    } catch {}
  } else {
    await SecureStore.deleteItemAsync(KEY);
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${BACKEND}/api${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export { getToken };
