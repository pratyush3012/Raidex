import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

type Phase = "processing" | "success" | "failure";

export default function PayScreen() {
  const { payment_id } = useLocalSearchParams<{ payment_id: string }>();
  const c = useTheme();
  const router = useRouter();
  const { refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("processing");
  const [payment, setPayment] = useState<any>(null);
  const [progress, setProgress] = useState(0);
  const calledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (!cancelled) setProgress((p) => Math.min(95, p + 7));
    }, 120);
    (async () => {
      if (calledRef.current) return;
      calledRef.current = true;
      try {
        const res = await api<any>(`/payments/${payment_id}/confirm`, { method: "POST", body: {} });
        if (cancelled) return;
        setPayment(res);
        setProgress(100);
        await refresh();
        setTimeout(() => {
          if (!cancelled) setPhase(res.status === "succeeded" ? "success" : "failure");
        }, 350);
      } catch (e) {
        if (!cancelled) {
          setPayment({ status: "failed", failure_reason: "Network error" });
          setPhase("failure");
        }
      }
    })();
    return () => { cancelled = true; clearInterval(interval); };
  }, [payment_id, refresh]);

  if (phase === "processing") {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <View style={[styles.iconWrap, { backgroundColor: c.surface2 }]}>
            <ActivityIndicator color={c.accent} size="large" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 24, fontWeight: "800", marginTop: 28 }}>Processing payment…</Text>
          <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>Please don't close or refresh this screen.</Text>
          <View style={{ width: 240, height: 6, backgroundColor: c.surface3, borderRadius: 999, marginTop: 28, overflow: "hidden" }}>
            <View style={{ width: `${progress}%`, height: "100%", backgroundColor: c.accent }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 32 }}>
            <Ionicons name="lock-closed" size={12} color={c.onSurface3} />
            <Text style={{ color: c.onSurface3, fontSize: 11 }}>Secured by Raidex · Mock Gateway</Text>
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
            <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>Your booking is confirmed. Receipt sent to your email.</Text>
            <View style={[styles.receipt, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <ReceiptRow label="Amount paid" val={`₹${payment?.amount?.toLocaleString()}`} c={c} bold />
              <ReceiptRow label="Payment ID" val={payment?.payment_id?.slice(0, 18) + "…"} c={c} />
              <ReceiptRow label="Method" val="Mock Gateway" c={c} />
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

  // failure
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView style={{ flex: 1, padding: 32 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={[styles.iconWrap, { backgroundColor: c.error }]}>
            <Ionicons name="close" size={56} color="#fff" />
          </View>
          <Text style={{ color: c.onSurface, fontSize: 26, fontWeight: "800", marginTop: 28 }}>Payment failed</Text>
          <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>{payment?.failure_reason || "Something went wrong. No amount has been charged."}</Text>
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
