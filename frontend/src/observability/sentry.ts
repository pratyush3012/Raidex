import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

// Read as static `process.env.EXPO_PUBLIC_X` accesses (not computed/concatenated) -
// Expo/Metro statically inlines EXPO_PUBLIC_* vars at build time by pattern-matching
// this exact form; a computed key defeats that inlining and silently resolves to
// undefined in real builds. Exported as a plain mutable object (rather than each
// function reading process.env internally) so tests can override it directly -
// babel's inlining bakes in whatever process.env held at transform time, so
// mutating process.env at test-run time has no effect on the already-inlined values.
export const sentryConfig = {
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || "",
  environment: process.env.EXPO_PUBLIC_ENV || "development",
  tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.1"),
};

export function initObservability() {
  if (!sentryConfig.dsn) return;
  Sentry.init({
    dsn: sentryConfig.dsn,
    environment: sentryConfig.environment,
    tracesSampleRate: sentryConfig.tracesSampleRate,
    release: `${Constants.expoConfig?.slug || "raidex"}@${Constants.expoConfig?.version || "0.0.0"}`,
  });
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!sentryConfig.dsn) return;
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
    }
    Sentry.captureException(error);
  });
}

export function wrapRoot<T extends React.ComponentType<any>>(component: T): T {
  if (!sentryConfig.dsn) return component;
  return Sentry.wrap(component) as T;
}
