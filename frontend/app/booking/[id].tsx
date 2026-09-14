import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withSpring, Easing } from "react-native-reanimated";
import { addDays, isSameDay, startOfDay } from "date-fns";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexBadge, RaidexButton, RaidexCard, RaidexChip, RaidexErrorState, RaidexPriceCard } from "@/src/components/ui";
import { MIN_BOOKING_LEAD_HOURS, QuickDatePicker, TimeSlotPicker, mergeDateAndTime, slotLabel } from "@/src/components/ScheduleCalendar";

type Plan = "hourly" | "daily" | "weekly" | "monthly";
const PLANS: { key: Plan; label: string; sub: string }[] = [
  { key: "hourly", label: "Hourly", sub: "Min 1 hour" },
  { key: "daily", label: "Daily", sub: "Most popular" },
  { key: "weekly", label: "Weekly", sub: "Save 10%" },
  { key: "monthly", label: "Monthly", sub: "Subscription" },
];

function fmtDate(d: Date | null) { return d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "Select date"; }
function fmtTime(time: string | null) { return time ? slotLabel(time) : "Select time"; }

// How many days out the *default* return date lands, per plan, once a
// pickup date is (re)picked - mirrors the old duration-stepper defaults
// (hourly: 4h, daily: 2d, weekly: 2w, monthly: 1mo) but now anchored to the
// real pickup date instead of `new Date()`.
function defaultReturnDate(pickupDate: Date, plan: Plan): Date {
  if (plan === "hourly") return pickupDate; // same-day return; the return TIME carries the length
  if (plan === "daily") return addDays(pickupDate, 2);
  if (plan === "weekly") return addDays(pickupDate, 14);
  return addDays(pickupDate, 30);
}

// The minimum-duration-per-plan rule the old stepper enforced ("Min 1 hour",
// etc.) - expressed here as the earliest selectable return date relative to
// the real pickup date, so the calendar/quick-strip can disable the rest.
function minReturnDate(pickupDate: Date, plan: Plan): Date {
  if (plan === "hourly") return pickupDate;
  if (plan === "daily") return addDays(pickupDate, 1);
  if (plan === "weekly") return addDays(pickupDate, 7);
  return addDays(pickupDate, 30);
}

