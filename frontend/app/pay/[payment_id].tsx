import React, { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withSpring, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { RazorpayCheckout } from "@/src/components/RazorpayCheckout";

type Phase = "loading" | "checkout" | "processing" | "success" | "failure";

const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "";

export default function PayScreen() {
  const { payment_id, method } = useLocalSearchParams<{ payment_id: string; method?: "card" | "upi" | "netbanking" }>();
  const c = useTheme();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [payment, setPayment] = useState<any>(null);
  const [progress, setProgress] = useState(0);
  const mockStarted = useRef(false);

  // Signature-moment choreography: a scale+fade entrance on the success
  // checkmark, a small shake on the failure cross, plus a haptic pulse fired
  // exactly once per phase transition (guarded by the phase dependency array,
  // not a ref, so it can't double-fire on unrelated re-renders).
  const successScale = useSharedValue(0.5);
  const successReveal = useSharedValue(0);
  const failureShake = useSharedValue(0);
  const failureReveal = useSharedValue(0);

  useEffect(() => {
    if (phase === "success") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      successReveal.value = 0;
      successReveal.value = withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
      successScale.value = 0.5;
      successScale.value = withSequence(
        withTiming(1.15, { duration: tokens.motion.quick, easing: Easing.out(Easing.quad) }),
        withSpring(1, tokens.motion.springSnappy)
      );
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "failure") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      failureReveal.value = 0;
      failureReveal.value = withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
      failureShake.value = 0;
      failureShake.value = withSequence(
        withTiming(-8, { duration: 55 }),
        withTiming(8, { duration: 55 }),
        withTiming(-6, { duration: 55 }),
        withTiming(6, { duration: 55 }),
        withTiming(0, { duration: 55 })
      );
    }
  }, [phase]);

  const successIconStyle = useAnimatedStyle(() => ({ transform: [{ scale: successScale.value }] }));
  const successContentStyle = useAnimatedStyle(() => ({
    opacity: successReveal.value,
    transform: [{ translateY: (1 - successReveal.value) * 12 }],
  }));
  const failureIconStyle = useAnimatedStyle(() => ({ transform: [{ translateX: failureShake.value }] }));
  const failureContentStyle = useAnimatedStyle(() => ({
    opacity: failureReveal.value,
    transform: [{ translateY: (1 - failureReveal.value) * 12 }],
  }));

  const providerLabel = payment?.provider === "razorpay" ? "Razorpay" : "Mock Gateway";
  const isWalletTopup = payment?.purpose === "wallet_topup";
  const isSubscriptionRenewal = payment?.purpose === "subscription_renewal";
  const isSubscription = payment?.purpose === "subscription" || (!!payment?.subscription_id && !isSubscriptionRenewal);

  const confirmPayment = useCallback(
    async (body: Record<string, string> = {}) => {
      setPhase("processing");
      const res = await api<any>(`/payments/${payment_id}/confirm`, {
        method: "POST",
        body,
      });
      setPayment(res);
      await refresh();
      setPhase(res.status === "succeeded" ? "success" : "failure");
      return res;
    },
    [payment_id, refresh]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api<any>(`/payments/${payment_id}`);
        if (cancelled) return;
        setPayment(p);

        if (p.provider === "razorpay") {
          if (!RAZORPAY_KEY) {
            setPayment({ ...p, status: "failed", failure_reason: "Razorpay key not configured in app build" });
            setPhase("failure");
            return;
          }
          setPhase("checkout");
          return;
        }

        // Mock gateway — auto-confirm (dev / test)
        if (mockStarted.current) return;
        mockStarted.current = true;
        setPhase("processing");
      } catch {
        if (!cancelled) {
          setPayment({ status: "failed", failure_reason: "Could not load payment" });
          setPhase("failure");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [payment_id]);

  useEffect(() => {
    if (phase !== "processing" || payment?.provider === "razorpay") return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (!cancelled) setProgress((p) => Math.min(95, p + 7));
    }, 120);
    (async () => {
      try {
        const res = await confirmPayment({});
        if (!cancelled) setProgress(100);
        if (!cancelled && res.status !== "succeeded") {
          /* phase set in confirmPayment */
        }
      } catch {
        if (!cancelled) {
          setPayment((prev: any) => ({ ...prev, status: "failed", failure_reason: "Network error" }));
          setPhase("failure");
        }
      }
    })();
    return () => { cancelled = true; clearInterval(interval); };
  }, [phase, payment?.provider, confirmPayment]);

  if (phase === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.accent} size="large" />
      </View>
    );
  }

  if (phase === "checkout" && payment?.provider === "razorpay") {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface, padding: 16 }}>
          <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "800" }}>Secure payment</Text>
          <Text style={{ color: c.onSurface3, marginTop: 4 }}>₹{payment.amount?.toLocaleString()} · Razorpay</Text>
        </SafeAreaView>
        <RazorpayCheckout
          keyId={RAZORPAY_KEY}
          orderId={payment.provider_order_id}
          amountInr={payment.amount}
          name={user?.name || "Raidex User"}
          email={user?.email || ""}
          method={method}
          onSuccess={async (result) => {
            try {
              await confirmPayment({
                razorpay_payment_id: result.razorpay_payment_id,
                razorpay_order_id: result.razorpay_order_id,
                razorpay_signature: result.razorpay_signature,
              });
            } catch {
              setPayment({ ...payment, status: "failed", failure_reason: "Could not verify payment" });
              setPhase("failure");
            }
          }}
          onFailure={(reason) => {
            setPayment({ ...payment, status: "failed", failure_reason: reason });
            setPhase("failure");
          }}
        />
      </View>
    );
  }

  if (phase === "processing") {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <View style={[styles.iconWrap, { backgroundColor: c.surface2 }]}>
            <ActivityIndicator color={c.accent} size="large" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 24, fontWeight: "800", marginTop: 28 }}>Processing payment…</Text>
          <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>Please don't close this screen.</Text>
          <View style={{ width: 240, height: 6, backgroundColor: c.surface3, borderRadius: 999, marginTop: 28, overflow: "hidden" }}>
            <View style={{ width: `${progress}%`, height: "100%", backgroundColor: c.accent }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 32 }}>
            <Ionicons name="lock-closed" size={12} color={c.onSurface3} />
            <Text style={{ color: c.onSurface3, fontSize: 11 }}>Secured by Raidex · {providerLabel}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (phase === "success") {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <LinearGradient colors={[c.accentBg, c.surface]} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 360 }} />
        <SafeAreaView style={{ flex: 1, padding: 32 }}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={[styles.iconWrap, { backgroundColor: c.accent }, successIconStyle]}>
              <Ionicons name="checkmark" size={56} color="#fff" />
            </Animated.View>
            <Animated.View style={[{ alignItems: "center" }, successContentStyle]}>
              <Text style={{ color: c.onSurface, fontSize: 28, fontWeight: "800", marginTop: 28 }}>Payment successful</Text>
              <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>
                {isWalletTopup ? "Your wallet has been topped up." : isSubscriptionRenewal ? "Your subscription has been renewed." : isSubscription ? "Your subscription is now active." : "Your booking is confirmed."}
              </Text>
              <View style={[styles.receipt, { backgroundColor: c.surface2, borderColor: c.border }]}>
                <ReceiptRow label="Amount paid" val={`₹${payment?.amount?.toLocaleString()}`} c={c} bold />
                <ReceiptRow label="Payment ID" val={payment?.payment_id?.slice(0, 18) + "…"} c={c} />
                <ReceiptRow label="Method" val={providerLabel} c={c} />
                <ReceiptRow label="Status" val="Succeeded" c={c} accent />
              </View>
            </Animated.View>
          </View>
          <Pressable
            testID="view-trip-btn"
            onPress={() => router.replace((isWalletTopup ? "/(tabs)/profile" : (isSubscription || isSubscriptionRenewal) ? "/subscriptions" : "/(tabs)/trips") as any)}
            style={[styles.cta, { backgroundColor: c.inverse }]}
          >
            <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>
              {isWalletTopup ? "Back to profile" : (isSubscription || isSubscriptionRenewal) ? "View my subscription" : "View my trip"}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={c.onInverse} />
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView style={{ flex: 1, padding: 32 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={[styles.iconWrap, { backgroundColor: c.error }, failureIconStyle]}>
            <Ionicons name="close" size={56} color="#fff" />
          </Animated.View>
          <Animated.View style={[{ alignItems: "center" }, failureContentStyle]}>
            <Text style={{ color: c.onSurface, fontSize: 26, fontWeight: "800", marginTop: 28 }}>Payment failed</Text>
            <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>{payment?.failure_reason || "Something went wrong."}</Text>
            <View style={[styles.receipt, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <ReceiptRow label="Amount" val={`₹${payment?.amount?.toLocaleString()}`} c={c} />
              <ReceiptRow label="Status" val="Failed" c={c} danger />
            </View>
          </Animated.View>
        </View>
        <Pressable
          testID="retry-btn"
          onPress={() => router.replace(payment?.booking_id ? `/checkout/${payment.booking_id}` : "/(tabs)/profile" as any)}
          style={[styles.cta, { backgroundColor: c.inverse }]}
        >
          <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>Try again</Text>
        </Pressable>
        <Pressable testID="cancel-btn" onPress={() => router.replace("/(tabs)" as any)} style={[styles.cta, { backgroundColor: c.surface2, marginTop: 8 }]}>
          <Text style={{ color: c.onSurface, fontWeight: "700" }}>Back to explore</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

function ReceiptRow({ label, val, c, bold, accent, danger }: any) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
      <Text style={{ color: c.onSurface3, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: danger ? c.error : accent ? c.accent : c.onSurface, fontSize: bold ? 16 : 13, fontWeight: bold ? "800" : "600" }}>{val}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 110, height: 110, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  receipt: { width: "100%", padding: 16, borderRadius: 16, borderWidth: 1, marginTop: 28 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
});
