import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import {
  RaidexCard,
  RaidexButton,
  RaidexChip,
  RaidexInput,
  RaidexStatusPill,
  RaidexPriceCard,
  RaidexEmptyState,
  RaidexModal,
} from "@/src/components/ui";

type Tab = "mine" | "browse";
const DURATIONS = [1, 3, 6, 12];

export default function SubscriptionsScreen() {
  const c = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("mine");
  const [flagChecked, setFlagChecked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [pickVehicle, setPickVehicle] = useState<any | null>(null);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [renewTarget, setRenewTarget] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const flag = await api<{ flag: string; enabled: boolean }>("/features/subscriptions");
      setEnabled(!!flag.enabled);
      if (flag.enabled) {
        setSubs(await api<any[]>("/subscriptions"));
      }
    } catch {
      setEnabled(false);
    } finally {
      setFlagChecked(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const data = await api<any[]>("/vehicles?available=true");
      setVehicles(data);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setVehiclesLoading(false);
      setVehiclesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (tab === "browse" && !vehiclesLoaded) loadVehicles();
  }, [tab, vehiclesLoaded, loadVehicles]);

  const patchSub = (updated: any) => {
    setSubs((prev) => prev.map((s) => (s.subscription_id === updated.subscription_id ? updated : s)));
  };

  const resumePayment = async (sub: any) => {
    try {
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: { subscription_id: sub.subscription_id, amount: sub.total_price, purpose: "subscription", idempotency_key: `sub_${sub.subscription_id}` },
      });
      router.push(`/pay/${payment.payment_id}` as any);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const doCancel = async (reason: string) => {
    if (!cancelTarget) return;
    try {
      const updated = await api<any>(`/subscriptions/${cancelTarget.subscription_id}/cancel`, { method: "POST", body: { reason } });
      patchSub(updated);
      setCancelTarget(null);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const subscribeVehicle = (vehicle: any) => {
    if (user?.kyc_status !== "verified") {
      Alert.alert("KYC required", "Complete KYC verification before subscribing to a vehicle.", [
        { text: "Cancel", style: "cancel" },
        { text: "Complete KYC", onPress: () => router.push(`/kyc?from=/subscriptions` as any) },
      ]);
      return;
    }
    setPickVehicle(vehicle);
  };

  const onCreated = (sub: any) => {
    setSubs((prev) => [sub, ...prev]);
    setTab("mine");
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg }}>
          <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold, marginLeft: 8 }}>Subscriptions</Text>
        </View>
        {flagChecked && enabled && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: tokens.spacing.lg, gap: 8, paddingBottom: 12 }} style={{ height: 56 }}>
            {([{ key: "mine", label: "My subscriptions" }, { key: "browse", label: "Browse vehicles" }] as { key: Tab; label: string }[]).map((t) => (
              <RaidexChip key={t.key} testID={`tab-${t.key}`} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.accent} size="large" />
        </View>
      ) : !enabled ? (
        <View testID="subscriptions-coming-soon" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <RaidexEmptyState
            icon="calendar-outline"
            title="Subscriptions coming soon"
            subtitle="Monthly vehicle subscriptions aren't live for your account yet. Check back soon."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: 100 }}>
          {tab === "mine" ? (
            subs.length === 0 ? (
              <View>
                <RaidexEmptyState
                  testID="subs-empty"
                  icon="car-outline"
                  title="No subscriptions yet"
                  subtitle="You have no vehicle subscriptions yet."
                />
                <View style={{ alignItems: "center", marginTop: -tokens.spacing.md }}>
                  <RaidexButton
                    testID="browse-cta-btn"
                    label="Browse vehicles to subscribe"
                    onPress={() => setTab("browse")}
                    variant="secondary"
                    fullWidth={false}
                    icon="arrow-forward"
                  />
                </View>
              </View>
            ) : (
              subs.map((sub, i) => (
                <Reveal key={sub.subscription_id} index={i}>
                  <SubscriptionCard
                    c={c}
                    sub={sub}
                    onRenew={() => setRenewTarget(sub)}
                    onCancel={() => setCancelTarget(sub)}
                    onSwap={() => router.push(`/subscriptions/${sub.subscription_id}/swap` as any)}
                    onResumePayment={() => resumePayment(sub)}
                  />
                </Reveal>
              ))
            )
          ) : (
            <View>
              <Text style={{ color: c.onSurface3, marginBottom: 16 }}>Pick a vehicle and duration to start a monthly subscription.</Text>
              {vehiclesLoading ? (
                <ActivityIndicator color={c.accent} />
              ) : vehicles.length === 0 ? (
                <RaidexEmptyState
                  icon="car-outline"
                  title="No vehicles available"
                  subtitle="No vehicles are currently available for subscription."
                />
              ) : (
                vehicles.map((v, i) => (
                  <Reveal key={v.vehicle_id} index={i}>
                    <RaidexCard testID={`browse-vehicle-${v.vehicle_id}`} style={{ marginBottom: tokens.spacing.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Image source={v.image} style={{ width: 70, height: 70, borderRadius: tokens.radius.md }} contentFit="cover" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{v.name}</Text>
                          <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.location} · ₹{v.price_per_month?.toLocaleString()}/month</Text>
                        </View>
                        <Pressable testID={`subscribe-btn-${v.vehicle_id}`} onPress={() => subscribeVehicle(v)} style={[styles.smallBtn, { backgroundColor: c.inverse }]}>
                          <Text style={{ color: c.onInverse, fontWeight: tokens.weight.bold, fontSize: 12 }}>Subscribe</Text>
                        </Pressable>
                      </View>
                    </RaidexCard>
                  </Reveal>
                ))
              )}
            </View>
          )}
        </ScrollView>
      )}

      {pickVehicle && (
        <SubscribeModal c={c} vehicle={pickVehicle} onClose={() => setPickVehicle(null)} onCreated={(sub: any) => { setPickVehicle(null); onCreated(sub); }} />
      )}

      {cancelTarget && (
        <CancelModal c={c} sub={cancelTarget} onDismiss={() => setCancelTarget(null)} onConfirm={doCancel} />
      )}

      {renewTarget && (
        <RenewModal c={c} sub={renewTarget} onClose={() => setRenewTarget(null)} />
      )}
    </View>
  );
}

