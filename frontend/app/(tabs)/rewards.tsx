import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { tokens, useTheme } from "@/src/theme";
import { RaidexEmptyState, RaidexErrorState, RaidexMetricCard, RaidexSkeleton } from "@/src/components/ui";

type RideMilesLedgerEntry = {
  ledger_id: string;
  user_id: string;
  delta: number;
  reason: string;
  ref_type?: string | null;
  ref_id?: string | null;
  balance_after: number;
  created_at: string;
};

// Real reason strings the backend actually writes to ride_miles_ledger
// (see backend/server.py's _append_miles_ledger call sites) - "booking" on
// trip completion and "distance" for km traveled. Anything else falls back
// to a titleized version of the raw reason rather than inventing a category.
const REASON_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  booking: { label: "Rental booking completed", icon: "car-sport" },
  distance: { label: "Distance traveled", icon: "speedometer-outline" },
};

const EARN_WAYS: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }[] = [
  { icon: "car-sport", title: "Complete a rental", subtitle: "RideMiles are credited when a booking finishes." },
  { icon: "speedometer-outline", title: "Rack up kilometers", subtitle: "Every trip's distance adds to your balance." },
];

// Same round-number step the home-screen progress bar targeted (1000), but
// generalized to the *next* multiple instead of a single hardcoded ceiling -
// otherwise the bar pins at 100% forever once a rider crosses 1000. This is
// a display convention (a checkpoint), not a promised reward tier - there is
// no redemption endpoint in the backend, so this screen never offers one.
const MILESTONE_STEP = 1000;

function reasonMeta(reason: string) {
  return (
    REASON_LABELS[reason] ?? {
      label: reason.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      icon: "sparkles" as const,
    }
  );
}

export default function RewardsScreen() {
  const c = useTheme();
  const { user } = useAuth();
  const [ledger, setLedger] = useState<RideMilesLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api<RideMilesLedgerEntry[]>("/ride-miles/ledger");
      setLedger(data);
    } catch (e: any) {
      setError(e.message || "Could not load your RideMiles history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const balance = user?.ride_miles ?? 0;
  const nextMilestone = useMemo(() => (Math.floor(balance / MILESTONE_STEP) + 1) * MILESTONE_STEP, [balance]);
  const prevMilestone = nextMilestone - MILESTONE_STEP;
  const progressPct = useMemo(
    () => Math.min(100, Math.max(0, ((balance - prevMilestone) / MILESTONE_STEP) * 100)),
    [balance, prevMilestone]
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: tokens.weight.bold }}>RideMiles</Text>
        </View>
      </SafeAreaView>

      <FlatList
        data={loading ? [] : ledger}
        keyExtractor={(it) => it.ledger_id}
        contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        ItemSeparatorComponent={() => <View style={{ height: tokens.spacing.sm }} />}
        ListHeaderComponent={
          <View style={{ gap: tokens.spacing.lg, marginBottom: tokens.spacing.lg }}>
            <LinearGradient colors={["#000", "#1a1a1a"]} style={styles.heroCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="trophy" size={16} color="#05C46B" />
                <Text style={styles.heroEyebrow}>{(user?.tier ?? "Silver").toUpperCase()} TIER</Text>
              </View>
              <Text style={styles.heroCaption}>Your RideMiles reward balance, earned from rentals and trips.</Text>
            </LinearGradient>

            <View style={{ flexDirection: "row", gap: tokens.spacing.md }}>
              <RaidexMetricCard
                testID="rewards-balance-metric"
                label="RideMiles balance"
                value={balance.toLocaleString()}
                numeric={balance}
                icon="sparkles"
              />
              <RaidexMetricCard
                testID="rewards-next-milestone-metric"
                label="Next milestone"
                value={nextMilestone.toLocaleString()}
                icon="flag-outline"
              />
            </View>

            <View style={[styles.progressCard, { backgroundColor: c.surface2, borderColor: c.border }]} testID="rewards-progress-card">
              <MilestoneProgressBar pct={progressPct} c={c} />
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: tokens.spacing.sm, fontWeight: tokens.weight.medium }}>
                {balance.toLocaleString()} of {nextMilestone.toLocaleString()} RideMiles toward your next milestone
              </Text>
            </View>

            <View style={[styles.earnCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.base, marginBottom: tokens.spacing.sm }}>
                How you earn RideMiles
              </Text>
              {EARN_WAYS.map((w) => (
                <View key={w.title} style={styles.earnRow}>
                  <View style={[styles.earnIcon, { backgroundColor: c.accentBg }]}>
                    <Ionicons name={w.icon} size={16} color={c.onAccentBg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 13 }}>{w.title}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 1 }}>{w.subtitle}</Text>
                  </View>
                </View>
              ))}
            </View>

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>Activity</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: tokens.spacing.sm }} testID="rewards-loading-skeleton">
              <RaidexSkeleton height={64} radius={tokens.radius.lg} />
              <RaidexSkeleton height={64} radius={tokens.radius.lg} />
              <RaidexSkeleton height={64} radius={tokens.radius.lg} />
            </View>
          ) : error ? (
            <RaidexErrorState message={error} onRetry={load} testID="rewards-error-state" />
          ) : (
            <RaidexEmptyState
              icon="sparkles-outline"
              title="No RideMiles activity yet"
              subtitle="Complete a rental to start earning RideMiles."
              testID="rewards-empty-state"
            />
          )
        }
        renderItem={({ item }) => {
          const meta = reasonMeta(item.reason);
          const positive = item.delta >= 0;
          return (
            <View testID={`rewards-ledger-row-${item.ledger_id}`} style={[styles.ledgerRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={[styles.ledgerIcon, { backgroundColor: c.surface3 }]}>
                <Ionicons name={meta.icon} size={16} color={c.onSurface2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 13 }}>{meta.label}</Text>
                <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: positive ? c.accent : c.error, fontWeight: tokens.weight.bold, fontSize: 14 }}>
                  {positive ? "+" : ""}
                  {item.delta.toLocaleString()}
                </Text>
                <Text style={{ color: c.onSurface3, fontSize: 10, marginTop: 2 }}>Balance {item.balance_after.toLocaleString()}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function MilestoneProgressBar({ pct, c }: { pct: number; c: any }) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(pct, { duration: tokens.motion.slow });
  }, [pct, width]);
  const animatedStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View style={[styles.progressTrack, { backgroundColor: c.surface3 }]} testID="rewards-progress-bar">
      <Animated.View style={[{ height: "100%", backgroundColor: c.accent, borderRadius: 999 }, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: { borderRadius: tokens.radius.xl, padding: tokens.spacing.xl, overflow: "hidden" },
  heroEyebrow: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  heroCaption: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 8, lineHeight: 18 },
  progressCard: { borderRadius: tokens.radius.lg, borderWidth: 1, padding: tokens.spacing.lg },
  progressTrack: { height: 6, borderRadius: 999, overflow: "hidden" },
  earnCard: { borderRadius: tokens.radius.lg, borderWidth: 1, padding: tokens.spacing.lg },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  earnIcon: { width: 30, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ledgerRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: tokens.radius.lg, padding: tokens.spacing.md },
  ledgerIcon: { width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
