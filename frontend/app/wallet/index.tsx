import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { tokens, useTheme } from "@/src/theme";
import { RaidexEmptyState, RaidexErrorState, RaidexMetricCard, RaidexSkeleton } from "@/src/components/ui";

type WalletLedgerEntry = {
  ledger_id: string;
  user_id: string;
  delta: number;
  reason: string;
  payment_id?: string | null;
  ref_id?: string | null;
  actor_id?: string | null;
  balance_after: number;
  created_at: string;
};

// Real reason strings the backend actually writes to wallet_ledger (see
// backend/server.py's _append_wallet_ledger call sites): "topup" for a
// rider's own self-serve top-up, "refund" for a booking refund credited to
// the wallet, "admin_credit" for a support-issued goodwill credit. Anything
// else falls back to a titleized version of the raw reason rather than
// inventing a category.
const REASON_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  topup: { label: "Wallet top-up", icon: "add-circle-outline" },
  refund: { label: "Booking refund", icon: "return-down-back-outline" },
  admin_credit: { label: "Support credit", icon: "shield-checkmark-outline" },
};

function reasonMeta(reason: string) {
  return (
    REASON_LABELS[reason] ?? {
      label: reason.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      icon: "swap-vertical-outline" as const,
    }
  );
}

export default function WalletScreen() {
  const c = useTheme();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [ledger, setLedger] = useState<WalletLedgerEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [data] = await Promise.all([
        api<WalletLedgerEntry[]>("/wallet/ledger"),
        refresh().catch(() => {}),
      ]);
      setLedger(data);
    } catch (e: any) {
      setError(e.message || "Could not load your wallet history.");
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  useEffect(() => { load(); }, [load]);

  // Coming back from a top-up payment (or any other screen that could have
  // moved the balance) should reflect the fresh balance without the rider
  // needing to pull-to-refresh manually.
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const topUp = async () => {
    setToppingUp(true);
    try {
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: { amount: 1000, purpose: "wallet_topup", idempotency_key: `wallet_topup_${Date.now()}` },
      });
      router.push(`/pay/${payment.payment_id}` as any);
    } catch (e: any) {
      Alert.alert("Top up failed", e.message || "Please try again.");
    } finally {
      setToppingUp(false);
    }
  };

  const balance = user?.wallet_balance ?? 0;
  const loading = ledger === null;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: tokens.weight.bold }}>Wallet</Text>
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
            <LinearGradient colors={["#05C46B", "#03A85A"]} style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>RAIDEX WALLET</Text>
              <Text style={styles.heroCaption}>Your available balance for bookings, deposits, and fees.</Text>
              <Pressable
                testID="wallet-topup-btn"
                onPress={topUp}
                disabled={toppingUp}
                style={({ pressed }) => [styles.topupBtn, { opacity: toppingUp ? 0.7 : pressed ? 0.88 : 1 }]}
              >
                <Ionicons name="add" size={16} color="#05C46B" />
                <Text style={styles.topupBtnText}>{toppingUp ? "Opening..." : "Top up"}</Text>
              </Pressable>
            </LinearGradient>

            <View style={{ flexDirection: "row", gap: tokens.spacing.md }}>
              <RaidexMetricCard
                testID="wallet-balance-metric"
                label="Balance"
                value={balance.toLocaleString()}
                numeric={balance}
                prefix="₹"
                icon="wallet"
              />
              <RaidexMetricCard
                testID="wallet-transactions-metric"
                label="Transactions"
                value={(ledger?.length ?? 0).toLocaleString()}
                numeric={ledger?.length ?? 0}
                icon="receipt-outline"
              />
            </View>

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>Activity</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: tokens.spacing.sm }} testID="wallet-loading-skeleton">
              <RaidexSkeleton height={64} radius={tokens.radius.lg} />
              <RaidexSkeleton height={64} radius={tokens.radius.lg} />
              <RaidexSkeleton height={64} radius={tokens.radius.lg} />
            </View>
          ) : error ? (
            <RaidexErrorState message={error} onRetry={load} testID="wallet-error-state" />
          ) : (
            <RaidexEmptyState
              icon="wallet-outline"
              title="No wallet activity yet"
              subtitle="Top-ups, refunds, and support credits will show up here."
              testID="wallet-empty-state"
            />
          )
        }
        renderItem={({ item }) => {
          const meta = reasonMeta(item.reason);
          const positive = item.delta >= 0;
          return (
            <View testID={`wallet-ledger-row-${item.ledger_id}`} style={[styles.ledgerRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={[styles.ledgerIcon, { backgroundColor: c.surface3 }]}>
                <Ionicons name={meta.icon} size={16} color={c.onSurface2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 13 }}>{meta.label}</Text>
                <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: positive ? c.accent : c.error, fontWeight: tokens.weight.bold, fontSize: 14 }}>
                  {positive ? "+" : ""}₹{item.delta.toLocaleString()}
                </Text>
                <Text style={{ color: c.onSurface3, fontSize: 10, marginTop: 2 }}>Balance ₹{item.balance_after.toLocaleString()}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: { padding: tokens.spacing.xl, borderRadius: tokens.radius.xl },
  heroEyebrow: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  heroCaption: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 8, lineHeight: 18 },
  topupBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    backgroundColor: "#fff", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, marginTop: tokens.spacing.lg,
  },
  topupBtnText: { color: "#05C46B", fontWeight: "800", fontSize: 14 },
  ledgerRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: tokens.radius.lg, padding: tokens.spacing.md },
  ledgerIcon: { width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