// Entrance-stagger wrapper - same technique used in owner/index.tsx and
// RaidexVehicleCard (index-based delay + fade/rise) - so the subscription
// list and browse list never just pop onto the screen.
function Reveal({ index = 0, children }: { index?: number; children: React.ReactNode }) {
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = withDelay(Math.min(index, 6) * 40, withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) }));
  }, [appear, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 14 }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

function SubscriptionCard({ c, sub, onRenew, onCancel, onSwap, onResumePayment }: any) {
  const usedPct = sub.included_km > 0 ? Math.min(100, (sub.used_km / sub.included_km) * 100) : 0;
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withTiming(usedPct, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
  }, [fill, usedPct]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value}%` }));

  return (
    <RaidexCard testID={`sub-card-${sub.subscription_id}`} style={{ marginBottom: tokens.spacing.md }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Image source={sub.vehicle_snapshot?.image} style={{ width: 70, height: 70, borderRadius: tokens.radius.md }} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>{sub.vehicle_snapshot?.name}</Text>
          <View style={{ marginTop: 6 }}>
            <RaidexStatusPill status={sub.status} />
          </View>
          <Text style={{ color: c.onSurface2, marginTop: 6, fontWeight: tokens.weight.semibold }}>₹{sub.monthly_price?.toLocaleString()}/month</Text>
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: c.onSurface3, fontSize: 12 }}>Mileage used</Text>
          <Text style={{ color: c.onSurface2, fontSize: 12, fontWeight: tokens.weight.semibold }}>{Math.round(sub.used_km)} / {sub.included_km} km</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: c.surface3 }]}>
          <Animated.View style={[{ height: "100%", borderRadius: tokens.radius.pill, backgroundColor: usedPct >= 100 ? c.error : c.accent }, fillStyle]} />
        </View>
      </View>

      {sub.excess_amount_due > 0 && (
        <View style={[styles.warnRow, { backgroundColor: c.surface3 }]}>
          <Ionicons name="alert-circle" size={14} color={c.warning} />
          <Text style={{ color: c.onSurface2, fontSize: 12 }}>Excess mileage charge due: ₹{sub.excess_amount_due.toLocaleString()}</Text>
        </View>
      )}

      {sub.end_date && (
        <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 10 }}>
          {sub.status === "cancelled" ? "Cancelled" : sub.status === "expired" ? "Expired" : "Renews / ends"} on {new Date(sub.end_date).toLocaleDateString()}
        </Text>
      )}
      {sub.status === "cancelled" && sub.cancel_reason && (
        <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Reason: {sub.cancel_reason}</Text>
      )}

      {sub.status === "pending_payment" && (
        <View style={{ marginTop: 14 }}>
          <RaidexButton testID={`pay-btn-${sub.subscription_id}`} label={`Complete payment · ₹${sub.total_price?.toLocaleString()}`} onPress={onResumePayment} />
        </View>
      )}

      {sub.status === "active" && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <Pressable testID={`renew-btn-${sub.subscription_id}`} onPress={onRenew} style={[styles.actionBtn, { backgroundColor: c.inverse }]}>
            <Text style={{ color: c.onInverse, fontWeight: tokens.weight.bold, fontSize: 12 }}>Renew</Text>
          </Pressable>
          <Pressable testID={`swap-btn-${sub.subscription_id}`} onPress={onSwap} style={[styles.actionBtn, { backgroundColor: c.surface3 }]}>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 12 }}>Swap vehicle</Text>
          </Pressable>
          <Pressable testID={`cancel-btn-${sub.subscription_id}`} onPress={onCancel} style={[styles.actionBtn, { backgroundColor: c.surface3 }]}>
            <Text style={{ color: c.error, fontWeight: tokens.weight.bold, fontSize: 12 }}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </RaidexCard>
  );
}

function SubscribeModal({ c, vehicle, onClose, onCreated }: any) {
  const router = useRouter();
  const [duration, setDuration] = useState(1);
  const [quote, setQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadQuote = useCallback(async (months: number) => {
    setLoadingQuote(true);
    setQuote(null);
    try {
      const q = await api<any>(`/subscriptions/vehicles/${vehicle.vehicle_id}/quote?duration_months=${months}`);
      setQuote(q);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoadingQuote(false);
    }
  }, [vehicle.vehicle_id]);

  useEffect(() => { loadQuote(duration); }, [duration, loadQuote]);

  const confirm = async () => {
    setBusy(true);
    try {
      const sub = await api<any>("/subscriptions", { method: "POST", body: { vehicle_id: vehicle.vehicle_id, duration_months: duration } });
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: { subscription_id: sub.subscription_id, amount: sub.total_price, purpose: "subscription", idempotency_key: `sub_${sub.subscription_id}` },
      });
      onCreated(sub);
      router.push(`/pay/${payment.payment_id}` as any);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RaidexModal
      visible
      onDismiss={onClose}
      title={`Subscribe to ${vehicle.name}`}
      subtitle="Pick a plan duration to see monthly pricing, deposit, and included mileage."
      primaryLabel="Confirm subscription & pay"
      onPrimary={confirm}
      primaryBusy={busy}
      primaryDisabled={busy || !quote}
      primaryTestID="confirm-subscribe-btn"
      testID="subscribe-modal"
    >
      <Pressable testID="close-subscribe-modal-btn" onPress={onClose} style={{ position: "absolute", top: -2, right: 0 }}>
        <Ionicons name="close" size={22} color={c.onSurface3} />
      </Pressable>

      <Text style={[styles.lbl, { color: c.onSurface2 }]}>Duration</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {DURATIONS.map((m) => (
          <RaidexChip key={m} testID={`duration-${m}`} label={`${m} mo`} active={duration === m} onPress={() => setDuration(m)} />
        ))}
      </View>

      {loadingQuote ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} />
      ) : quote ? (
        <View style={{ marginTop: 16 }}>
          <RaidexPriceCard
            testID="subscribe-total"
            totalLabel="Total due now"
            total={`₹${quote.total_price.toLocaleString()}`}
            lines={[
              { label: `Monthly price × ${quote.duration_months} mo`, value: `₹${quote.monthly_price.toLocaleString()}` },
              { label: "Deposit (refundable)", value: `₹${quote.deposit.toLocaleString()}` },
              { label: "Included mileage", value: `${quote.included_km.toLocaleString()} km` },
              { label: "Excess km rate", value: `₹${quote.excess_km_rate}/km` },
              { label: "Included swaps", value: String(quote.included_swaps) },
            ]}
          />
        </View>
      ) : null}
    </RaidexModal>
  );
}

function RenewModal({ c, sub, onClose }: any) {
  const router = useRouter();
  const [quote, setQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Renewal is a new billing cycle and must be paid for - quote it, then
    // route through the same payment flow as everything else (never a free,
    // unpaid extension).
    let cancelled = false;
    (async () => {
      try {
        const q = await api<any>(`/subscriptions/${sub.subscription_id}/renew/quote?duration_months=${sub.duration_months}`);
        if (!cancelled) setQuote(q);
      } catch (e: any) {
        if (!cancelled) Alert.alert("Error", e.message);
      } finally {
        if (!cancelled) setLoadingQuote(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sub.subscription_id, sub.duration_months]);

  const payAndRenew = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: {
          subscription_id: sub.subscription_id, amount: quote.total_price,
          purpose: "subscription_renewal", renewal_duration_months: quote.duration_months,
          idempotency_key: `sub_renew_${sub.subscription_id}_${Date.now()}`,
        },
      });
      onClose();
      router.push(`/pay/${payment.payment_id}` as any);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RaidexModal
      visible
      onDismiss={onClose}
      title={`Renew ${sub.vehicle_snapshot?.name}`}
      subtitle="Renews at your locked-in plan rate — same monthly price, no surprise increase."
      primaryLabel="Pay & Renew"
      onPrimary={payAndRenew}
      primaryBusy={busy}
      primaryDisabled={busy || !quote}
      primaryTestID={`renew-confirm-btn-${sub.subscription_id}`}
      testID="renew-modal"
    >
      {loadingQuote ? (
        <ActivityIndicator color={c.accent} />
      ) : quote ? (
        <RaidexPriceCard
          testID={`renew-total-${sub.subscription_id}`}
          totalLabel="Total due now"
          total={`₹${quote.total_price.toLocaleString()}`}
          lines={[
            { label: `Monthly price × ${quote.duration_months} mo`, value: `₹${quote.monthly_price.toLocaleString()}` },
          ]}
        />
      ) : null}
    </RaidexModal>
  );
}

function CancelModal({ c, sub, onDismiss, onConfirm }: any) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) {
      Alert.alert("Reason required", "Please tell us why you're cancelling.");
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
      onDismiss={onDismiss}
      title="Cancel subscription"
      subtitle={`${sub.vehicle_snapshot?.name} · Tell us why you're cancelling.`}
      dismissLabel="Keep subscription"
      dismissTestID="cancel-dismiss-btn"
      primaryLabel="Confirm cancel"
      onPrimary={submit}
      primaryBusy={busy}
      primaryVariant="destructive"
      primaryTestID="cancel-confirm-btn"
      testID="cancel-modal"
    >
      <RaidexInput
        testID="cancel-reason-input"
        value={reason}
        onChangeText={setReason}
        placeholder="Reason for cancellation"
        multiline
        numberOfLines={3}
      />
    </RaidexModal>
  );
}

const styles = StyleSheet.create({
  smallBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: tokens.radius.md },
  progressTrack: { height: 6, borderRadius: tokens.radius.pill, marginTop: 6, overflow: "hidden" },
  warnRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: tokens.radius.md, padding: 10, marginTop: 10 },
  actionBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: tokens.radius.md },
  lbl: { fontSize: 12, fontWeight: tokens.weight.medium, marginBottom: 6 },
});
