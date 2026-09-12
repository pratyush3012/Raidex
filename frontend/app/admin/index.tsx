import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import {
  RaidexButton,
  RaidexCard,
  RaidexInput,
  RaidexChip,
  RaidexStatusPill,
  RaidexSkeleton,
  RaidexEmptyState,
  RaidexModal,
  RaidexMetricCard,
} from "@/src/components/ui";

type Tab = "kpis" | "vehicles" | "kyc" | "users" | "payments" | "disputes" | "geofence" | "health" | "nexus" | "payouts" | "flags";

// Tabs whose body is a fetched list - these get row skeletons while loading
// instead of the generic top-of-scroll spinner used for the rest.
const LIST_TABS: Tab[] = ["vehicles", "kyc", "users", "payments", "disputes", "geofence", "payouts"];

// Flags this app actually checks somewhere (via GET /features/{flag} or
// FeatureFlagService) - shown even if no admin has ever saved a row for them
// yet, so a brand-new flag isn't invisible until someone flips it once.
const KNOWN_FLAGS: { flag: string; label: string; description: string }[] = [
  { flag: "subscriptions", label: "Subscriptions", description: "Customers can browse/create/manage monthly vehicle subscriptions." },
  { flag: "vehicle_swap", label: "Vehicle swap", description: "Subscribers can swap their vehicle for another." },
  { flag: "vehicle_swap_requires_approval", label: "Swap requires approval", description: "When on, a swap sits 'requested' until an admin approves it instead of completing immediately." },
];

