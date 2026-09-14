import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { isBefore, isSameDay } from "date-fns";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { approveKyc, rejectKyc, updateDispute, approveVehicleSwap, rejectVehicleSwap } from "@/src/features/admin/api/admin";
import { useAuth } from "@/src/context/AuthContext";
import { MIN_BOOKING_LEAD_HOURS, QuickDatePicker, TimeSlotPicker, mergeDateAndTime } from "@/src/components/ScheduleCalendar";
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

type Tab = "kpis" | "vehicles" | "kyc" | "users" | "payments" | "disputes" | "swaps" | "geofence" | "health" | "nexus" | "payouts" | "pricing" | "flags";

// Tabs whose body is a fetched list - these get row skeletons while loading
// instead of the generic top-of-scroll spinner used for the rest.
const LIST_TABS: Tab[] = ["vehicles", "kyc", "users", "payments", "disputes", "swaps", "geofence", "payouts", "pricing"];

// Metadata-driven layout for the global pricing rules form (PricingConfigUpdate
// in backend/server.py / DEFAULT_CONFIG in raidex_platform/pricing_engine.py).
// `pct` fields are stored server-side as 0..1 fractions but edited here as a
// 0..100 percentage, matching the existing commission-rate input convention
// (see commissionInput above).
type PricingFieldDef = { key: string; label: string; path: string[]; pct?: boolean; suffix?: string };

const PRICING_FIELD_GROUPS: { title: string; fields: PricingFieldDef[] }[] = [
  {
    title: "Duration & Notice",
    fields: [
      { key: "min_booking_hours_car", label: "Min booking hours - Car", path: ["min_booking_hours", "car"] },
      { key: "min_booking_hours_bike", label: "Min booking hours - Bike", path: ["min_booking_hours", "bike"] },
      { key: "min_notice_hours", label: "Min notice hours", path: ["min_notice_hours"] },
    ],
  },
  {
    title: "Duration & Lead-Time Curve",
    fields: [
      { key: "duration_threshold", label: "Long-duration threshold (hours)", path: ["duration_curve", "long_duration_threshold_hours"] },
      { key: "lead_time_threshold", label: "Max discount lead time (hours)", path: ["lead_time_curve", "max_discount_lead_hours"] },
      { key: "weight_duration", label: "Duration weight", path: ["factor_weights", "duration"], pct: true, suffix: "%" },
      { key: "weight_lead_time", label: "Lead-time weight", path: ["factor_weights", "lead_time"], pct: true, suffix: "%" },
    ],
  },
  {
    title: "Fees, Tax & Price Lock",
    fields: [
      { key: "platform_fee_pct", label: "Platform fee", path: ["platform_fee_pct"], pct: true, suffix: "%" },
      { key: "tax_rate", label: "Tax rate", path: ["tax", "rate"], pct: true, suffix: "%" },
      { key: "price_lock_minutes", label: "Price lock (minutes)", path: ["price_lock_minutes"] },
    ],
  },
  {
    title: "Late & Early Check-in",
    fields: [
      { key: "early_checkin_grace_minutes", label: "Early check-in grace (minutes)", path: ["early_checkin_grace_minutes"] },
      { key: "late_fee_multiplier", label: "Late fee multiplier", path: ["late_fee_multiplier"] },
      { key: "late_fee_split_host", label: "Late fee split - Host", path: ["late_fee_split", "host"], pct: true, suffix: "%" },
      { key: "late_fee_split_platform", label: "Late fee split - Platform", path: ["late_fee_split", "platform"], pct: true, suffix: "%" },
      { key: "early_checkin_split_host", label: "Early check-in split - Host", path: ["early_checkin_split", "host"], pct: true, suffix: "%" },
      { key: "early_checkin_split_platform", label: "Early check-in split - Platform", path: ["early_checkin_split", "platform"], pct: true, suffix: "%" },
    ],
  },
  {
    title: "Host Payout",
    fields: [
      { key: "host_payout_pct", label: "Host payout", path: ["host_payout_pct"], pct: true, suffix: "%" },
    ],
  },
  {
    title: "Add-on Pricing (₹)",
    fields: [
      { key: "addon_helmet", label: "Helmet", path: ["add_ons_pricing", "helmet"] },
      { key: "addon_insurance", label: "Insurance", path: ["add_ons_pricing", "insurance"] },
      { key: "addon_delivery", label: "Delivery", path: ["add_ons_pricing", "delivery"] },
    ],
  },
];

