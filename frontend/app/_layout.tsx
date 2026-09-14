// RAIDEX_FRONTEND_ROOT_LAYOUT
// Search tags: app startup, navigation guard, protected routes, auth redirect,
// Sentry init, offline banner, realtime bridge, splash screen.
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, runOnJS,
} from "react-native-reanimated";

import { AppErrorBoundary } from "@/src/components/AppErrorBoundary";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { RealtimeBridge } from "@/src/components/RealtimeBridge";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { initObservability, wrapRoot } from "@/src/observability/sentry";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { hasCompletedOnboarding } from "@/src/utils/onboarding";
import { tokens } from "@/src/theme";

SplashScreen.preventAutoHideAsync();
initObservability();

const PROTECTED_SEGMENTS = new Set([
  "(tabs)", "vehicle", "booking", "trip", "kyc",
  "checkout", "pay", "inspection", "owner", "admin", "support", "notifications", "review",
  "subscriptions", "favorites", "wallet", "location", "coupons",
  // "legal" (Terms/Privacy/Refund) is intentionally listed here even though
  // it is ALSO reachable while signed out (see `inPublic` below): this set is
  // really "segments a signed-in user may be on without being bounced to
  // (tabs)", not "auth-required segments" - a segment can be both public and
  // in this set. Without it, a signed-in user tapping Terms/Privacy/Refund
  // from Profile would be redirected straight back to (tabs).
  "legal",
]);

function AuthGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  // Device/install-level flag (never cleared by logout - onboarding is about
  // the app, not the account). null while the async read is in flight, so the
  // redirect effect below can wait for it instead of flashing the wrong
  // screen. See src/utils/onboarding.ts.
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasCompletedOnboarding().then((seen) => { if (!cancelled) setOnboardingSeen(seen); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading || onboardingSeen === null) return;
    const seg0 = segments[0] as string | undefined;
    // "legal" (Terms/Privacy/Refund) is public on purpose: these are the kind
    // of documents a signed-out visitor should be able to open from the
    // sign-up screen's "By continuing you agree to..." line, not just from
    // inside a signed-in Profile screen.
    const inPublic = seg0 === undefined || seg0 === "index" || seg0 === "onboarding" || seg0 === "legal";
    // First-time, logged-out device: send to onboarding ahead of anything
    // else, regardless of which public segment was requested. A returning
    // session (user truthy) skips this entirely, per spec - onboarding never
    // interrupts an already-authenticated app open.
    if (!user && !onboardingSeen && seg0 !== "onboarding") {
      router.replace("/onboarding");
      return;
    }
    if (!user && !inPublic) {
      router.replace("/");
      return;
    }
    if (user && !PROTECTED_SEGMENTS.has(seg0 ?? "")) {
      router.replace("/(tabs)");
    }
  }, [user, loading, onboardingSeen, segments, router]);

  if (loading || onboardingSeen === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0A0A0E" }}>
        <ActivityIndicator size="large" color="#22D98B" />
      </View>
    );
  }

  return (
    <AppLaunchReveal>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
    </AppLaunchReveal>
  );
}

// Closes the "abrupt cut" gap between SplashScreen.hideAsync() and the first
// real screen: a brief animated brand mark (scale + fade in, small hold, fade
// out) crossfades into the real app underneath it. Respects the OS
// reduce-motion setting (skips straight to fully visible, no logo beat).
function AppLaunchReveal({ children }: { children: React.ReactNode }) {
  const appOpacity = useSharedValue(0);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.82);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [showLogo, setShowLogo] = useState(true);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (!cancelled) setReduceMotion(enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      appOpacity.value = 1;
      setShowLogo(false);
      return;
    }
    const LOGO_IN = 320;
    const LOGO_HOLD = 420;
    const LOGO_OUT = 260;
    logoOpacity.value = withTiming(1, { duration: LOGO_IN, easing: Easing.out(Easing.cubic) });
    logoScale.value = withTiming(1, { duration: LOGO_IN, easing: Easing.out(Easing.back(1.4)) });
    logoOpacity.value = withDelay(LOGO_IN + LOGO_HOLD, withTiming(0, { duration: LOGO_OUT }, (finished) => {
      if (finished) runOnJS(setShowLogo)(false);
    }));
    appOpacity.value = withDelay(LOGO_IN + LOGO_HOLD - 80, withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) }));
  }, [appOpacity, logoOpacity, logoScale, reduceMotion]);

  const appStyle = useAnimatedStyle(() => ({ opacity: appOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[{ flex: 1 }, appStyle]}>{children}</Animated.View>
      {showLogo && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#0A0A0E" },
            logoStyle,
          ]}
        >
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: "#F5F5F7", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#0A0A0E", fontWeight: "900", fontSize: 28 }}>R</Text>
          </View>
          <Text style={{ color: "#F5F5F7", fontWeight: "900", fontSize: 18, letterSpacing: 4, marginTop: 14 }}>RAIDEX</Text>
          {/* Established tagline, reused verbatim from the auth-landing hero
              (app/index.tsx) rather than inventing new brand copy. */}
          <Text style={{ color: "rgba(245,245,247,0.68)", fontWeight: "700", fontSize: 13, letterSpacing: 1, marginTop: 8 }}>
            Move smarter. Book faster.
          </Text>
        </Animated.View>
      )}
    </View>
  );
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
            <StatusBar style="light" />
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
