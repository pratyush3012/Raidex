import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";

import { AppErrorBoundary } from "@/src/components/AppErrorBoundary";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { RealtimeBridge } from "@/src/components/RealtimeBridge";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { initObservability, wrapRoot } from "@/src/observability/sentry";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";

SplashScreen.preventAutoHideAsync();
initObservability();

const PROTECTED_SEGMENTS = new Set([
  "(tabs)", "vehicle", "booking", "trip", "kyc",
  "checkout", "pay", "inspection", "owner", "admin", "support", "notifications",
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

  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
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