const PAYOUT_STATUSES: { k: string; label: string }[] = [
  { k: "", label: "All" },
  { k: "pending", label: "Pending" },
  { k: "eligible", label: "Eligible" },
  { k: "processing", label: "Processing" },
  { k: "paid", label: "Paid" },
  { k: "failed", label: "Failed" },
];

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
  const [kyc, setKyc] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [geo, setGeo] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [commissionConfig, setCommissionConfig] = useState<any>(null);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState("");
  const [markPaidTarget, setMarkPaidTarget] = useState<any>(null);
  const [editingCommission, setEditingCommission] = useState(false);
  const [commissionInput, setCommissionInput] = useState("");
  const [flags, setFlags] = useState<Record<string, any>>({});
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPayouts = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : "";
      setPayouts(await api<any[]>(`/admin/payouts${qs}`));
    } catch (e: any) { Alert.alert("Error", e.message); } finally { setLoading(false); }
  }, []);

  const loadTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "kpis") setKpis(await api<any>("/admin/kpis"));
      if (t === "vehicles") setVehicles(await api<any[]>("/admin/vehicles?verification_status=pending"));
      if (t === "kyc") setKyc(await api<any[]>("/admin/kyc"));
      if (t === "users") setUsers(await api<any[]>("/admin/users"));
      if (t === "payments") setPayments(await api<any[]>("/admin/payments"));
      if (t === "disputes") setDisputes(await api<any[]>("/admin/disputes"));
      if (t === "geofence") setGeo(await api<any[]>("/admin/geofence-events"));
      if (t === "health") setHealth(await api<any>("/admin/system-health"));
      if (t === "payouts") {
        const [p, cfg] = await Promise.all([
          api<any[]>(`/admin/payouts${payoutStatusFilter ? `?status=${encodeURIComponent(payoutStatusFilter)}` : ""}`),
          api<any>("/admin/commission-config"),
        ]);
        setPayouts(p);
        setCommissionConfig(cfg);
      }
      if (t === "flags") {
        const saved = await api<any[]>("/admin/feature-flags");
        const byFlag: Record<string, any> = {};
        for (const row of saved) byFlag[row.flag] = row;
        setFlags(byFlag);
      }
    } catch (e: any) { Alert.alert("Error", e.message); } finally { setLoading(false); }
  }, [payoutStatusFilter]);

  const toggleFlag = (flag: string, currentlyEnabled: boolean) => {
    Alert.alert(
      currentlyEnabled ? `Disable "${flag}"?` : `Enable "${flag}"?`,
      currentlyEnabled
        ? "Customers will immediately lose access to this feature."
        : "This makes the feature live for real users right away.",
      [
        { text: "Cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setFlagBusy(flag);
            try {
              const updated = await api<any>(`/admin/feature-flags/${flag}`, { method: "PUT", body: { enabled: !currentlyEnabled } });
              setFlags((prev) => ({ ...prev, [flag]: updated }));
            } catch (e: any) {
              Alert.alert("Error", e.message);
            } finally {
              setFlagBusy(null);
            }
          },
        },
      ]
    );
  };

  useEffect(() => { if (isAdmin) loadTab(tab); }, [isAdmin, tab, loadTab]);

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: c.surface }}>
        <Ionicons name="lock-closed" size={48} color={c.onSurface3} />
        <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: tokens.weight.bold, marginTop: 16 }}>Admin access required</Text>
        <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>Sign in with the admin account to view this console.</Text>
        <View style={{ marginTop: 24 }}>
          <RaidexButton testID="admin-gate-back-btn" label="Back" onPress={() => router.replace("/(tabs)" as any)} fullWidth={false} />
        </View>
      </View>
    );
  }

  const tabs: { k: Tab; label: string; ic: any }[] = [
    { k: "kpis", label: "Overview", ic: "stats-chart" },
    { k: "vehicles", label: "Approvals", ic: "checkmark-done" },
    { k: "kyc", label: "KYC", ic: "id-card" },
    { k: "users", label: "Users", ic: "people" },
    { k: "payments", label: "Payments", ic: "card" },
    { k: "disputes", label: "Disputes", ic: "flag" },
    { k: "geofence", label: "Geofence", ic: "shield" },
    { k: "health", label: "Health", ic: "pulse" },
    { k: "nexus", label: "AI Nexus", ic: "sparkles" },
    { k: "payouts", label: "Payouts", ic: "cash" },
    { k: "flags", label: "Flags", ic: "flag-outline" },
  ];

  const onPickPayoutStatus = (status: string) => {
    setPayoutStatusFilter(status);
    loadPayouts(status);
  };

  const saveCommissionRate = () => {
    const pct = parseFloat(commissionInput);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      Alert.alert("Invalid rate", "Enter a percentage between 0 and 100.");
      return;
    }
    const rate = pct / 100;
    Alert.alert(
      "Update commission rate",
      `Set the platform default commission to ${pct}%? This affects all future payouts.`,
      [
        { text: "Cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              const updated = await api<any>("/admin/commission-config", { method: "PUT", body: { default_rate: rate } });
              setCommissionConfig(updated);
              setEditingCommission(false);
            } catch (e: any) { Alert.alert("Error", e.message); }
          },
        },
      ]
    );
  };

  const markPayoutPaid = (payoutId: string, reference: string) => {
    if (!reference.trim()) {
      Alert.alert("Reference required", "Enter a payment reference.");
      return;
    }
    Alert.alert(
      "Mark payout paid",
      "Confirm this payout has been paid out to the owner?",
      [
        { text: "Cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              await api(`/admin/payouts/${payoutId}/mark-paid`, { method: "POST", body: { payment_reference: reference.trim() } });
              setMarkPaidTarget(null);
              loadPayouts(payoutStatusFilter);
            } catch (e: any) { Alert.alert("Error", e.message); }
          },
        },
      ]
    );
  };

  const markPayoutFailed = (payoutId: string) => {
    Alert.alert(
      "Mark payout failed",
      "Are you sure this payout failed?",
      [
        { text: "Cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              await api(`/admin/payouts/${payoutId}/mark-failed`, { method: "POST", body: {} });
              loadPayouts(payoutStatusFilter);
            } catch (e: any) { Alert.alert("Error", e.message); }
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ padding: 20, flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <View style={{ marginLeft: 8 }}>
            <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold, letterSpacing: 2 }}>RAIDEX</Text>
            <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: tokens.weight.bold }}>Admin Console</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }} style={{ height: 56 }}>
          {tabs.map((t) => (
            <RaidexChip key={t.k} testID={`admin-tab-${t.k}`} label={t.label} icon={t.ic} active={tab === t.k} onPress={() => setTab(t.k)} />
          ))}
        </ScrollView>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {loading && !LIST_TABS.includes(tab) && <ActivityIndicator color={c.accent} style={{ marginVertical: 20 }} />}

        {tab === "kpis" && kpis && (
          <View>
            <RaidexCard variant="dark" padding={tokens.spacing.xl} style={{ borderRadius: 24 }}>
              <Text style={{ color: "#05C46B", fontSize: 11, fontWeight: tokens.weight.bold, letterSpacing: 3 }}>GROSS REVENUE</Text>
              <Text testID="kpi-revenue" style={{ color: "#fff", fontSize: 36, fontWeight: tokens.weight.bold, marginTop: 6 }}>₹{kpis.revenue.toLocaleString()}</Text>
              <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
                Commission ₹{kpis.commission.toLocaleString()}
                {kpis.revenue > 0 ? ` (${Math.round((kpis.commission / kpis.revenue) * 100)}%)` : ""}
              </Text>
            </RaidexCard>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
              {[
                { l: "Users", v: kpis.users, ic: "people" },
                { l: "Vehicles", v: kpis.vehicles, ic: "car-sport" },
                { l: "Active trips", v: kpis.active_trips, ic: "navigate" },
                { l: "Bookings", v: kpis.bookings, ic: "calendar" },
                { l: "Pending vehicles", v: kpis.pending_verifications, ic: "hourglass" },
                { l: "Geofence alerts", v: kpis.open_geo_events, ic: "warning" },
              ].map((k) => (
                <View key={k.l} style={{ width: "48%" }}>
                  <RaidexMetricCard testID={`admin-kpi-${slug(k.l)}`} label={k.l} value={k.v} numeric={k.v} icon={k.ic as any} />
                </View>
              ))}
            </View>
          </View>
        )}

        {tab === "vehicles" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>Pending approvals ({vehicles.length})</Text>
            {loading && vehicles.length === 0 ? (
              <RowSkeletons />
            ) : vehicles.length === 0 ? (
              <RaidexEmptyState icon="checkmark-circle-outline" title="No vehicles awaiting review" />
            ) : (
              vehicles.map((v) => (
                <RaidexCard key={v.vehicle_id} padding={tokens.spacing.md} style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
                  <Image source={v.hero_image || v.image} style={{ width: 64, height: 64, borderRadius: 10 }} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{v.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.brand} {v.model} · ₹{v.price_per_day}/day</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable
                        testID={`approve-${v.vehicle_id}`}
                        onPress={async () => { await api(`/admin/vehicles/${v.vehicle_id}/approve`, { method: "POST" }); loadTab("vehicles"); }}
                        style={[styles.smBtn, { backgroundColor: c.accent }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: tokens.weight.bold }}>Approve</Text>
                      </Pressable>
                      <Pressable
                        testID={`reject-${v.vehicle_id}`}
                        onPress={async () => { await api(`/admin/vehicles/${v.vehicle_id}/reject`, { method: "POST", body: { reason: "Did not meet standards" } }); loadTab("vehicles"); }}
                        style={[styles.smBtn, { backgroundColor: c.error }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: tokens.weight.bold }}>Reject</Text>
                      </Pressable>
                    </View>
                  </View>
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "users" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>All users ({users.length})</Text>
            {loading && users.length === 0 ? (
              <RowSkeletons />
            ) : (
              users.map((u) => (
                <RaidexCard key={u.user_id} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <View style={[styles.avatarSm, { backgroundColor: c.inverse }]}><Text style={{ color: c.onInverse, fontWeight: tokens.weight.bold }}>{u.name?.[0]?.toUpperCase() ?? "?"}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{u.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>{u.email}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ color: c.accent, fontSize: 10, fontWeight: tokens.weight.bold }}>{(u.roles || [u.role]).join(", ").toUpperCase()}</Text>
                    <RaidexStatusPill status={u.kyc_status} label={`KYC ${u.kyc_status}`} />
                  </View>
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "kyc" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>KYC submissions ({kyc.length})</Text>
            {loading && kyc.length === 0 ? (
              <RowSkeletons />
            ) : kyc.length === 0 ? (
              <RaidexEmptyState icon="id-card-outline" title="No KYC submissions yet" />
            ) : (
              kyc.map((item) => (
                <RaidexCard key={item.kyc_id} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Ionicons name={item.status === "verified" ? "checkmark-circle" : item.status === "rejected" ? "close-circle" : "time"} size={22} color={item.status === "verified" ? c.accent : item.status === "rejected" ? c.error : c.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{item.dl_number || item.user_id}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>Aadhaar: ****{item.aadhaar_last4} · {item.provider || "provider"}</Text>
                  </View>
                  <RaidexStatusPill status={item.status} />
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "payments" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>Recent payments ({payments.length})</Text>
            {loading && payments.length === 0 ? (
              <RowSkeletons />
            ) : (
              payments.map((p) => (
                <RaidexCard key={p.payment_id} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <View style={[styles.avatarSm, { backgroundColor: p.status === "succeeded" ? c.accent : p.status === "failed" ? c.error : c.surface3 }]}>
                    <Ionicons name={p.status === "succeeded" ? "checkmark" : p.status === "failed" ? "close" : "time"} size={14} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>₹{p.amount.toLocaleString()}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>{p.purpose} · {p.provider}</Text>
                  </View>
                  <RaidexStatusPill status={p.status} />
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "disputes" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>Disputes ({disputes.length})</Text>
            {loading && disputes.length === 0 ? (
              <RowSkeletons />
            ) : disputes.length === 0 ? (
              <RaidexEmptyState icon="flag-outline" title="No disputes" />
            ) : (
              disputes.map((d) => (
                <RaidexCard key={d.dispute_id} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Ionicons name="flag" size={20} color={d.status === "resolved" ? c.accent : c.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, textTransform: "capitalize" }}>{d.category}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }} numberOfLines={2}>{d.message}</Text>
                  </View>
                  <RaidexStatusPill status={d.status} />
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "geofence" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>Geofence & speed events ({geo.length})</Text>
            {loading && geo.length === 0 ? (
              <RowSkeletons />
            ) : geo.length === 0 ? (
              <RaidexEmptyState icon="shield-checkmark-outline" title="No alerts" />
            ) : (
              geo.map((e) => (
                <RaidexCard key={e.event_id} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Ionicons name="warning" size={22} color={c.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, textTransform: "capitalize" }}>{e.kind.replace("_", " ")}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>Vehicle: {e.vehicle_id} · {JSON.stringify(e.meta)}</Text>
                  </View>
                  <RaidexStatusPill status={e.acknowledged ? "acknowledged" : "open"} label={e.acknowledged ? "Ack" : "Open"} />
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "health" && health && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>System health</Text>
            {[
              ["Database", health.database],
              ["Payments", health.payment_provider],
              ["KYC", health.kyc_provider],
              ["Push", health.push_provider],
              ["LLM", health.llm_configured ? "configured" : "missing"],
              ["Open disputes", String(health.open_disputes)],
              ["Failed payments", String(health.failed_payments_24h)],
              ["Pending KYC", String(health.pending_kyc)],
            ].map(([label, value]) => (
              <RaidexCard key={label} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <Ionicons name={value === "connected" || value === "configured" ? "checkmark-circle" : "information-circle"} size={20} color={value === "connected" || value === "configured" ? c.accent : c.onSurface3} />
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, flex: 1 }}>{label}</Text>
                <Text style={{ color: c.onSurface2, fontWeight: tokens.weight.bold }}>{value}</Text>
              </RaidexCard>
            ))}
          </View>
        )}

        {tab === "nexus" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>AI Nexus — Ask Operations or Finance</Text>
            <Pressable testID="open-ops" onPress={() => router.push("/support?agent=operations" as any)} style={[styles.nexCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name="analytics" size={22} color={c.onAccentBg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>Operations Agent</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Ask about active trips, fleet utilization, anomalies.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
            </Pressable>
            <Pressable testID="open-fin" onPress={() => router.push("/support?agent=finance" as any)} style={[styles.nexCard, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 10 }]}>
              <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name="cash" size={22} color={c.onAccentBg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>Finance Agent</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Ask about revenue, commissions, refunds, payouts.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
            </Pressable>
          </View>
        )}

        {tab === "payouts" && (
          <View>
            {commissionConfig && (
              <RaidexCard padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name="pricetag" size={18} color={c.onAccentBg} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.semibold, letterSpacing: 1 }}>DEFAULT COMMISSION RATE</Text>
                  {!editingCommission ? (
                    <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: tokens.weight.bold, marginTop: 2 }}>
                      {(commissionConfig.default_rate * 100).toFixed(1)}%
                    </Text>
                  ) : (
                    <View style={{ marginTop: 8, width: 140 }}>
                      <RaidexInput
                        testID="commission-rate-input"
                        value={commissionInput}
                        onChangeText={setCommissionInput}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 15"
                      />
                    </View>
                  )}
                  {(commissionConfig.category_overrides && Object.keys(commissionConfig.category_overrides).length > 0) && (
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 6 }}>
                      Category overrides: {Object.entries(commissionConfig.category_overrides).map(([k, v]: any) => `${k} ${(v * 100).toFixed(0)}%`).join(", ")}
                    </Text>
                  )}
                  {(commissionConfig.owner_overrides && Object.keys(commissionConfig.owner_overrides).length > 0) && (
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
                      Owner overrides: {Object.entries(commissionConfig.owner_overrides).map(([k, v]: any) => `${k} ${(v * 100).toFixed(0)}%`).join(", ")}
                    </Text>
                  )}
                </View>
                {!editingCommission ? (
                  <RaidexButton
                    testID="commission-edit-btn"
                    label="Edit"
                    onPress={() => { setCommissionInput((commissionConfig.default_rate * 100).toFixed(1)); setEditingCommission(true); }}
                    size="md"
                    fullWidth={false}
                  />
                ) : (
                  <View style={{ gap: 6 }}>
                    <RaidexButton testID="commission-save-btn" label="Save" onPress={saveCommissionRate} size="md" fullWidth={false} />
                    <RaidexButton testID="commission-cancel-btn" label="Cancel" onPress={() => setEditingCommission(false)} variant="secondary" size="md" fullWidth={false} />
                  </View>
                )}
              </RaidexCard>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }} style={{ height: 44 }}>
              {PAYOUT_STATUSES.map((s) => (
                <RaidexChip
                  key={s.k || "all"}
                  testID={`payout-status-${s.k || "all"}`}
                  label={s.label}
                  active={payoutStatusFilter === s.k}
                  onPress={() => onPickPayoutStatus(s.k)}
                />
              ))}
            </ScrollView>

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginVertical: 12 }}>Payouts ({payouts.length})</Text>
            {loading && payouts.length === 0 ? (
              <RowSkeletons />
            ) : payouts.length === 0 ? (
              <RaidexEmptyState icon="cash-outline" title="No payouts found" />
            ) : (
              payouts.map((p) => (
                <RaidexCard key={p.payout_id} padding={tokens.spacing.md} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>Vehicle {p.vehicle_id}</Text>
                      <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
                        {p.booking_id ? `Booking ${p.booking_id}` : `Subscription ${p.subscription_id}`} · Owner {p.owner_id}
                      </Text>
                    </View>
                    <RaidexStatusPill status={p.status} />
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 10 }}>
                    <View>
                      <Text style={{ color: c.onSurface3, fontSize: 10, fontWeight: tokens.weight.semibold }}>GROSS</Text>
                      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{p.currency || "INR"} {Number(p.gross_amount).toLocaleString()}</Text>
                    </View>
                    <View>
                      <Text style={{ color: c.onSurface3, fontSize: 10, fontWeight: tokens.weight.semibold }}>COMMISSION</Text>
                      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{p.currency || "INR"} {Number(p.commission_amount).toLocaleString()} ({(p.commission_rate * 100).toFixed(0)}%)</Text>
                    </View>
                    <View>
                      <Text style={{ color: c.onSurface3, fontSize: 10, fontWeight: tokens.weight.semibold }}>NET</Text>
                      <Text style={{ color: c.accent, fontWeight: tokens.weight.bold }}>{p.currency || "INR"} {Number(p.net_amount).toLocaleString()}</Text>
                    </View>
                  </View>
                  {p.payment_reference && (
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 8 }}>Ref: {p.payment_reference}</Text>
                  )}
                  {p.status !== "paid" && (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                      <Pressable
                        testID={`mark-paid-btn-${p.payout_id}`}
                        onPress={() => setMarkPaidTarget(p)}
                        style={[styles.smBtn, { backgroundColor: c.accent }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: tokens.weight.bold }}>Mark paid</Text>
                      </Pressable>
                      <Pressable
                        testID={`mark-failed-btn-${p.payout_id}`}
                        onPress={() => markPayoutFailed(p.payout_id)}
                        style={[styles.smBtn, { backgroundColor: c.error }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: tokens.weight.bold }}>Mark failed</Text>
                      </Pressable>
                    </View>
                  )}
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "flags" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 4 }}>Feature flags</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginBottom: 12 }}>
              Off by default. Flip on only after QA - these reach real users immediately.
            </Text>
            {KNOWN_FLAGS.map((kf) => {
              const saved = flags[kf.flag];
              const enabled = !!saved?.enabled;
              return (
                <RaidexCard key={kf.flag} padding={tokens.spacing.md} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{kf.label}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>{kf.description}</Text>
                    {saved?.updated_at && (
                      <Text style={{ color: c.onSurface3, fontSize: 10, marginTop: 4 }}>
                        Last changed by {saved.updated_by || "unknown"}
                      </Text>
                    )}
                  </View>
                  {flagBusy === kf.flag ? (
                    <ActivityIndicator color={c.accent} />
                  ) : (
                    <Switch
                      testID={`flag-toggle-${kf.flag}`}
                      value={enabled}
                      onValueChange={() => toggleFlag(kf.flag, enabled)}
                      trackColor={{ false: c.surface3, true: c.accent }}
                    />
                  )}
                </RaidexCard>
              );
            })}
          </View>
        )}
      </ScrollView>

      {markPaidTarget && (
        <MarkPaidModal
          payout={markPaidTarget}
          onDismiss={() => setMarkPaidTarget(null)}
          onConfirm={(ref: string) => markPayoutPaid(markPaidTarget.payout_id, ref)}
        />
      )}
    </View>
  );
}

function slug(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Lightweight row placeholders for the dense list tabs - no shimmer/entrance
// choreography beyond RaidexSkeleton's own pulse, matching the admin brief
// ("density, speed, clarity" - not consumer-style animation).
function RowSkeletons({ count = 4 }: { count?: number }) {
  const c = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: tokens.spacing.md, borderRadius: tokens.radius.lg, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
          <RaidexSkeleton width={36} height={36} radius={999} />
          <View style={{ flex: 1, gap: 6 }}>
            <RaidexSkeleton width="55%" height={12} />
            <RaidexSkeleton width="35%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

function MarkPaidModal({ payout, onDismiss, onConfirm }: any) {
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reference.trim()) {
      Alert.alert("Reference required", "Enter a payment reference.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reference.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <RaidexModal
      visible
      testID="mark-paid-modal"
      title="Mark payout paid"
      subtitle={`${payout.booking_id ? `Booking ${payout.booking_id}` : `Subscription ${payout.subscription_id}`} · Net ${payout.currency || "INR"} ${Number(payout.net_amount).toLocaleString()}`}
      onDismiss={onDismiss}
      primaryLabel="Confirm paid"
      onPrimary={submit}
      primaryBusy={busy}
      dismissTestID="mark-paid-dismiss-btn"
      primaryTestID="mark-paid-confirm-btn"
    >
      <RaidexInput
        testID="mark-paid-reference-input"
        value={reference}
        onChangeText={setReference}
        placeholder="Payment reference (e.g. UTR / transaction id)"
      />
    </RaidexModal>
  );
}

const styles = StyleSheet.create({
  smBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  avatarSm: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  iconRound: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  nexCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
});