function getAtPath(obj: any, path: string[]): any {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setAtPath(obj: any, path: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}

function formatFieldValue(cfg: any, f: PricingFieldDef): string {
  const raw = getAtPath(cfg, f.path);
  if (raw === null || raw === undefined) return "";
  return f.pct ? String(Math.round(raw * 1000) / 10) : String(raw);
}

function buildPricingForm(cfg: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of PRICING_FIELD_GROUPS) for (const f of group.fields) out[f.key] = formatFieldValue(cfg, f);
  return out;
}

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
  const [swaps, setSwaps] = useState<any[]>([]);
  const [commissionConfig, setCommissionConfig] = useState<any>(null);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState("");
  const [markPaidTarget, setMarkPaidTarget] = useState<any>(null);
  const [kycRejectTarget, setKycRejectTarget] = useState<any>(null);
  const [kycBusyId, setKycBusyId] = useState<string | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<{ dispute: any; status: "resolved" | "rejected" } | null>(null);
  const [swapRejectTarget, setSwapRejectTarget] = useState<any>(null);
  const [swapBusyId, setSwapBusyId] = useState<string | null>(null);
  const [editingCommission, setEditingCommission] = useState(false);
  const [commissionInput, setCommissionInput] = useState("");
  const [flags, setFlags] = useState<Record<string, any>>({});
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- Pricing tab state ---
  const [pricingConfig, setPricingConfig] = useState<any>(null);
  const [pricingVehicles, setPricingVehicles] = useState<any[]>([]);
  const [editingPricing, setEditingPricing] = useState(false);
  const [pricingForm, setPricingForm] = useState<Record<string, string>>({});
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [vehiclePricingTarget, setVehiclePricingTarget] = useState<any>(null);
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [simVehicle, setSimVehicle] = useState<any>(null);
  const today = useMemo(() => new Date(), []);
  const [simPickupDate, setSimPickupDate] = useState<Date>(today);
  const [simPickupTime, setSimPickupTime] = useState<string | null>(null);
  const [simReturnDate, setSimReturnDate] = useState<Date>(today);
  const [simReturnTime, setSimReturnTime] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

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
      if (t === "swaps") setSwaps(await api<any[]>("/admin/vehicle-swaps?status=requested"));
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
      if (t === "pricing") {
        const [cfg, allVehicles] = await Promise.all([
          api<any>("/admin/pricing-config"),
          api<any[]>("/admin/vehicles"),
        ]);
        setPricingConfig(cfg);
        setPricingVehicles(allVehicles);
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

  const approveKycSubmission = async (kycId: string) => {
    setKycBusyId(kycId);
    try {
      await approveKyc(kycId);
      loadTab("kyc");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setKycBusyId(null);
    }
  };

  const rejectKycSubmission = async (kycId: string, reason: string) => {
    try {
      await rejectKyc(kycId, reason);
      setKycRejectTarget(null);
      loadTab("kyc");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const resolveDispute = async (disputeId: string, status: "resolved" | "rejected", resolution: string) => {
    try {
      await updateDispute(disputeId, { status, resolution: resolution.trim() || undefined });
      setDisputeTarget(null);
      loadTab("disputes");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const approveSwap = async (swapId: string) => {
    setSwapBusyId(swapId);
    try {
      await approveVehicleSwap(swapId);
      loadTab("swaps");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSwapBusyId(null);
    }
  };

  const rejectSwap = async (swapId: string, notes: string) => {
    try {
      await rejectVehicleSwap(swapId, notes.trim() || undefined);
      setSwapRejectTarget(null);
      loadTab("swaps");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
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
    { k: "swaps", label: "Swaps", ic: "swap-horizontal" },
    { k: "geofence", label: "Geofence", ic: "shield" },
    { k: "health", label: "Health", ic: "pulse" },
    { k: "nexus", label: "AI Nexus", ic: "sparkles" },
    { k: "payouts", label: "Payouts", ic: "cash" },
    { k: "pricing", label: "Pricing", ic: "calculator" },
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

  const startEditPricing = () => {
    setPricingForm(buildPricingForm(pricingConfig));
    setTaxEnabled(!!pricingConfig?.tax?.enabled);
    setTaxInclusive(!!pricingConfig?.tax?.inclusive);
    setEditingPricing(true);
  };

  const weightSum = useMemo(() => {
    const d = parseFloat(pricingForm.weight_duration);
    const l = parseFloat(pricingForm.weight_lead_time);
    if (isNaN(d) || isNaN(l)) return null;
    return d + l;
  }, [pricingForm.weight_duration, pricingForm.weight_lead_time]);

  const savePricingConfig = () => {
    const updates: any = {};
    for (const group of PRICING_FIELD_GROUPS) {
      for (const f of group.fields) {
        const raw = parseFloat(pricingForm[f.key]);
        if (isNaN(raw)) {
          Alert.alert("Invalid input", `"${f.label}" must be a number.`);
          return;
        }
        setAtPath(updates, f.path, f.pct ? raw / 100 : raw);
      }
    }
    updates.tax = { ...(updates.tax || {}), enabled: taxEnabled, inclusive: taxInclusive };
    Alert.alert(
      "Update pricing rules?",
      "This changes how every future booking is priced across the platform.",
      [
        { text: "Cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setSavingPricing(true);
            try {
              const updated = await api<any>("/admin/pricing-config", { method: "PUT", body: updates });
              setPricingConfig(updated);
              setEditingPricing(false);
            } catch (e: any) {
              Alert.alert("Error", e.message);
            } finally {
              setSavingPricing(false);
            }
          },
        },
      ]
    );
  };

  const saveVehiclePricing = async (vehicleId: string, minRate: number, maxRate: number) => {
    const updated = await api<any>(`/admin/vehicles/${vehicleId}/pricing`, {
      method: "PATCH",
      body: { min_hourly_rate: minRate, max_hourly_rate: maxRate },
    });
    setPricingVehicles((prev) => prev.map((v) => (v.vehicle_id === vehicleId ? { ...v, ...updated } : v)));
    setVehicles((prev) => prev.map((v) => (v.vehicle_id === vehicleId ? { ...v, ...updated } : v)));
    setSimVehicle((prev: any) => (prev && prev.vehicle_id === vehicleId ? { ...prev, ...updated } : prev));
    setVehiclePricingTarget(null);
  };

  const filteredPricingVehicles = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    if (!q) return pricingVehicles;
    return pricingVehicles.filter((v) =>
      [v.name, v.brand, v.model].filter(Boolean).some((s: string) => s.toLowerCase().includes(q))
    );
  }, [pricingVehicles, vehicleQuery]);

  const pickSimVehicle = (v: any) => {
    setSimVehicle(v);
    setSimPickupDate(today);
    setSimPickupTime(null);
    setSimReturnDate(today);
    setSimReturnTime(null);
    setSimResult(null);
    setSimError(null);
  };

  // Keep the return date/time coherent as the pickup side changes - mirrors
  // the consumer booking screen's own reset behavior (app/booking/[id].tsx)
  // rather than inventing a new rule here.
  useEffect(() => {
    if (isBefore(simReturnDate, simPickupDate)) {
      setSimReturnDate(simPickupDate);
      setSimReturnTime(null);
    }
  }, [simPickupDate]);

  useEffect(() => {
    if (!simPickupTime || !simReturnTime) return;
    if (isSameDay(simPickupDate, simReturnDate) && Number(simReturnTime.split(":")[0]) <= Number(simPickupTime.split(":")[0])) {
      setSimReturnTime(null);
    }
  }, [simPickupTime]);

  // Recalculate (debounced) whenever the simulator's vehicle or dates change,
  // so an admin sees pricing update immediately without a manual "recalculate"
  // button - matching the pricing-simulate endpoint's stated purpose.
  useEffect(() => {
    if (!simVehicle || !simPickupTime || !simReturnTime) {
      setSimResult(null);
      setSimError(null);
      return;
    }
    const start = mergeDateAndTime(simPickupDate, simPickupTime);
    const end = mergeDateAndTime(simReturnDate, simReturnTime);
    if (end <= start) {
      setSimResult(null);
      setSimError("Return must be after pickup.");
      return;
    }
    setSimError(null);
    const handle = setTimeout(async () => {
      setSimLoading(true);
      try {
        const result = await api<any>("/admin/pricing-simulate", {
          method: "POST",
          body: { vehicle_id: simVehicle.vehicle_id, start_date: start.toISOString(), end_date: end.toISOString() },
        });
        setSimResult(result);
      } catch (e: any) {
        setSimError(e.message);
        setSimResult(null);
      } finally {
        setSimLoading(false);
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [simVehicle, simPickupDate, simPickupTime, simReturnDate, simReturnTime]);

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
                      <Pressable
                        testID={`set-rates-${v.vehicle_id}`}
                        onPress={() => setVehiclePricingTarget(v)}
                        style={[styles.smBtn, { backgroundColor: c.surface3 }]}>
                        <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: tokens.weight.bold }}>Set rates</Text>
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
                <RaidexCard key={item.kyc_id} padding={tokens.spacing.md} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Ionicons name={item.status === "verified" ? "checkmark-circle" : item.status === "rejected" ? "close-circle" : "time"} size={22} color={item.status === "verified" ? c.accent : item.status === "rejected" ? c.error : c.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{item.dl_number || item.user_id}</Text>
                      <Text style={{ color: c.onSurface3, fontSize: 11 }}>Aadhaar: ****{item.aadhaar_last4} · {item.provider || "provider"}</Text>
                    </View>
                    <RaidexStatusPill status={item.status} />
                  </View>
                  {item.status === "processing" && (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                      <RaidexButton
                        testID={`kyc-approve-${item.kyc_id}`}
                        label="Approve"
                        onPress={() => approveKycSubmission(item.kyc_id)}
                        loading={kycBusyId === item.kyc_id}
                        size="md"
                        fullWidth={false}
                      />
                      <RaidexButton
                        testID={`kyc-reject-${item.kyc_id}`}
                        label="Reject"
                        onPress={() => setKycRejectTarget(item)}
                        variant="destructive"
                        size="md"
                        fullWidth={false}
                      />
                    </View>
                  )}
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
                <RaidexCard key={d.dispute_id} padding={tokens.spacing.md} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Ionicons name="flag" size={20} color={d.status === "resolved" ? c.accent : c.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, textTransform: "capitalize" }}>{d.category}</Text>
                      <Text style={{ color: c.onSurface3, fontSize: 11 }} numberOfLines={2}>{d.message}</Text>
                    </View>
                    <RaidexStatusPill status={d.status} />
                  </View>
                  {(d.status === "open" || d.status === "investigating") && (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                      <RaidexButton
                        testID={`dispute-resolve-${d.dispute_id}`}
                        label="Resolve"
                        onPress={() => setDisputeTarget({ dispute: d, status: "resolved" })}
                        size="md"
                        fullWidth={false}
                      />
                      <RaidexButton
                        testID={`dispute-reject-${d.dispute_id}`}
                        label="Reject"
                        onPress={() => setDisputeTarget({ dispute: d, status: "rejected" })}
                        variant="destructive"
                        size="md"
                        fullWidth={false}
                      />
                    </View>
                  )}
                </RaidexCard>
              ))
            )}
          </View>
        )}

        {tab === "swaps" && (
          <View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 12 }}>Vehicle swap requests ({swaps.length})</Text>
            {loading && swaps.length === 0 ? (
              <RowSkeletons />
            ) : swaps.length === 0 ? (
              <RaidexEmptyState icon="swap-horizontal-outline" title="No swap requests" />
            ) : (
              swaps.map((s) => (
                <RaidexCard key={s.swap_id} padding={tokens.spacing.md} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Ionicons name="swap-horizontal" size={22} color={c.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>Vehicle {s.old_vehicle_id} → {s.new_vehicle_id}</Text>
                      <Text style={{ color: c.onSurface3, fontSize: 11 }}>Subscription {s.subscription_id} · Fee ₹{Number(s.fee_amount || 0).toLocaleString()}</Text>
                    </View>
                    <RaidexStatusPill status={s.status} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <RaidexButton
                      testID={`swap-approve-${s.swap_id}`}
                      label="Approve"
                      onPress={() => approveSwap(s.swap_id)}
                      loading={swapBusyId === s.swap_id}
                      size="md"
                      fullWidth={false}
                    />
                    <RaidexButton
                      testID={`swap-reject-${s.swap_id}`}
                      label="Reject"
                      onPress={() => setSwapRejectTarget(s)}
                      variant="destructive"
                      size="md"
                      fullWidth={false}
                    />
                  </View>
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

        {tab === "pricing" && (
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14 }}>Global pricing rules</Text>
              {pricingConfig && !editingPricing && (
                <RaidexButton testID="pricing-edit-btn" label="Edit" onPress={startEditPricing} size="md" fullWidth={false} />
              )}
            </View>

            {loading && !pricingConfig ? (
              <RowSkeletons />
            ) : pricingConfig ? (
              <RaidexCard padding={tokens.spacing.md} style={{ marginBottom: 16 }}>
                <Text style={{ color: c.onSurface3, fontSize: 11 }}>
                  Version {pricingConfig.version}
                  {pricingConfig.updated_at ? ` · Updated ${new Date(pricingConfig.updated_at).toLocaleString()}` : ""}
                  {pricingConfig.updated_by ? ` by ${pricingConfig.updated_by}` : ""}
                </Text>

                {!editingPricing ? (
                  <View style={{ marginTop: 8 }}>
                    {PRICING_FIELD_GROUPS.map((group) => (
                      <View key={group.title} style={{ marginTop: 12 }}>
                        <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{group.title}</Text>
                        {group.fields.map((f) => (
                          <View key={f.key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                            <Text style={{ color: c.onSurface3, fontSize: 12 }}>{f.label}</Text>
                            <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: tokens.weight.semibold }}>{formatFieldValue(pricingConfig, f)}{f.suffix || ""}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                    <View style={{ marginTop: 12 }}>
                      <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Tax</Text>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                        <Text style={{ color: c.onSurface3, fontSize: 12 }}>Enabled</Text>
                        <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: tokens.weight.semibold }}>{pricingConfig.tax?.enabled ? "Yes" : "No"}</Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                        <Text style={{ color: c.onSurface3, fontSize: 12 }}>Inclusive</Text>
                        <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: tokens.weight.semibold }}>{pricingConfig.tax?.inclusive ? "Yes" : "No"}</Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={{ marginTop: 8 }}>
                    {PRICING_FIELD_GROUPS.map((group) => (
                      <View key={group.title} style={{ marginTop: 14 }}>
                        <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{group.title}</Text>
                        {group.title === "Duration & Lead-Time Curve" && weightSum !== null && Math.abs(weightSum - 100) > 0.5 && (
                          <Text style={{ color: c.warning, fontSize: 11, marginBottom: 6 }}>
                            Duration + lead-time weight = {weightSum.toFixed(1)}% (expected 100%). Saving anyway is allowed, but the factors won't average as intended.
                          </Text>
                        )}
                        {group.fields.map((f) => (
                          <RaidexInput
                            key={f.key}
                            testID={`pricing-field-${f.key}`}
                            label={f.suffix ? `${f.label} (${f.suffix})` : f.label}
                            value={pricingForm[f.key] ?? ""}
                            onChangeText={(t) => setPricingForm((prev) => ({ ...prev, [f.key]: t }))}
                            keyboardType="decimal-pad"
                          />
                        ))}
                      </View>
                    ))}
                    <View style={{ marginTop: 14 }}>
                      <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Tax</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
                        <Text style={{ color: c.onSurface, fontSize: 13 }}>Tax enabled</Text>
                        <Switch testID="pricing-tax-enabled" value={taxEnabled} onValueChange={setTaxEnabled} trackColor={{ false: c.surface3, true: c.accent }} />
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
                        <Text style={{ color: c.onSurface, fontSize: 13 }}>Tax inclusive (rate already inside rental subtotal)</Text>
                        <Switch testID="pricing-tax-inclusive" value={taxInclusive} onValueChange={setTaxInclusive} trackColor={{ false: c.surface3, true: c.accent }} />
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                      <View style={{ flex: 1 }}>
                        <RaidexButton testID="pricing-save-btn" label="Save" onPress={savePricingConfig} loading={savingPricing} size="md" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <RaidexButton testID="pricing-cancel-btn" label="Cancel" onPress={() => setEditingPricing(false)} variant="secondary" size="md" disabled={savingPricing} />
                      </View>
                    </View>
                  </View>
                )}
              </RaidexCard>
            ) : null}

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginBottom: 8 }}>Vehicles ({filteredPricingVehicles.length})</Text>
            <RaidexInput
              testID="pricing-vehicle-search"
              value={vehicleQuery}
              onChangeText={setVehicleQuery}
              placeholder="Search by name, brand or model"
              icon="search"
            />
            {loading && pricingVehicles.length === 0 ? (
              <RowSkeletons />
            ) : filteredPricingVehicles.length === 0 ? (
              <RaidexEmptyState icon="car-outline" title="No vehicles found" />
            ) : (
              filteredPricingVehicles.map((v) => (
                <RaidexCard key={v.vehicle_id} padding={tokens.spacing.md} style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
                  <Image source={v.image} style={{ width: 56, height: 56, borderRadius: 10 }} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{v.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.brand} {v.model} · ₹{v.price_per_hour}/hr</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
                      {v.min_hourly_rate != null && v.max_hourly_rate != null
                        ? `Rate range ₹${v.min_hourly_rate} - ₹${v.max_hourly_rate}/hr`
                        : "Not yet priced - no admin rate range set"}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable
                        testID={`pricing-set-rates-${v.vehicle_id}`}
                        onPress={() => setVehiclePricingTarget(v)}
                        style={[styles.smBtn, { backgroundColor: c.surface3 }]}>
                        <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: tokens.weight.bold }}>Edit rates</Text>
                      </Pressable>
                      <Pressable
                        testID={`pricing-simulate-pick-${v.vehicle_id}`}
                        onPress={() => pickSimVehicle(v)}
                        style={[styles.smBtn, { backgroundColor: simVehicle?.vehicle_id === v.vehicle_id ? c.accent : c.surface3 }]}>
                        <Text style={{ color: simVehicle?.vehicle_id === v.vehicle_id ? "#fff" : c.onSurface, fontSize: 12, fontWeight: tokens.weight.bold }}>
                          {simVehicle?.vehicle_id === v.vehicle_id ? "Simulating" : "Simulate"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </RaidexCard>
              ))
            )}

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14, marginTop: 8, marginBottom: 12 }}>Price simulator</Text>
            {!simVehicle ? (
              <RaidexEmptyState icon="calculator-outline" title="Pick a vehicle above to simulate pricing" />
            ) : (
              <View>
                <RaidexCard padding={tokens.spacing.md} style={{ marginBottom: 12 }}>
                  <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{simVehicle.name}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{simVehicle.brand} {simVehicle.model} · Rate range ₹{simVehicle.min_hourly_rate ?? "-"} - ₹{simVehicle.max_hourly_rate ?? "-"}/hr</Text>
                </RaidexCard>

                <QuickDatePicker c={c} label="Pickup date" selectedDate={simPickupDate} minDate={today} onSelect={setSimPickupDate} testIDPrefix="sim-pickup-date" />
                <View style={{ marginTop: 12 }}>
                  <TimeSlotPicker
                    c={c}
                    selected={simPickupTime}
                    testIDPrefix="sim-pickup-time"
                    emptyLabel={`No slots left today - pick tomorrow (${MIN_BOOKING_LEAD_HOURS}h notice required)`}
                    isDisabled={(hour) => {
                      if (!isSameDay(simPickupDate, today)) return false;
                      const cutoff = new Date(Date.now() + MIN_BOOKING_LEAD_HOURS * 3_600_000);
                      return mergeDateAndTime(simPickupDate, `${String(hour).padStart(2, "0")}:00`) < cutoff;
                    }}
                    onSelect={setSimPickupTime}
                  />
                </View>

                <View style={{ marginTop: 16 }}>
                  <QuickDatePicker c={c} label="Return date" selectedDate={simReturnDate} minDate={simPickupDate} onSelect={(d) => { setSimReturnDate(d); setSimReturnTime(null); }} testIDPrefix="sim-return-date" />
                  <View style={{ marginTop: 12 }}>
                    <TimeSlotPicker
                      c={c}
                      selected={simReturnTime}
                      testIDPrefix="sim-return-time"
                      emptyLabel={!simPickupTime ? "Pick a pickup time first" : "No slots available"}
                      isDisabled={(hour) => {
                        if (!simPickupTime) return true;
                        if (!isSameDay(simPickupDate, simReturnDate)) return false;
                        return hour <= Number(simPickupTime.split(":")[0]);
                      }}
                      onSelect={setSimReturnTime}
                    />
                  </View>
                </View>

                <View style={{ marginTop: 16 }}>
                  {simLoading && <ActivityIndicator color={c.accent} style={{ marginVertical: 12 }} />}
                  {simError && <Text style={{ color: c.error, fontSize: 12, marginBottom: 8 }}>{simError}</Text>}
                  {simResult && !simLoading && (
                    <View>
                      <RaidexCard variant="dark" padding={tokens.spacing.lg} style={{ borderRadius: 20, marginBottom: 12 }}>
                        <Text style={{ color: "#05C46B", fontSize: 11, fontWeight: tokens.weight.bold, letterSpacing: 3 }}>TOTAL PAYABLE</Text>
                        <Text testID="sim-total-payable" style={{ color: "#fff", fontSize: 32, fontWeight: tokens.weight.bold, marginTop: 6 }}>{simResult.currency} {Number(simResult.total_payable).toLocaleString()}</Text>
                        <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
                          {simResult.calculated_hourly_rate}/hr · {simResult.duration_hours}h · {simResult.lead_time_hours}h notice
                        </Text>
                      </RaidexCard>

                      {(!simResult.meets_minimum_duration || !simResult.meets_minimum_notice) && (
                        <RaidexCard padding={tokens.spacing.md} style={{ marginBottom: 12, borderColor: c.warning, borderWidth: 1 }}>
                          {!simResult.meets_minimum_duration && (
                            <Text style={{ color: c.warning, fontSize: 12 }}>Below minimum bookable duration ({simResult.min_booking_hours}h)</Text>
                          )}
                          {!simResult.meets_minimum_notice && (
                            <Text style={{ color: c.warning, fontSize: 12 }}>Below minimum notice ({simResult.min_notice_hours}h)</Text>
                          )}
                        </RaidexCard>
                      )}

                      <RaidexCard padding={tokens.spacing.md}>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
                          {[
                            ["RATE RANGE", `₹${simResult.rate_range.min} - ₹${simResult.rate_range.max}/hr`],
                            ["DURATION FACTOR", simResult.duration_factor],
                            ["LEAD-TIME FACTOR", simResult.lead_time_factor],
                            ["COMBINED FACTOR", simResult.combined_factor],
                            ["RENTAL SUBTOTAL", `₹${Number(simResult.rental_subtotal).toLocaleString()}`],
                            ["PLATFORM FEE", `₹${Number(simResult.platform_fee).toLocaleString()} (${(simResult.platform_fee_pct * 100).toFixed(0)}%)`],
                            ["TAX", `₹${Number(simResult.tax).toLocaleString()} (${(simResult.tax_rate * 100).toFixed(0)}%)`],
                            ["DISCOUNT", `₹${Number(simResult.discount).toLocaleString()}`],
                            ["SECURITY DEPOSIT", `₹${Number(simResult.security_deposit).toLocaleString()}`],
                            ["HOST PAYOUT", `₹${Number(simResult.host_payout).toLocaleString()} (${(simResult.host_payout_pct * 100).toFixed(0)}%)`],
                            ["PLATFORM COMMISSION", `₹${Number(simResult.platform_commission).toLocaleString()}`],
                            ["PRICING RULE VERSION", simResult.pricing_rule_version],
                          ].map(([label, value]) => (
                            <View key={label as string} style={{ minWidth: "45%" }}>
                              <Text style={{ color: c.onSurface3, fontSize: 10, fontWeight: tokens.weight.semibold }}>{label}</Text>
                              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, marginTop: 2 }}>{String(value)}</Text>
                            </View>
                          ))}
                        </View>
                      </RaidexCard>
                    </View>
                  )}
                </View>
              </View>
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

      {kycRejectTarget && (
        <KycRejectModal
          submission={kycRejectTarget}
          onDismiss={() => setKycRejectTarget(null)}
          onConfirm={(reason: string) => rejectKycSubmission(kycRejectTarget.kyc_id, reason)}
        />
      )}

      {disputeTarget && (
        <DisputeResolveModal
          dispute={disputeTarget.dispute}
          status={disputeTarget.status}
          onDismiss={() => setDisputeTarget(null)}
          onConfirm={(notes: string) => resolveDispute(disputeTarget.dispute.dispute_id, disputeTarget.status, notes)}
        />
      )}

      {swapRejectTarget && (
        <SwapRejectModal
          swap={swapRejectTarget}
          onDismiss={() => setSwapRejectTarget(null)}
          onConfirm={(notes: string) => rejectSwap(swapRejectTarget.swap_id, notes)}
        />
      )}

      {vehiclePricingTarget && (
        <VehiclePricingModal
          vehicle={vehiclePricingTarget}
          onDismiss={() => setVehiclePricingTarget(null)}
          onConfirm={(minRate: number, maxRate: number) => saveVehiclePricing(vehiclePricingTarget.vehicle_id, minRate, maxRate)}
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

function KycRejectModal({ submission, onDismiss, onConfirm }: any) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) {
      Alert.alert("Reason required", "Enter a reason for rejecting this KYC submission.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <RaidexModal
      visible
      testID="kyc-reject-modal"
      title="Reject KYC submission"
      subtitle={submission.dl_number ? `DL ${submission.dl_number}` : submission.user_id}
      onDismiss={onDismiss}
      primaryLabel="Confirm reject"
      onPrimary={submit}
      primaryBusy={busy}
      primaryVariant="destructive"
      dismissTestID="kyc-reject-dismiss-btn"
      primaryTestID="kyc-reject-confirm-btn"
    >
      <RaidexInput
        testID="kyc-reject-reason-input"
        value={reason}
        onChangeText={setReason}
        placeholder="Reason (shown to the applicant)"
      />
    </RaidexModal>
  );
}

function DisputeResolveModal({ dispute, status, onDismiss, onConfirm }: any) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const isReject = status === "rejected";
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(notes);
    } finally {
      setBusy(false);
    }
  };
  return (
    <RaidexModal
      visible
      testID="dispute-resolve-modal"
      title={isReject ? "Reject dispute" : "Resolve dispute"}
      subtitle={dispute.message}
      onDismiss={onDismiss}
      primaryLabel={isReject ? "Confirm reject" : "Confirm resolved"}
      onPrimary={submit}
      primaryBusy={busy}
      primaryVariant={isReject ? "destructive" : "primary"}
      dismissTestID="dispute-resolve-dismiss-btn"
      primaryTestID="dispute-resolve-confirm-btn"
    >
      <RaidexInput
        testID="dispute-resolve-notes-input"
        value={notes}
        onChangeText={setNotes}
        placeholder="Resolution notes (optional)"
      />
    </RaidexModal>
  );
}

