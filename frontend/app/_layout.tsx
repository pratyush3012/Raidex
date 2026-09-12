// RAIDEX_FRONTEND_ROOT_LAYOUT
// Search tags: app startup, navigation guard, protected routes, auth redirect,
// Sentry init, offline banner, realtime bridge, splash screen.
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";

import { AppErrorBoundary } from "@/src/components/AppErrorBoundary";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { RealtimeBridge } from "@/src/components/RealtimeBridge";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { initObservability, wrapRoot } from "@/src/observability/sentry";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { tokens } from "@/src/theme";

SplashScreen.preventAutoHideAsync();
initObservability();

const PROTECTED_SEGMENTS = new Set([
  "(tabs)", "vehicle", "booking", "trip", "kyc",
  "checkout", "pay", "inspection", "owner", "admin", "support", "notifications", "review",
  "subscriptions",
]);

function AuthGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const seg0 = segments[0] as string | undefined;
    const inPublic = seg0 === undefined || seg0 === "index";
    if (!user && !inPublic) {
      router.replace("/");
      return;
    }
    if (user && !PROTECTED_SEGMENTS.has(seg0 ?? "")) {
      router.replace("/(tabs)");
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
        <ActivityIndicator size="large" color="#05C46B" />
      </View>
    );
  }

  return (
    <AppLaunchReveal>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
    </AppLaunchReveal>
  );
}

// A single, brief crossfade from the native splash/loading state into the
// real app - closes the "abrupt cut" gap between SplashScreen.hideAsync()
// and the first real screen appearing. Respects the OS reduce-motion
// setting (skips straight to fully visible rather than animating).
function AppLaunchReveal({ children }: { children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (!cancelled) setReduceMotion(enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    opacity.value = reduceMotion ? 1 : withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[{ flex: 1 }, animatedStyle]}>{children}</Animated.View>;
}

function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppErrorBoundary>
          <AuthProvider>
            <StatusBar style="auto" />
            <OfflineBanner />
            <RealtimeBridge />
            <AuthGate />
          </AuthProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);
