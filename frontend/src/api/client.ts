import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { captureError } from "../observability/sentry";
import { enqueueRequest, getCached, isOnline, setCached } from "../utils/offline";

function backendUrl() {
  return process.env["EXPO_PUBLIC_BACKEND_URL"] || (process.env.NODE_ENV === "test" ? "https://api.raidex.test" : "");
}
const KEY = "ridex_token";
const REFRESH_KEY = "ridex_refresh_token";
const REQUEST_TIMEOUT_MS = 15000;

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

export async function saveRefreshToken(token?: string | null) {
  if (!token) return;
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(REFRESH_KEY, token);
    } catch {}
  } else {
    await SecureStore.setItemAsync(REFRESH_KEY, token);
  }
}

async function getRefreshToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(REFRESH_KEY) ?? null;
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearToken() {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.removeItem(KEY);
      globalThis.localStorage?.removeItem(REFRESH_KEY);
    } catch {}
  } else {
    await SecureStore.deleteItemAsync(KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh_token = await getRefreshToken();
  if (!refresh_token) return false;
  const backend = backendUrl();
  if (!backend) return false;
  try {
    const res = await fetch(`${backend}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    await saveToken(json.access_token);
    await saveRefreshToken(json.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean; cache?: boolean; queueOnFailure?: boolean; _retried?: boolean } = {}
): Promise<T> {
  const backend = backendUrl();
  if (!backend) {
    throw new Error("Backend URL is not configured");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const method = opts.method || "GET";
  const cacheKey = `${method}:${path}`;
  if (method === "GET" && opts.cache) {
    const online = await isOnline();
    if (!online) {
      const cached = await getCached<{ value: T; cachedAt: string }>(cacheKey);
      if (cached) return cached.value;
    }
  }
  if (opts.auth !== false) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${backend}/api${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    captureError(e, { path, method });
    if (method !== "GET" && opts.queueOnFailure) {
      await enqueueRequest({ path, method, body: opts.body });
      return { queued: true } as T;
    }
    if (method === "GET" && opts.cache) {
      const cached = await getCached<{ value: T; cachedAt: string }>(cacheKey);
      if (cached) return cached.value;
    }
    if (e?.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw new Error("Could not reach Raidex servers. Please try again.");
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 401 && opts.auth !== false && !opts._retried) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return api<T>(path, { ...opts, auth: true, _retried: true });
    }
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    captureError(new Error(detail), { path, method, status: res.status });
    throw new Error(detail);
  }
  if (res.status === 204) return {} as T;
  const json = (await res.json()) as T;
  if (method === "GET" && opts.cache) {
    await setCached(cacheKey, json);
  }
  return json;
}

export { getToken };
