import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { RaidexSkeleton } from "@/src/components/ui";

type WalletLedgerEntry = {
  ledger_id: string;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
};

export default function ProfileScreen() {
  const c = useTheme();
  const router = useRouter();
  const { user, logout, refresh } = useAuth();
  const [walletHistory, setWalletHistory] = useState<WalletLedgerEntry[] | null>(null);

  useEffect(() => {
    api<WalletLedgerEntry[]>("/wallet/ledger").then((data) => setWalletHistory(data.slice(0, 5))).catch(() => setWalletHistory([]));
  }, []);

  const doKyc = () => {
    router.push("/kyc" as any);
  };

  const topUpWallet = async () => {
    try {
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: { amount: 1000, purpose: "wallet_topup", idempotency_key: `wallet_topup_${Date.now()}` },
      });
      router.push(`/pay/${payment.payment_id}` as any);
    } catch (e: any) {
      Alert.alert("Top up failed", e.message || "Please try again.");
    }
  };

  const showComingSoon = (title: string, message: string) => {
    Alert.alert(title, message);
  };

  const callEmergency = () => {
    Alert.alert(
      "Emergency SOS",
      "Raidex support has been alerted in this demo build. In a real emergency, call local emergency services immediately."
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: "800" }}>Profile</Text>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: tokens.spacing.sm, paddingBottom: 100 }}>
        <View style={[styles.header, { backgroundColor: c.surface2, borderColor: c.border }]}>
          {user?.avatar ? (
            <Image source={user.avatar} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: c.inverse, alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: c.onInverse, fontSize: 26, fontWeight: "800" }}>{user?.name?.[0]?.toUpperCase() || "R"}</Text>
            </View>
          )}
          <Text testID="profile-name" style={{ color: c.onSurface, fontSize: 20, fontWeight: "800", marginTop: 12 }}>{user?.name}</Text>
          <Text style={{ color: c.onSurface3, marginTop: 2 }}>{user?.email}</Text>
          <View style={[styles.kycBadge, { backgroundColor: user?.kyc_status === "verified" ? c.accentBg : c.surface3 }]}>
            <Ionicons name={user?.kyc_status === "verified" ? "checkmark-circle" : "time"} size={14} color={user?.kyc_status === "verified" ? c.onAccentBg : c.onSurface2} />
            <Text style={{ color: user?.kyc_status === "verified" ? c.onAccentBg : c.onSurface2, fontWeight: "700", fontSize: 12 }}>
              KYC {user?.kyc_status === "verified" ? "Verified" : "Pending"}
            </Text>
          </View>
        </View>

        <LinearGradient colors={["#05C46B", "#03A85A"]} style={styles.walletCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", letterSpacing: 2 }}>WALLET</Text>
              <Text testID="wallet-balance" style={{ color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 6 }}>₹{user?.wallet_balance?.toLocaleString() ?? 0}</Text>
            </View>
            <Pressable testID="topup-btn" onPress={topUpWallet} style={styles.topupBtn}>
              <Ionicons name="add" size={18} color="#05C46B" />
              <Text style={{ color: "#05C46B", fontWeight: "800" }}>Top up</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {walletHistory === null ? (
          <View style={{ gap: 8, marginTop: 12 }}>
            <RaidexSkeleton height={44} radius={12} />
            <RaidexSkeleton height={44} radius={12} />
          </View>
        ) : walletHistory.length > 0 ? (
          <View style={[styles.menu, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 12 }]} testID="wallet-history">
            {walletHistory.map((entry, i) => (
              <React.Fragment key={entry.ledger_id}>
                {i > 0 && <Divider c={c} />}
                <View style={styles.walletRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "600", fontSize: 13 }}>{entry.reason.replace(/_/g, " ")}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>{new Date(entry.created_at).toLocaleString()}</Text>
                  </View>
                  <Text style={{ color: entry.delta >= 0 ? c.accent : c.error, fontWeight: "800", fontSize: 14 }}>
                    {entry.delta >= 0 ? "+" : ""}₹{entry.delta.toLocaleString()}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        ) : null}

        <View style={[styles.menu, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <MenuRow c={c} icon="shield-checkmark" label={user?.kyc_status === "verified" ? "KYC Verified" : "Complete KYC"} onPress={doKyc} testID="kyc-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="heart" label="Favorites" onPress={() => router.push("/favorites" as any)} testID="favorites-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="wallet" label="Wallet" onPress={() => router.push("/wallet" as any)} testID="wallet-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="card" label="Payment methods" onPress={() => showComingSoon("Payment methods", "Cards, UPI, wallet, and net banking are available during checkout.")} testID="payment-methods-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="receipt" label="Coupons" onPress={() => showComingSoon("Coupons", "No active coupons right now. RideMiles rewards are applied automatically after eligible trips.")} testID="coupons-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="warning" label="Emergency SOS" onPress={callEmergency} testID="sos-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="help-circle" label="Support" onPress={() => router.push("/support" as any)} testID="help-row" />
        </View>

        <View style={[styles.menu, { backgroundColor: c.surface2, borderColor: c.border, marginTop: tokens.spacing.lg }]}>
          <MenuRow c={c} icon="document-text" label="Terms of Service" onPress={() => router.push("/legal/terms" as any)} testID="terms-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="lock-closed" label="Privacy Policy" onPress={() => router.push("/legal/privacy" as any)} testID="privacy-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="cash" label="Refund Policy" onPress={() => router.push("/legal/refund-policy" as any)} testID="refund-policy-row" />
        </View>

        <View style={[styles.menu, { backgroundColor: c.surface2, borderColor: c.border, marginTop: tokens.spacing.lg }]}>
          <MenuRow c={c} icon="calendar" label="My Subscriptions" onPress={() => router.push("/subscriptions" as any)} testID="subscriptions-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="business" label="Host Dashboard" onPress={() => router.push("/owner" as any)} testID="owner-row" />
          <Divider c={c} />
          <MenuRow c={c} icon="sparkles" label="Raidex Support (AI)" onPress={() => router.push("/support" as any)} testID="support-row" />
          {((user as any)?.roles?.includes("admin") || (user as any)?.role === "admin") && (
            <>
              <Divider c={c} />
              <MenuRow c={c} icon="shield-checkmark" label="Admin Console" onPress={() => router.push("/admin" as any)} testID="admin-row" />
            </>
          )}
          <Divider c={c} />
          <MenuRow c={c} icon="log-out" label="Sign out" danger onPress={logout} testID="logout-row" />
        </View>
        <Text style={{ color: c.onSurface3, textAlign: "center", fontSize: 11, marginTop: 24 }}>Raidex v1.0 · Drive More. Own Less.</Text>
      </ScrollView>
    </View>
  );
}

function MenuRow({ c, icon, label, onPress, danger, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Ionicons name={icon} size={20} color={danger ? c.error : c.onSurface} />
        <Text style={{ color: danger ? c.error : c.onSurface, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
    </Pressable>
  );
}
function Divider({ c }: any) { return <View style={{ height: 1, backgroundColor: c.border, marginLeft: 48 }} />; }

const styles = StyleSheet.create({
  header: { alignItems: "center", padding: 24, borderRadius: 20, borderWidth: 1 },
  avatar: { width: 72, height: 72, borderRadius: 999 },
  kycBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 12 },
  walletCard: { padding: 20, borderRadius: 20, marginTop: 16 },
  topupBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  menu: { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginTop: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  walletRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
});
