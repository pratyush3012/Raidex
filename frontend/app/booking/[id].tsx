import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withSpring, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexBadge, RaidexButton, RaidexCard, RaidexChip, RaidexErrorState, RaidexPriceCard } from "@/src/components/ui";

type Plan = "hourly" | "daily" | "weekly" | "monthly";
const PLANS: { key: Plan; label: string; sub: string }[] = [
  { key: "hourly", label: "Hourly", sub: "Min 1 hour" },
  { key: "daily", label: "Daily", sub: "Most popular" },
  { key: "weekly", label: "Weekly", sub: "Save 10%" },
  { key: "monthly", label: "Monthly", sub: "Subscription" },
];

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmt(d: Date) { return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [v, setV] = useState<any>(null);
  const [plan, setPlan] = useState<Plan>("daily");
  const [duration, setDuration] = useState(2);
  const [addOns, setAddOns] = useState<{ helmet: boolean; insurance: boolean; delivery: boolean }>({ helmet: false, insurance: true, delivery: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setV(await api(`/vehicles/${id}`));
    } catch (e: any) {
      setError(e.message || "Could not load booking details");
      setV(null);
    }
  };

  useEffect(() => { load(); }, [id]);

  const start = useMemo(() => new Date(), []);
  const end = useMemo(() => {
    if (plan === "hourly") { const e = new Date(start); e.setHours(e.getHours() + duration); return e; }
    if (plan === "daily") return addDays(start, duration);
    if (plan === "weekly") return addDays(start, duration * 7);
    return addDays(start, duration * 30);
  }, [plan, duration, start]);

  const base = useMemo(() => {
    if (!v) return 0;
    if (plan === "hourly") return v.price_per_hour * duration;
    if (plan === "daily") return v.price_per_day * duration;
    // Weekly/monthly rates aren't guaranteed on every vehicle response - fall back
    // to the daily rate rather than silently producing NaN totals.
    if (plan === "weekly") return (v.price_per_week ?? v.price_per_day * 7) * duration;
    return (v.price_per_month ?? v.price_per_day * 30) * duration;
  }, [v, plan, duration]);

  const addOnTotal = (addOns.helmet ? 50 : 0) + (addOns.insurance ? 199 : 0) + (addOns.delivery ? 299 : 0);
  const platformFee = Math.max(99, Math.round(base * 0.04));
  const insurance = addOns.insurance ? 199 : 0;
  const tax = Math.round((base + platformFee + addOnTotal) * 0.18);
  const total = base + platformFee + addOnTotal + tax;
  const finalTotal = total + (v?.deposit ?? 0);

  // A small "the number just moved" bounce every time the payable total
  // changes (plan/duration/add-on edits) - makes the price feel responsive
  // rather than a static recalculated label.
  const priceScale = useSharedValue(1);
  useEffect(() => {
    priceScale.value = withSequence(
      withTiming(0.96, { duration: tokens.motion.quick, easing: Easing.out(Easing.quad) }),
      withSpring(1, tokens.motion.springSnappy)
    );
  }, [finalTotal]);
  const priceAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: priceScale.value }] }));

  // Subtle entrance for the footer CTA once vehicle details have actually
  // loaded, matching the reveal used on the vehicle detail screen.
  const footerReveal = useSharedValue(0);
  useEffect(() => {
    if (v) {
      footerReveal.value = 0;
      footerReveal.value = withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
    }
  }, [v]);
  const footerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: footerReveal.value,
    transform: [{ translateY: (1 - footerReveal.value) * 16 }],
  }));

  const book = async () => {
    setBusy(true);
    try {
      const res = await api<any>("/bookings", {
        method: "POST",
        body: {
          vehicle_id: id,
          plan,
          start_date: start.toISOString(),
          end_date: end.toISOString(),
          add_ons: Object.entries(addOns).filter(([_, v]) => v).map(([k]) => k),
        },
      });
      // Navigate to checkout for payment
      router.replace(`/checkout/${res.booking_id}` as any);
    } catch (e: any) {
      Alert.alert("Booking failed", e.message || "Try again");
    } finally {
      setBusy(false);
    }
  };

  if (!v) return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {error ? (
        <RaidexErrorState testID="booking-error-state" title="Could not load booking details" message={error} onRetry={load} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={c.accent} size="large" /></View>
      )}
    </View>
  );

  const activePlan = PLANS.find((p) => p.key === plan)!;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg, gap: 12 }}>
          <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold }}>Confirm booking</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: 200 }}>
        <RaidexCard variant="flat" style={{ flexDirection: "row", gap: 12 }}>
          <Image source={v.image} style={styles.thumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16 }}>{v.name}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.location}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
              <Ionicons name="star" size={12} color="#F59E0B" /><Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 12 }}>{v.rating.toFixed(1)}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 11 }}>· {v.trips} trips</Text>
            </View>
          </View>
        </RaidexCard>

        <Text style={[styles.h, { color: c.onSurface }]}>Choose plan</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {PLANS.map((p) => (
            <RaidexChip
              key={p.key}
              testID={`plan-${p.key}`}
              label={p.label}
              active={plan === p.key}
              onPress={() => { setPlan(p.key); setDuration(p.key === "hourly" ? 4 : p.key === "monthly" ? 1 : 2); }}
            />
          ))}
        </View>
        <View style={{ marginTop: 8 }}>
          <RaidexBadge label={activePlan.sub.toUpperCase()} tone="neutral" />
        </View>

        <Text style={[styles.h, { color: c.onSurface }]}>Duration</Text>
        <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable testID="dur-minus" onPress={() => setDuration(Math.max(1, duration - 1))} style={[styles.stepBtn, { backgroundColor: c.surface }]}><Ionicons name="remove" size={20} color={c.onSurface} /></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: c.onSurface, fontSize: 28, fontWeight: tokens.weight.bold }}>{duration}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11 }}>{plan === "hourly" ? "hour(s)" : plan === "daily" ? "day(s)" : plan === "weekly" ? "week(s)" : "month(s)"}</Text>
          </View>
          <Pressable testID="dur-plus" onPress={() => setDuration(duration + 1)} style={[styles.stepBtn, { backgroundColor: c.surface }]}><Ionicons name="add" size={20} color={c.onSurface} /></Pressable>
        </RaidexCard>

        <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", marginTop: 12, gap: 12 }}>
          <View style={{ flex: 1 }}><Text style={{ color: c.onSurface3, fontSize: 11 }}>PICKUP</Text><Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, marginTop: 2 }}>{fmt(start)}</Text></View>
          <Ionicons name="arrow-forward" size={18} color={c.onSurface3} />
          <View style={{ flex: 1, alignItems: "flex-end" }}><Text style={{ color: c.onSurface3, fontSize: 11 }}>RETURN</Text><Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, marginTop: 2 }}>{fmt(end)}</Text></View>
        </RaidexCard>

        <Text style={[styles.h, { color: c.onSurface }]}>Dynamic pricing calendar</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => {
            const best = day === "Tue" || day === "Wed" || day === "Thu";
            return (
              <View key={day} style={[styles.dayCell, { backgroundColor: best ? c.accentBg : c.surface2, borderColor: best ? c.accent : c.border }]}>
                <Text style={{ color: best ? c.onAccentBg : c.onSurface, fontWeight: tokens.weight.bold, fontSize: 12 }}>{day}</Text>
                <Text style={{ color: best ? c.onAccentBg : c.onSurface3, fontSize: 10 }}>{best ? "Best" : "Std"}</Text>
              </View>
            );
          })}
        </View>

        <Text style={[styles.h, { color: c.onSurface }]}>Add-ons</Text>
        <AddOnRow c={c} label="Helmet (bike)" price={50} value={addOns.helmet} onChange={(v: boolean) => setAddOns({ ...addOns, helmet: v })} testID="addon-helmet" />
        <AddOnRow c={c} label="Zero damage insurance" price={199} value={addOns.insurance} onChange={(v: boolean) => setAddOns({ ...addOns, insurance: v })} testID="addon-insurance" />
        <AddOnRow c={c} label="Door delivery" price={299} value={addOns.delivery} onChange={(v: boolean) => setAddOns({ ...addOns, delivery: v })} testID="addon-delivery" />

        <Text style={[styles.h, { color: c.onSurface }]}>Price breakdown</Text>
        <Animated.View style={priceAnimatedStyle}>
          <RaidexPriceCard
            testID="total-amount"
            totalLabel="Final payable"
            total={`INR ${finalTotal.toLocaleString()}`}
            lines={[
              { label: `Base rent - ${plan}`, value: `INR ${base.toLocaleString()}` },
              { label: "Platform fee", value: `INR ${platformFee.toLocaleString()}` },
              { label: "Insurance", value: `INR ${insurance.toLocaleString()}` },
              { label: "Other add-ons", value: `INR ${(addOnTotal - insurance).toLocaleString()}` },
              { label: "Taxes (18%)", value: `INR ${tax.toLocaleString()}` },
              { label: "Refundable deposit", value: `INR ${v.deposit.toLocaleString()}`, muted: true },
            ]}
          />
        </Animated.View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: tokens.spacing.lg, padding: 12, borderRadius: 12, backgroundColor: c.accentBg }}>
          <Ionicons name="information-circle" size={16} color={c.onAccentBg} />
          <Text style={{ color: c.onAccentBg, fontSize: 12, flex: 1 }}>Test mode — payments are mocked for this MVP build.</Text>
        </View>
      </ScrollView>

      <Animated.View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }, footerAnimatedStyle]}>
        <RaidexButton
          testID="confirm-pay-btn"
          label={`Confirm & Pay  ·  ₹${total.toLocaleString()}`}
          icon="lock-closed"
          iconPosition="trailing"
          loading={busy}
          onPress={book}
        />
      </Animated.View>
    </View>
  );
}

function AddOnRow({ c, label, price, value, onChange, testID }: any) {
  return (
    <Pressable testID={testID} onPress={() => onChange(!value)} style={[styles.addRow, { backgroundColor: c.surface2, borderColor: value ? c.accent : c.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 14 }}>{label}</Text>
        <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>₹{price}</Text>
      </View>
      <View style={[styles.checkBox, { backgroundColor: value ? c.accent : "transparent", borderColor: value ? c.accent : c.border }]}>
        {value && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 80, height: 80, borderRadius: 12 },
  h: { fontSize: 16, fontWeight: tokens.weight.bold, marginTop: 24, marginBottom: 12 },
  stepBtn: { width: 44, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  dayCell: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  addRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1 },
});
