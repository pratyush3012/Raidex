import React, { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { RazorpayCheckout } from "@/src/components/RazorpayCheckout";

type Phase = "loading" | "checkout" | "processing" | "success" | "failure";

const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "";

export default function PayScreen() {
  const { payment_id } = useLocalSearchParams<{ payment_id: string }>();
  const c = useTheme();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [payment, setPayment] = useState<any>(null);
  const [progress, setProgress] = useState(0);
  const mockStarted = useRef(false);

  const providerLabel = payment?.provider === "razorpay" ? "Razorpay" : "Mock Gateway";

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
            <View style={[styles.iconWrap, { backgroundColor: c.accent }]}>
              <Ionicons name="checkmark" size={56} color="#fff" />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 28, fontWeight: "800", marginTop: 28 }}>Payment successful</Text>
            <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>Your booking is confirmed.</Text>
            <View style={[styles.receipt, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <ReceiptRow label="Amount paid" val={`₹${payment?.amount?.toLocaleString()}`} c={c} bold />
              <ReceiptRow label="Payment ID" val={payment?.payment_id?.slice(0, 18) + "…"} c={c} />
              <ReceiptRow label="Method" val={providerLabel} c={c} />
              <ReceiptRow label="Status" val="Succeeded" c={c} accent />
            </View>
          </View>
          <Pressable testID="view-trip-btn" onPress={() => router.replace("/(tabs)/trips" as any)} style={[styles.cta, { backgroundColor: c.inverse }]}>
            <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>View my trip</Text>
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
          <View style={[styles.iconWrap, { backgroundColor: c.error }]}>
            <Ionicons name="close" size={56} color="#fff" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 26, fontWeight: "800", marginTop: 28 }}>Payment failed</Text>
          <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>{payment?.failure_reason || "Something went wrong."}</Text>
          <View style={[styles.receipt, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <ReceiptRow label="Amount" val={`₹${payment?.amount?.toLocaleString()}`} c={c} />
            <ReceiptRow label="Status" val="Failed" c={c} danger />
          </View>
        </View>
        <Pressable testID="retry-btn" onPress={() => router.replace(`/checkout/${payment?.booking_id}` as any)} style={[styles.cta, { backgroundColor: c.inverse }]}>
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
