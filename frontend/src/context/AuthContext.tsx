import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, saveToken, saveRefreshToken, clearToken, getToken } from "../api/client";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

type User = {
  user_id: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: string;
  kyc_status: string;
  wallet_balance: number;
  ride_miles: number;
  tier: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  requestPhoneOtp: (phone: string) => Promise<{ challenge_id: string; expires_in: number; dev_otp?: string }>;
  verifyPhoneOtp: (challengeId: string, phone: string, otp: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | undefined>(undefined);

/**
 * Register the device's Expo push token with our backend.
 * Called after every successful login / session restore.
 * Silently no-ops on web or if the user denies notification permission.
 */
async function registerPushToken(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    await api("/push/register", {
      method: "POST",
      body: { token, platform: Platform.OS },
    });
  } catch {
    // Best-effort — never block login
  }
}

async function unregisterPushToken(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    await api(`/push/register?token=${encodeURIComponent(tokenData.data)}`, {
      method: "DELETE",
    });
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) {
        setUser(null);
        return;
      }
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Process Google session_id from URL on web
      if (Platform.OS === "web") {
        try {
          const hash = globalThis.window?.location?.hash || "";
          const search = globalThis.window?.location?.search || "";
          let sid: string | null = null;
          const hashMatch = hash.match(/session_id=([^&]+)/);
          const queryMatch = search.match(/session_id=([^&]+)/);
          if (hashMatch) sid = decodeURIComponent(hashMatch[1]);
          else if (queryMatch) sid = decodeURIComponent(queryMatch[1]);
          if (sid) {
            const res = await api<{ access_token: string; refresh_token?: string; user: User }>("/auth/google/session", {
              method: "POST",
              body: { session_id: sid },
              auth: false,
            });
            await saveToken(res.access_token);
            await saveRefreshToken(res.refresh_token);
            setUser(res.user);
            try {
              globalThis.window?.history?.replaceState(null, "", globalThis.window.location.pathname);
            } catch {}
            setLoading(false);
            return;
          }
        } catch {
          // ignore
        }
      }
      await refresh();
      setLoading(false);
      // Register push token after initial session restore on native
      await registerPushToken();
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string; refresh_token?: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await saveToken(res.access_token);
    await saveRefreshToken(res.refresh_token);
    setUser(res.user);
    await registerPushToken();
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await api<{ access_token: string; refresh_token?: string; user: User }>("/auth/register", {
      method: "POST",
      body: { email, password, name },
      auth: false,
    });
    await saveToken(res.access_token);
    await saveRefreshToken(res.refresh_token);
    setUser(res.user);
    await registerPushToken();
  }, []);

  const loginWithGoogle = useCallback(async () => {
    throw new Error("Google sign-in is now app-owned. Configure Google OAuth client IDs in backend before enabling live login.");
  }, []);

  const loginWithApple = useCallback(async () => {
    throw new Error("Apple sign-in needs an Apple Developer configuration before live login.");
  }, []);

  const requestPhoneOtp = useCallback(async (phone: string) => {
    return api<{ challenge_id: string; expires_in: number; dev_otp?: string }>("/auth/phone/request-otp", {
      method: "POST",
      body: { phone },
      auth: false,
    });
  }, []);

  const verifyPhoneOtp = useCallback(async (challengeId: string, phone: string, otp: string, name?: string) => {
    const res = await api<{ access_token: string; refresh_token?: string; user: User }>("/auth/phone/verify-otp", {
      method: "POST",
      body: { challenge_id: challengeId, phone, otp, name },
      auth: false,
    });
    await saveToken(res.access_token);
    await saveRefreshToken(res.refresh_token);
    setUser(res.user);
    await registerPushToken();
  }, []);

  const logout = useCallback(async () => {
    await unregisterPushToken();
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, loginWithGoogle, loginWithApple, requestPhoneOtp, verifyPhoneOtp, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