function SwapRejectModal({ swap, onDismiss, onConfirm }: any) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(notes);
    } finally {
      setBusy(false);
    }
  };
  return (
    <RaidexModal
      visible
      testID="swap-reject-modal"
      title="Reject vehicle swap"
      subtitle={`${swap.old_vehicle_id} → ${swap.new_vehicle_id}`}
      onDismiss={onDismiss}
      primaryLabel="Confirm reject"
      onPrimary={submit}
      primaryBusy={busy}
      primaryVariant="destructive"
      dismissTestID="swap-reject-dismiss-btn"
      primaryTestID="swap-reject-confirm-btn"
    >
      <RaidexInput
        testID="swap-reject-notes-input"
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes (optional)"
      />
    </RaidexModal>
  );
}

function VehiclePricingModal({ vehicle, onDismiss, onConfirm }: any) {
  const [minRate, setMinRate] = useState(vehicle.min_hourly_rate != null ? String(vehicle.min_hourly_rate) : "");
  const [maxRate, setMaxRate] = useState(vehicle.max_hourly_rate != null ? String(vehicle.max_hourly_rate) : "");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const min = parseFloat(minRate);
    const max = parseFloat(maxRate);
    if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) {
      Alert.alert("Invalid rate", "Enter valid min/max hourly rates greater than 0.");
      return;
    }
    if (min > max) {
      Alert.alert("Invalid range", "Min hourly rate cannot exceed max hourly rate.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(min, max);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <RaidexModal
      visible
      testID="vehicle-pricing-modal"
      title="Set hourly rate range"
      subtitle={`${vehicle.name} · ${vehicle.brand} ${vehicle.model}`}
      onDismiss={onDismiss}
      primaryLabel="Save"
      onPrimary={submit}
      primaryBusy={busy}
      dismissTestID="vehicle-pricing-dismiss-btn"
      primaryTestID="vehicle-pricing-confirm-btn"
    >
      <RaidexInput
        testID="vehicle-pricing-min-input"
        label="Min hourly rate (₹)"
        value={minRate}
        onChangeText={setMinRate}
        keyboardType="decimal-pad"
        placeholder="e.g. 150"
      />
      <RaidexInput
        testID="vehicle-pricing-max-input"
        label="Max hourly rate (₹)"
        value={maxRate}
        onChangeText={setMaxRate}
        keyboardType="decimal-pad"
        placeholder="e.g. 220"
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
