import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

type Tab = "kpis" | "vehicles" | "users" | "payments" | "geofence" | "nexus";

export default function AdminConsole() {
  const c = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = (user as any)?.roles?.includes("admin") || (user as any)?.role === "admin";
  const [tab, setTab] = useState<Tab>("kpis");
  const [kpis, setKpis] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [geo, setGeo] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "kpis") setKpis(await api<any>("/admin/kpis"));
      if (t === "vehicles") setVehicles(await api<any[]>("/admin/vehicles?verification_status=pending"));
      if (t === "users") setUsers(await api<any[]>("/admin/users"));
      if (t === "payments") setPayments(await api<any[]>("/admin/payments"));
      if (t === "geofence") setGeo(await api<any[]>("/admin/geofence-events"));
    } catch (e: any) { Alert.alert("Error", e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isAdmin) loadTab(tab); }, [isAdmin, tab, loadTab]);

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: c.surface }}>
        <Ionicons name="lock-closed" size={48} color={c.onSurface3} />
        <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "800", marginTop: 16 }}>Admin access required</Text>
        <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>Sign in with the admin account to view this console.</Text>
        <Pressable onPress={() => router.replace("/(tabs)" as any)} style={[styles.cta, { backgroundColor: c.inverse, marginTop: 24 }]}>
          <Text style={{ color: c.onInverse, fontWeight: "700" }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const tabs: { k: Tab; label: string; ic: any }[] = [
    { k: "kpis", label: "Overview", ic: "stats-chart" },
    { k: "vehicles", label: "Approvals", ic: "checkmark-done" },
    { k: "users", label: "Users", ic: "people" },
    { k: "payments", label: "Payments", ic: "card" },
    { k: "geofence", label: "Geofence", ic: "shield" },
    { k: "nexus", label: "AI Nexus", ic: "sparkles" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ padding: 20, flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <View style={{ marginLeft: 8 }}>
            <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: "800", letterSpacing: 2 }}>RAIDEX</Text>
            <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: "800" }}>Admin Console</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }} style={{ height: 56 }}>
          {tabs.map((t) => (
            <Pressable key={t.k} testID={`admin-tab-${t.k}`} onPress={() => setTab(t.k)} style={[styles.chip, { backgroundColor: tab === t.k ? c.inverse : c.surface2, borderColor: tab === t.k ? c.inverse : c.border }]}>
              <Ionicons name={t.ic} size={13} color={tab === t.k ? c.onInverse : c.onSurface} />
              <Text style={{ color: tab === t.k ? c.onInverse : c.onSurface, fontWeight: "700", fontSize: 13 }}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {loading && <ActivityIndicator color={c.accent} style={{ marginVertical: 20 }} />}

        {tab === "kpis" && kpis && (
          <View>
            <LinearGradient colors={["#000", "#1a1a1a"]} style={{ padding: 24, borderRadius: 24 }}>
              <Text style={{ color: "#05C46B", fontSize: 11, fontWeight: "800", letterSpacing: 3 }}>GROSS REVENUE</Text>
              <Text testID="kpi-revenue" style={{ color: "#fff", fontSize: 36, fontWeight: "800", marginTop: 6 }}>₹{kpis.revenue.toLocaleString()}</Text>
              <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 4 }}>Commission ₹{kpis.commission.toLocaleString()} (15%)</Text>
            </LinearGradient>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
              {[
                { l: "Users", v: kpis.users, ic: "people" },
                { l: "Vehicles", v: kpis.vehicles, ic: "car-sport" },
                { l: "Active trips", v: kpis.active_trips, ic: "navigate" },
                { l: "Bookings", v: kpis.bookings, ic: "calendar" },
                { l: "Pending vehicles", v: kpis.pending_verifications, ic: "hourglass" },
                { l: "Geofence alerts", v: kpis.open_geo_events, ic: "warning" },
              ].map((k) => (
                <View key={k.l} style={{ width: "48%", padding: 14, borderRadius: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
                  <Ionicons name={k.ic as any} size={18} color={c.onSurface3} />
                  <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 4 }}>{k.l.toUpperCase()}</Text>
                  <Text style={{ color: c.onSurface, fontSize: 26, fontWeight: "800", marginTop: 2 }}>{k.v}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {tab === "vehicles" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 12 }}>Pending approvals ({vehicles.length})</Text>
            {vehicles.length === 0 ? <EmptyState c={c} icon="checkmark-circle-outline" text="No vehicles awaiting review" /> :
              vehicles.map((v) => (
                <View key={v.vehicle_id} style={[styles.vRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Image source={v.hero_image || v.image} style={{ width: 70, height: 70, borderRadius: 10 }} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "800" }}>{v.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.brand} {v.model} · ₹{v.price_per_day}/day</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable
                        testID={`approve-${v.vehicle_id}`}
                        onPress={async () => { await api(`/admin/vehicles/${v.vehicle_id}/approve`, { method: "POST" }); loadTab("vehicles"); }}
                        style={[styles.smBtn, { backgroundColor: c.accent }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>Approve</Text>
                      </Pressable>
                      <Pressable
                        testID={`reject-${v.vehicle_id}`}
                        onPress={async () => { await api(`/admin/vehicles/${v.vehicle_id}/reject`, { method: "POST", body: { reason: "Did not meet standards" } }); loadTab("vehicles"); }}
                        style={[styles.smBtn, { backgroundColor: c.error }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>Reject</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
          </View>
        )}

        {tab === "users" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 12 }}>All users ({users.length})</Text>
            {users.map((u) => (
              <View key={u.user_id} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginBottom: 8 }]}>
                <View style={[styles.avatarSm, { backgroundColor: c.inverse }]}><Text style={{ color: c.onInverse, fontWeight: "800" }}>{u.name?.[0]?.toUpperCase() ?? "?"}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "700" }}>{u.name}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 11 }}>{u.email}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: c.accent, fontSize: 10, fontWeight: "800" }}>{(u.roles || [u.role]).join(", ").toUpperCase()}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 10, marginTop: 2 }}>KYC: {u.kyc_status}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === "payments" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 12 }}>Recent payments ({payments.length})</Text>
            {payments.map((p) => (
              <View key={p.payment_id} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginBottom: 8 }]}>
                <View style={[styles.avatarSm, { backgroundColor: p.status === "succeeded" ? c.accent : p.status === "failed" ? c.error : c.surface3 }]}>
                  <Ionicons name={p.status === "succeeded" ? "checkmark" : p.status === "failed" ? "close" : "time"} size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "700" }}>₹{p.amount.toLocaleString()}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 11 }}>{p.purpose} · {p.provider}</Text>
                </View>
                <Text style={{ color: c.onSurface, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>{p.status}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "geofence" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 12 }}>Geofence & speed events ({geo.length})</Text>
            {geo.length === 0 ? <EmptyState c={c} icon="shield-checkmark-outline" text="No alerts" /> :
              geo.map((e) => (
                <View key={e.event_id} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginBottom: 8 }]}>
                  <Ionicons name="warning" size={22} color={c.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "700", textTransform: "capitalize" }}>{e.kind.replace("_", " ")}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>Vehicle: {e.vehicle_id} · {JSON.stringify(e.meta)}</Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: e.acknowledged ? c.surface3 : c.warning }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{e.acknowledged ? "ACK" : "OPEN"}</Text>
                  </View>
                </View>
              ))}
          </View>
        )}

        {tab === "nexus" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 12 }}>AI Nexus — Ask Operations or Finance</Text>
            <Pressable testID="open-ops" onPress={() => router.push("/support?agent=operations" as any)} style={[styles.nexCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name="analytics" size={22} color={c.onAccentBg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800" }}>Operations Agent</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Ask about active trips, fleet utilization, anomalies.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
            </Pressable>
            <Pressable testID="open-fin" onPress={() => router.push("/support?agent=finance" as any)} style={[styles.nexCard, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 10 }]}>
              <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name="cash" size={22} color={c.onAccentBg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: "800" }}>Finance Agent</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Ask about revenue, commissions, refunds, payouts.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function EmptyState({ c, icon, text }: any) {
  return <View style={{ alignItems: "center", padding: 40 }}><Ionicons name={icon} size={48} color={c.onSurface3} /><Text style={{ color: c.onSurface2, marginTop: 12 }}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  iconRound: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  avatarSm: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 36, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  vRow: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  smBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  nexCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
});
