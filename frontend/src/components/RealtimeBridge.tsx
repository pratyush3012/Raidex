import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getToken } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { captureError } from "../observability/sentry";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || "";

function toWsUrl(baseUrl: string, token: string) {
  const wsBase = baseUrl.replace(/^http/i, "ws").replace(/\/$/, "");
  return `${wsBase}/api/ws?token=${encodeURIComponent(token)}`;
}

export function RealtimeBridge() {
  const { user, refresh } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const close = () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };

    const connect = async () => {
      if (!user || !BACKEND || cancelled || AppState.currentState !== "active") return;
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const ws = new WebSocket(toWsUrl(BACKEND, token));
        wsRef.current = ws;

        ws.onmessage = () => {
          refresh().catch((error) => captureError(error, { source: "realtime-refresh" }));
        };
        ws.onerror = (event) => {
          captureError(new Error("Realtime socket error"), { source: "realtime", event: JSON.stringify(event) });
        };
        ws.onclose = () => {
          if (!cancelled) {
            retryRef.current = setTimeout(connect, 4000);
          }
        };
      } catch (error) {
        captureError(error, { source: "realtime-connect" });
      }
    };

    connect();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") connect();
      else close();
    });

    return () => {
      cancelled = true;
      sub.remove();
      close();
    };
  }, [refresh, user]);

  return null;
}
