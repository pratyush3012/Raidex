import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withSpring, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexButton, RaidexCard, RaidexErrorState, RaidexInput, RaidexPriceCard } from "@/src/components/ui";

type Method = "card" | "upi" | "netbanking";

type AppliedCoupon = { code: string; valid: boolean; discount: number; payable: number };

export default function Checkout() {
  const { booking_id } = useLocalSearchParams<{ booking_id: string }>();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [b, setB] = useState<any>(null);
  const [method, setMethod] = useState<Method>("card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);

  const load = async () => {
    setError(null);
    try {
      setB(await api(`/bookings/${booking_id}`));
    } catch (e: any) {
      setError(e.message || "Could not load checkout");
      setB(null);
    }
  };

  useEffect(() => { load(); }, [booking_id]);

  // Subtle entrance for the footer CTA once the booking has loaded, matching
  // the reveal used on booking/vehicle-detail.
  const footerReveal = useSharedValue(0);
  useEffect(() => {
    if (b) {
      footerReveal.value = 0;
      footerReveal.value = withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
    }
  }, [b]);
  const footerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: footerReveal.value,
    transform: [{ translateY: (1 - footerReveal.value) * 16 }],
  }));

  // A small bounce on the total whenever the selected payment method changes
  // the summary card's presentation, keeping the "price just moved" language
  // consistent with the booking screen even though the total itself is fixed
  // per booking (method choice doesn't change the amount).
  const priceScale = useSharedValue(1);
  const pulsePrice = () => {
    priceScale.value = withSequence(
      withTiming(0.97, { duration: tokens.motion.quick, easing: Easing.out(Easing.quad) }),
      withSpring(1, tokens.motion.springSnappy)
    );
  };
  const priceAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: priceScale.value }] }));

  const selectMethod = (m: Method) => {
    Haptics.selectionAsync().catch(() => {});
    setMethod(m);
    pulsePrice();
  };

  const applyPromo = async () => {
    if (!b) return;
    const code = promoCode.trim();
    if (!code) return;
    setApplyingPromo(true);
    setPromoError(null);
    try {
      const rentalTotal = (b.total_payable ?? b.total_amount) + b.deposit;
      const result = await api<AppliedCoupon>("/coupons/validate", {
        method: "POST",
        body: { code, amount: rentalTotal },
      });
      setCoupon(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      setCoupon(null);
      setPromoError(e.message || "This code isn't valid");
    } finally {
      setApplyingPromo(false);
    }
  };

  const removePromo = () => {
    setCoupon(null);
    setPromoCode("");
    setPromoError(null);
  };

  const pay = async () => {
    if (!b) return;
    // total_payable is the real server-computed floor (rental + platform fee
    // + tax + add-ons, all priced by PricingEngine) - total_amount alone
    // (base rental only) is kept only as a fallback for bookings created
    // before that field existed.
    const bookingFloor = b.total_payable ?? b.total_amount;
    const total = bookingFloor + b.deposit;
    // A coupon discounts the combined rental + deposit charge shown on this
    // screen, but the backend's payments_create floor-check never lets a
    // "booking"-purpose payment settle below the booking's real payable total
    // (the deposit portion is refundable, the rest is not) - so clamp here
    // to match that real invariant instead of risking a 400 on pay.
    const payableAmount = coupon ? Math.max(coupon.payable, bookingFloor) : total;
    setBusy(true);
    try {
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: {
          booking_id: b.booking_id,
          amount: payableAmount,
          purpose: "booking",
          idempotency_key: `booking_${b.booking_id}_${payableAmount}${coupon ? `_${coupon.code}` : ""}`,
        },
      });
      router.replace(`/pay/${payment.payment_id}?method=${method}` as any);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!b) return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {error ? (
        <RaidexErrorState testID="checkout-error-state" title="Could not load checkout" message={error} onRetry={load} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={c.accent} size="large" /></View>
      )}
    </View>
  );

  const bookingFloor = b.total_payable ?? b.total_amount;
  const grandTotal = bookingFloor + b.deposit;
  // Same floor-check clamp as `pay()` above, kept in sync so the summary
  // never displays a payable total that pay() would then refuse to charge.
  const payableTotal = coupon ? Math.max(coupon.payable, bookingFloor) : grandTotal;
  const appliedDiscount = coupon ? grandTotal - payableTotal : 0;
  const methods: { key: Method; label: string; sub: string; icon: any }[] = [
    { key: "card", label: "Credit / Debit card", sub: "Visa, Mastercard, Rupay", icon: "card" },
    { key: "upi", label: "UPI", sub: "Pay via GPay / PhonePe / Paytm", icon: "qr-code" },
    { key: "netbanking", label: "Net Banking", sub: "All major Indian banks", icon: "business" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg, gap: 12 }}>
          <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold }}>Checkout</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: insets.bottom + 140 }}>
        <RaidexCard variant="flat" style={{ flexDirection: "row", gap: 12 }}>
          <Image source={b.vehicle_snapshot.image} style={styles.thumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16 }}>{b.vehicle_snapshot.name}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{b.vehicle_snapshot.location}</Text>
            <Text style={{ color: c.onSurface2, fontSize: 12, marginTop: 8 }}>
              {new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()}
            </Text>
          </View>
        </RaidexCard>

        <Text style={[styles.h, { color: c.onSurface }]}>Payment method</Text>
        {methods.map((m) => {
          const active = method === m.key;
          return (
            <Pressable key={m.key} testID={`method-${m.key}`} onPress={() => selectMethod(m.key)}>
              <RaidexCard
                variant="flat"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 8,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? c.accent : c.border,
                }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={m.icon} size={20} color={c.onSurface} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{m.label}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{m.sub}</Text>
                </View>
                <View style={[styles.radio, { borderColor: active ? c.accent : c.border }]}>
                  {active && <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: c.accent }} />}
                </View>
              </RaidexCard>
            </Pressable>
          );
        })}

        <Text style={[styles.h, { color: c.onSurface }]}>Promo code</Text>
        {coupon ? (
          <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="pricetag" size={18} color={c.onAccentBg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{coupon.code} applied</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>You saved ₹{appliedDiscount.toLocaleString()}</Text>
            </View>
            <Pressable testID="remove-promo-btn" onPress={removePromo}>
              <Text style={{ color: c.error, fontWeight: tokens.weight.semibold, fontSize: 13 }}>Remove</Text>
            </Pressable>
          </RaidexCard>
        ) : (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <RaidexInput
                testID="promo-code-input"
                placeholder="Enter promo code"
                autoCapitalize="characters"
                value={promoCode}
                error={promoError ?? undefined}
                onChangeText={(t) => { setPromoCode(t); if (promoError) setPromoError(null); }}
              />
            </View>
            <RaidexButton
              testID="apply-promo-btn"
              label="Apply"
              variant="secondary"
              fullWidth={false}
              loading={applyingPromo}
              disabled={!promoCode.trim()}
              onPress={applyPromo}
            />
          </View>
        )}

        <Text style={[styles.h, { color: c.onSurface }]}>Order summary</Text>
        <Animated.View style={priceAnimatedStyle}>
          <RaidexPriceCard
            testID="checkout-total"
            totalLabel="Total payable"
            total={`₹${payableTotal.toLocaleString()}`}
            lines={[
              { label: `Rental · ${b.plan}`, value: `₹${b.total_amount.toLocaleString()}` },
              ...(b.platform_fee ? [{ label: "Platform fee", value: `₹${b.platform_fee.toLocaleString()}` }] : []),
              ...(b.tax ? [{ label: "Taxes", value: `₹${b.tax.toLocaleString()}` }] : []),
              ...(b.add_on_total ? [{ label: "Add-ons", value: `₹${b.add_on_total.toLocaleString()}` }] : []),
              { label: "Refundable deposit", value: `₹${b.deposit.toLocaleString()}`, muted: true },
              ...(coupon ? [{ label: `Coupon · ${coupon.code}`, value: `-₹${appliedDiscount.toLocaleString()}` }] : []),
            ]}
          />
        </Animated.View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: tokens.spacing.lg, padding: 12, borderRadius: 12, backgroundColor: c.accentBg }}>
          <Ionicons name="shield-checkmark" size={16} color={c.onAccentBg} />
          <Text style={{ color: c.onAccentBg, fontSize: 12, flex: 1 }}>Payments secured via Razorpay. Test mode uses mock gateway when PAYMENT_PROVIDER=mock.</Text>
        </View>
      </ScrollView>

      <Animated.View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }, footerAnimatedStyle]}>
        <RaidexButton
          testID="proceed-pay-btn"
          label={`Proceed to pay · ₹${payableTotal.toLocaleString()}`}
          icon="lock-closed"
          iconPosition="trailing"
          loading={busy}
          onPress={pay}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 80, height: 80, borderRadius: 12 },
  h: { fontSize: 16, fontWeight: tokens.weight.bold, marginTop: 24, marginBottom: 12 },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1 },
});
