import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

const TIERS = [
  { name: "Silver", min: 0, perks: ["1x Miles on rentals", "Basic support"] },
  { name: "Gold", min: 1000, perks: ["1.5x Miles", "Priority support", "Free upgrade once"] },
  { name: "Platinum", min: 5000, perks: ["2x Miles", "VIP support", "Free delivery", "Exclusive vehicles"] },
];

const REWARDS = [
  { id: "r1", title: "Free 2-hour drive", cost: 500, icon: "car" as const },
  { id: "r2", title: "₹200 wallet credit", cost: 800, icon: "wallet" as const },
  { id: "r3", title: "Premium upgrade", cost: 1500, icon: "star" as const },
  { id: "r4", title: "Subscription discount", cost: 2000, icon: "calendar" as const },
];

export default function RewardsScreen() {
  const c = useTheme();
  const { user } = useAuth();
  const miles = user?.ride_miles ?? 0;
  const currentTier = TIERS.slice().reverse().find((t) => miles >= t.min) || TIERS[0];
  const nextTier = TIERS.find((t) => t.min > miles);
  const progress = nextTier ? ((miles - currentTier.min) / (nextTier.min - currentTier.min)) * 100 : 100;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: "800" }}>RideMiles</Text>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: tokens.spacing.sm, paddingBottom: 100 }}>
        <LinearGradient colors={["#000", "#1a1a1a", "#000"]} style={styles.heroCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: "#05C46B", fontSize: 11, fontWeight: "800", letterSpacing: 3 }}>YOUR TIER</Text>
            <Ionicons name="trophy" size={20} color="#05C46B" />
          </View>
          <Text testID="rewards-tier-name" style={{ color: "#fff", fontSize: 36, fontWeight: "800", marginTop: 8 }}>{currentTier.name}</Text>
          <Text testID="rewards-miles" style={{ color: "rgba(255,255,255,0.8)", fontSize: 16, marginTop: 4 }}>{miles.toLocaleString()} miles</Text>
          {nextTier && (
            <>
              <View style={{ height: 8, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, marginTop: 20, overflow: "hidden" }}>
                <View style={{ width: `${Math.max(4, progress)}%`, height: "100%", backgroundColor: "#05C46B" }} />
              </View>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 8 }}>
                {(nextTier.min - miles).toLocaleString()} miles to <Text style={{ color: "#fff", fontWeight: "700" }}>{nextTier.name}</Text>
              </Text>
            </>
          )}
        </LinearGradient>

        <Text style={[styles.section, { color: c.onSurface }]}>Your perks</Text>
        <View style={[styles.perksCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
          {currentTier.perks.map((p, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 999, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark" size={16} color={c.onAccentBg} />
              </View>
              <Text style={{ color: c.onSurface, fontSize: 14, fontWeight: "500", flex: 1 }}>{p}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.section, { color: c.onSurface }]}>Redeem rewards</Text>
        {REWARDS.map((r) => {
          const canRedeem = miles >= r.cost;
          return (
            <View key={r.id} style={[styles.rewardRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={r.icon} size={22} color={c.onSurface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 14 }}>{r.title}</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{r.cost.toLocaleString()} miles</Text>
              </View>
              <Pressable
                testID={`redeem-${r.id}`}
                disabled={!canRedeem}
                style={[styles.redeemBtn, { backgroundColor: canRedeem ? c.inverse : c.surface3, opacity: canRedeem ? 1 : 0.6 }]}
              >
                <Text style={{ color: canRedeem ? c.onInverse : c.onSurface3, fontWeight: "700", fontSize: 12 }}>{canRedeem ? "Redeem" : "Locked"}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: { padding: 24, borderRadius: 24 },
  section: { fontSize: 18, fontWeight: "800", marginTop: 28, marginBottom: 12 },
  perksCard: { borderRadius: 18, borderWidth: 1, padding: 14 },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 10 },
  redeemBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
});