// Duration (in plan units) derived from the real selected date range - this
// replaces the old free-floating duration counter as the input to pricing.
function unitsBetween(start: Date, end: Date, plan: Plan): number {
  const diffMs = end.getTime() - start.getTime();
  if (plan === "hourly") return Math.max(1, Math.round(diffMs / 3_600_000));
  if (plan === "daily") return Math.max(1, Math.round(diffMs / 86_400_000));
  if (plan === "weekly") return Math.max(1, Math.round(diffMs / (86_400_000 * 7)));
  return Math.max(1, Math.round(diffMs / (86_400_000 * 30)));
}

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [v, setV] = useState<any>(null);
  const [plan, setPlan] = useState<Plan>("daily");
  const [addOns, setAddOns] = useState<{ helmet: boolean; insurance: boolean; delivery: boolean }>({ helmet: false, insurance: true, delivery: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const [pickupDate, setPickupDate] = useState<Date>(today);
  const [pickupTime, setPickupTime] = useState<string | null>(null);
  const [returnDate, setReturnDate] = useState<Date>(() => defaultReturnDate(today, "daily"));
  const [returnTime, setReturnTime] = useState<string | null>(null);

  const [availability, setAvailability] = useState<{ checking: boolean; available: boolean | null; conflict: any }>({
    checking: false, available: null, conflict: null,
  });

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

  // Whenever the pickup date moves, re-derive a sensible return-date default
  // and clear both times - a new pickup day can have different bookable
  // slots (lead-time cutoff only applies to "today"), and any previously
  // chosen return time may no longer make sense for the new pickup day.
  useEffect(() => {
    setReturnDate(defaultReturnDate(pickupDate, plan));
    setPickupTime(null);
    setReturnTime(null);
    // Deliberately only reacts to pickupDate - plan changes are handled by
    // the effect below so switching plans doesn't force re-picking pickup time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupDate]);

  // Changing the pricing plan changes the minimum-duration rule, so recompute
  // the return-date default (keeps the "plan drives a default length"
  // concept from the old stepper) and clear the return time.
  useEffect(() => {
    setReturnDate(defaultReturnDate(pickupDate, plan));
    setReturnTime(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // If pickup time moves later and invalidates an already-picked same-day
  // return time, clear it rather than silently booking an invalid range.
  useEffect(() => {
    if (!pickupTime || !returnTime) return;
    if (!isSameDay(pickupDate, returnDate)) return;
    if (Number(returnTime.split(":")[0]) <= Number(pickupTime.split(":")[0])) setReturnTime(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupTime]);

  const start = useMemo(() => (pickupTime ? mergeDateAndTime(pickupDate, pickupTime) : null), [pickupDate, pickupTime]);
  const end = useMemo(() => (returnTime ? mergeDateAndTime(returnDate, returnTime) : null), [returnDate, returnTime]);

  const duration = useMemo(() => (start && end && end > start ? unitsBetween(start, end, plan) : null), [start, end, plan]);

  // Real-time conflict check against GET /vehicles/{id}/availability - this
  // is defense in depth for the UI only; POST /bookings' own transactional
  // conflict check (backend/features/booking/service.py) remains the source
  // of truth regardless of what this says.
  useEffect(() => {
    if (!start || !end || end <= start) {
      setAvailability({ checking: false, available: null, conflict: null });
      return;
    }
    let cancelled = false;
    setAvailability((a) => ({ ...a, checking: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await api<any>(
          `/vehicles/${id}/availability?start_date=${encodeURIComponent(start.toISOString())}&end_date=${encodeURIComponent(end.toISOString())}`
        );
        if (!cancelled) setAvailability({ checking: false, available: !!res.available, conflict: res.conflict ?? null });
      } catch {
        // Network/other failure - don't block booking on this alone, the
        // server-side check on POST /bookings is still authoritative.
        if (!cancelled) setAvailability({ checking: false, available: null, conflict: null });
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, start?.getTime(), end?.getTime()]);

  const localBase = useMemo(() => {
    if (!v || duration == null) return 0;
    if (plan === "hourly") return v.price_per_hour * duration;
    if (plan === "daily") return v.price_per_day * duration;
    // Weekly/monthly rates aren't guaranteed on every vehicle response - fall back
    // to the daily rate rather than silently producing NaN totals.
    if (plan === "weekly") return (v.price_per_week ?? v.price_per_day * 7) * duration;
    return (v.price_per_month ?? v.price_per_day * 30) * duration;
  }, [v, plan, duration]);

  type PricePreview = {
    rate_range: { min: number; max: number };
    calculated_hourly_rate: number;
    duration_factor: number;
    lead_time_factor: number;
    duration_hours: number;
    rental_subtotal: number;
    platform_fee: number;
    tax: number;
    security_deposit: number;
    total_payable: number;
    min_booking_hours: number;
    min_notice_hours: number;
    meets_minimum_duration: boolean;
    meets_minimum_notice: boolean;
  };
  // Real, server-computed price: the vehicle's admin-configured hourly rate
  // range, clamped by how long the trip is (longer = cheaper) and how much
  // notice was given (shorter notice = pricier) - see
  // backend/raidex_platform/pricing_engine.py's PricingEngine, the exact
  // same calculation POST /bookings itself charges from (BookingService.
  // price_estimate). Falls back to the plain local calc while the request
  // is in flight or if it fails - never blocks the flow on this alone.
  const [pricePreview, setPricePreview] = useState<PricePreview | null>(null);
  const [addOnsPricing, setAddOnsPricing] = useState<{ helmet: number; insurance: number; delivery: number }>({ helmet: 50, insurance: 199, delivery: 299 });
  useEffect(() => {
    api<any>("/config").then((cfg) => { if (cfg?.add_ons_pricing) setAddOnsPricing(cfg.add_ons_pricing); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!id || !start || !end || end <= start) { setPricePreview(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api<PricePreview>(
          `/vehicles/${id}/price-preview?plan=${plan}&start_date=${encodeURIComponent(start.toISOString())}&end_date=${encodeURIComponent(end.toISOString())}`
        );
        if (!cancelled) setPricePreview(res);
      } catch {
        if (!cancelled) setPricePreview(null);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, plan, start?.getTime(), end?.getTime()]);

  const base = pricePreview?.rental_subtotal ?? localBase;
  const durationReason = pricePreview && pricePreview.duration_factor > 0.15
    ? "Lower hourly rate for longer trips"
    : pricePreview && pricePreview.lead_time_factor < 0.15
    ? "Higher rate for last-minute pickup"
    : null;
  const invalidSelection = pricePreview && (!pricePreview.meets_minimum_duration || !pricePreview.meets_minimum_notice);
  const invalidSelectionMessage = !pricePreview
    ? null
    : !pricePreview.meets_minimum_duration
    ? `Minimum booking duration for this vehicle is ${pricePreview.min_booking_hours}h`
    : !pricePreview.meets_minimum_notice
    ? `Pickup must be at least ${pricePreview.min_notice_hours}h from now`
    : null;

  const addOnTotal = (addOns.helmet ? addOnsPricing.helmet : 0) + (addOns.insurance ? addOnsPricing.insurance : 0) + (addOns.delivery ? addOnsPricing.delivery : 0);
  const platformFee = pricePreview?.platform_fee ?? Math.max(99, Math.round(base * 0.10));
  const insurance = addOns.insurance ? addOnsPricing.insurance : 0;
  const tax = pricePreview?.tax ?? Math.round((base + platformFee + addOnTotal) * 0.18);
  const total = base + platformFee + addOnTotal + tax;
  const finalTotal = total + (v?.deposit ?? 0);

  // A small "the number just moved" bounce every time the payable total
  // changes (plan/date-range/add-on edits) - makes the price feel responsive
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
    if (!start || !end || end <= start) {
      Alert.alert("Pick your dates", "Choose a pickup and return date & time first.");
      return;
    }
    if (availability.available === false) {
      Alert.alert("Not available", "This vehicle is already booked for the selected dates. Please choose a different range.");
      return;
    }
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
  const returnMinDate = minReturnDate(pickupDate, plan);
  const canBook = !!start && !!end && end > start && !busy && availability.available !== false && !invalidSelection;

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
              onPress={() => setPlan(p.key)}
            />
          ))}
        </View>
        <View style={{ marginTop: 8 }}>
          <RaidexBadge label={activePlan.sub.toUpperCase()} tone="neutral" />
        </View>

        <Text style={[styles.h, { color: c.onSurface }]}>Pickup</Text>
        <QuickDatePicker c={c} label="Pickup date" selectedDate={pickupDate} minDate={today} onSelect={setPickupDate} testIDPrefix="pickup-date" />
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Pickup time</Text>
          <TimeSlotPicker
            c={c}
            selected={pickupTime}
            onSelect={setPickupTime}
            testIDPrefix="pickup-time"
            emptyLabel={`No slots left today - pick tomorrow (${MIN_BOOKING_LEAD_HOURS}h notice required)`}
            isDisabled={(hour) => {
              if (!isSameDay(pickupDate, today)) return false;
              const cutoff = new Date(Date.now() + MIN_BOOKING_LEAD_HOURS * 3_600_000);
              return mergeDateAndTime(pickupDate, `${String(hour).padStart(2, "0")}:00`) < cutoff;
            }}
          />
        </View>

        <Text style={[styles.h, { color: c.onSurface }]}>Return</Text>
        <QuickDatePicker c={c} label="Return date" selectedDate={returnDate} minDate={returnMinDate} onSelect={(d) => { setReturnDate(d); setReturnTime(null); }} testIDPrefix="return-date" />
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Return time</Text>
          <TimeSlotPicker
            c={c}
            selected={returnTime}
            onSelect={setReturnTime}
            testIDPrefix="return-time"
            emptyLabel={!pickupTime ? "Pick a pickup time first" : "No slots available"}
            isDisabled={(hour) => {
              if (!pickupTime) return true;
              if (!isSameDay(pickupDate, returnDate)) return false;
              return hour <= Number(pickupTime.split(":")[0]);
            }}
          />
        </View>

        <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", marginTop: 20, gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface3, fontSize: 11 }}>PICKUP</Text>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, marginTop: 2 }}>{fmtDate(start)}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 1 }}>{fmtTime(pickupTime)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={c.onSurface3} />
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={{ color: c.onSurface3, fontSize: 11 }}>RETURN</Text>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, marginTop: 2 }}>{fmtDate(end)}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 1 }}>{fmtTime(returnTime)}</Text>
          </View>
        </RaidexCard>

        {availability.checking && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
            <ActivityIndicator size="small" color={c.onSurface3} />
            <Text style={{ color: c.onSurface3, fontSize: 12 }}>Checking availability for these dates...</Text>
          </View>
        )}
        {availability.available === false && (
          <View testID="availability-conflict-banner" style={[styles.conflictBanner, { backgroundColor: c.error + "1A", borderColor: c.error }]}>
            <Ionicons name="alert-circle" size={18} color={c.error} />
            <Text style={{ color: c.onSurface, fontSize: 12.5, flex: 1, lineHeight: 18 }}>
              {availability.conflict
                ? `This vehicle is already booked from ${fmtDate(new Date(availability.conflict.start_date))} to ${fmtDate(new Date(availability.conflict.end_date))}. Please choose different dates.`
                : "This vehicle is not available for the selected dates. Please choose a different range."}
            </Text>
          </View>
        )}

        <Text style={[styles.h, { color: c.onSurface }]}>Add-ons</Text>
        <AddOnRow c={c} label="Helmet (bike)" price={addOnsPricing.helmet} value={addOns.helmet} onChange={(v: boolean) => setAddOns({ ...addOns, helmet: v })} testID="addon-helmet" />
        <AddOnRow c={c} label="Zero damage insurance" price={addOnsPricing.insurance} value={addOns.insurance} onChange={(v: boolean) => setAddOns({ ...addOns, insurance: v })} testID="addon-insurance" />
        <AddOnRow c={c} label="Door delivery" price={addOnsPricing.delivery} value={addOns.delivery} onChange={(v: boolean) => setAddOns({ ...addOns, delivery: v })} testID="addon-delivery" />

        <Text style={[styles.h, { color: c.onSurface }]}>Price breakdown</Text>
        {pricePreview && !invalidSelection && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: c.surface2 }}>
            <Ionicons name="pulse" size={16} color={c.accent} />
            <Text style={{ color: c.onSurface2, fontSize: 12, flex: 1, lineHeight: 17 }}>
              ₹{pricePreview.calculated_hourly_rate}/hr (range ₹{pricePreview.rate_range.min}–₹{pricePreview.rate_range.max})
              {durationReason ? ` · ${durationReason}` : ""}
            </Text>
          </View>
        )}
        {invalidSelectionMessage && (
          <View testID="min-duration-warning" style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: c.error + "1A" }}>
            <Ionicons name="alert-circle" size={16} color={c.error} />
            <Text style={{ color: c.onSurface, fontSize: 12, flex: 1, lineHeight: 17 }}>{invalidSelectionMessage}</Text>
          </View>
        )}
        <Animated.View style={priceAnimatedStyle}>
          <RaidexPriceCard
            testID="total-amount"
            totalLabel="Final payable"
            total={`INR ${finalTotal.toLocaleString()}`}
            lines={[
              { label: `Rental - ${plan}${duration != null ? ` × ${duration}` : ""}`, value: `INR ${base.toLocaleString()}` },
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
          label={canBook ? `Confirm & Pay  ·  ₹${total.toLocaleString()}` : "Select pickup & return"}
          icon="lock-closed"
          iconPosition="trailing"
          loading={busy}
          disabled={!canBook}
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
  addRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  conflictBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1 },
});
