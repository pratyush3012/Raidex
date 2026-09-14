// RAIDEX_FRONTEND_ONBOARDING
// First-open carousel shown once per device/install (see
// src/utils/onboarding.ts). Sits between the splash reveal in _layout.tsx and
// the existing auth-landing screen (index.tsx) - never shown again once the
// device flag is set, and never shown to a returning session at all (that
// gate lives in _layout.tsx, not here).
import React, { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme, tokens } from "@/src/theme";
import { RaidexButton } from "@/src/components/ui";
import { markOnboardingComplete } from "@/src/utils/onboarding";

// Copy mirrors the value props already established on the auth-landing hero
// (verified owners, transparent pricing, KYC safety, instant booking, 24/7
// support) and the vehicle types the backend actually supports (car, bike) -
// no invented features, no vehicle categories Raidex doesn't offer.
const SLIDES = [
  {
    icon: "car-sport" as const,
    headline: "Cars and bikes,\nwhenever you need them",
    copy: "A curated fleet from verified owners, ready near you in minutes.",
  },
  {
    icon: "pricetag" as const,
    headline: "Transparent pricing.\nNo surprises.",
    copy: "See your total price upfront, every time - no hidden fees at pickup.",
  },
  {
    icon: "flash" as const,
    headline: "Book in minutes.\nRide in minutes.",
    copy: "Instant booking with verified KYC and 24/7 support along the way.",
  },
];

export default function Onboarding() {
  const c = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<Animated.ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finish = useCallback(async () => {
    await markOnboardingComplete();
    router.replace("/");
  }, [router]);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, next)));
  }, [width]);

  const goNext = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    const next = index + 1;
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  }, [index, isLast, width, finish]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.surface }]} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={[styles.brandBadge, { backgroundColor: c.inverse }]}>
            <Text style={[styles.brandBadgeText, { color: c.onInverse }]}>R</Text>
          </View>
          <Text style={[styles.brandText, { color: c.onSurface }]}>RAIDEX</Text>
        </View>
        {!isLast && (
          <Pressable testID="onboarding-skip-btn" onPress={finish} hitSlop={10} style={styles.skipBtn}>
            <Text style={[styles.skipText, { color: c.onSurface2 }]}>Skip</Text>
          </Pressable>
        )}
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <Animated.View entering={FadeIn.duration(tokens.motion.slow)} style={styles.artworkWrap}>
              <LinearGradient
                colors={[c.accentBg, c.surface2]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={[styles.artwork, { borderColor: c.border }]}
              >
                <View style={[styles.artworkIconRing, { borderColor: c.border, backgroundColor: c.surface }]}>
                  <Ionicons name={slide.icon} size={44} color={c.accent} />
                </View>
              </LinearGradient>
            </Animated.View>

            <Text style={[styles.headline, { color: c.onSurface }]}>{slide.headline}</Text>
            <Text style={[styles.copy, { color: c.onSurface2 }]}>{slide.copy}</Text>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  width: i === index ? 22 : 8,
                  backgroundColor: i === index ? c.accent : c.surface3,
                },
              ]}
            />
          ))}
        </View>
        <RaidexButton
          testID={isLast ? "onboarding-get-started-btn" : "onboarding-continue-btn"}
          label={isLast ? "Get started" : "Continue"}
          icon="arrow-forward"
          onPress={goNext}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.sm, height: 52,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandBadge: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  brandBadgeText: { fontWeight: "900", fontSize: 14 },
  brandText: { fontSize: 14, fontWeight: "900", letterSpacing: 3 },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  skipText: { fontWeight: "800", fontSize: 14 },
  slide: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: tokens.spacing.xxl },
  artworkWrap: { marginBottom: tokens.spacing.xxl },
  artwork: {
    width: 220, height: 220, borderRadius: tokens.radius.xl, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  artworkIconRing: {
    width: 96, height: 96, borderRadius: 999, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  headline: {
    fontSize: tokens.type.xxxl, lineHeight: 36, fontWeight: "900", textAlign: "center",
  },
  copy: {
    fontSize: tokens.type.lg, lineHeight: 22, textAlign: "center", marginTop: tokens.spacing.md, maxWidth: 320,
  },
  bottom: { paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.lg, gap: tokens.spacing.xl },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { height: 8, borderRadius: 999 },
});
