import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

function sentryDsn() {
  const key = "EXPO_PUBLIC_" + "SENTRY_DSN";
  return process.env[key] || "";
}

export function initObservability() {
  const dsn = sentryDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env["EXPO_PUBLIC_" + "ENV"] || "development",
    tracesSampleRate: Number(process.env["EXPO_PUBLIC_" + "SENTRY_TRACES_SAMPLE_RATE"] || "0.1"),
    release: `${Constants.expoConfig?.slug || "raidex"}@${Constants.expoConfig?.version || "0.0.0"}`,
  });
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  const dsn = sentryDsn();
  if (!dsn) return;
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
    }
    Sentry.captureException(error);
  });
}

export function wrapRoot<T extends React.ComponentType<any>>(component: T): T {
  const dsn = sentryDsn();
  if (!dsn) return component;
  return Sentry.wrap(component) as T;
}
