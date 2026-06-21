import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

type Method = "card" | "upi" | "wallet" | "netbanking";

export default function Checkout() {
  const { booking_id } = useLocalSearchParams<{ booking_id: string }>();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [b, setB] = useState<any>(null);
  const [method, setMethod] = useState<Method>("card");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setB(await api(`/bookings/${booking_id}`)); } catch {}
    })();
  }, [booking_id]);

  const pay = async () => {
    if (!b) return;
    const total = b.total_amount + b.deposit;
    setBusy(true);
    try {
      const payment = await api<any>("/payments/create", {
        method: "POST",
        body: { booking_id: b.booking_id, amount: total, purpose: "booking" },
      });
      router.replace(`/pay/${payment.payment_id}?method=${method}` as any);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!b) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}><ActivityIndicator color={c.accent} size="large" /></View>;

  const grandTotal = b.total_amount + b.deposit;
  const methods: { key: Method; label: string; sub: string; icon: any }[] = [
    { key: "card", label: "Credit / Debit card", sub: "Visa, Mastercard, Rupay", icon: "card" },
    { key: "upi", label: "UPI", sub: "Pay via GPay / PhonePe / Paytm", icon: "qr-code" },
    { key: "wallet", label: "Raidex Wallet", sub: "Use your wallet balance", icon: "wallet" },
    { key: "netbanking", label: "Net Banking", sub: "All major Indian banks", icon: "business" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg, gap: 12 }}>
          <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: "800" }}>Checkout</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: insets.bottom + 140 }}>
        <View style={[styles.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Image source={b.vehicle_snapshot.image} style={styles.thumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 }}>{b.vehicle_snapshot.name}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{b.vehicle_snapshot.location}</Text>
            <Text style={{ color: c.onSurface2, fontSize: 12, marginTop: 8 }}>
              {new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()}
            </Text>
          </View>
        </View>

        <Text style={[styles.h, { color: c.onSurface }]}>Payment method</Text>
        {methods.map((m) => (
          <Pressable key={m.key} testID={`method-${m.key}`} onPress={() => setMethod(m.key)} style={[styles.methodRow, { backgroundColor: c.surface2, borderColor: method === m.key ? c.accent : c.border }]}>
            <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={m.icon} size={20} color={c.onSurface} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: "700" }}>{m.label}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{m.sub}</Text>
            </View>
            <View style={[styles.radio, { borderColor: method === m.key ? c.accent : c.border }]}>
              {method === m.key && <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: c.accent }} />}
            </View>
          </Pressable>
        ))}

        <Text style={[styles.h, { color: c.onSurface }]}>Order summary</Text>
        <View style={[styles.breakdown, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Row c={c} label={`Booking · ${b.plan}`} val={`₹${b.total_amount.toLocaleString()}`} />
          <Row c={c} label="Refundable deposit" val={`₹${b.deposit.toLocaleString()}`} sub />
          <View style={{ height: 1, backgroundColor: c.border, marginVertical: 10 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 }}>Total payable</Text>
            <Text testID="checkout-total" style={{ color: c.onSurface, fontWeight: "800", fontSize: 20 }}>₹{grandTotal.toLocaleString()}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: tokens.spacing.lg, padding: 12, borderRadius: 12, backgroundColor: c.accentBg }}>
          <Ionicons name="shield-checkmark" size={16} color={c.onAccentBg} />
          <Text style={{ color: c.onAccentBg, fontSize: 12, flex: 1 }}>Secure mock checkout. Razorpay can be enabled by setting PAYMENT_PROVIDER=razorpay.</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }]}>
        <Pressable testID="proceed-pay-btn" disabled={busy} onPress={pay} style={[styles.payBtn, { backgroundColor: c.inverse, opacity: busy ? 0.7 : 1 }]}>
          {busy ? <ActivityIndicator color={c.onInverse} /> : (
            <>
              <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>Proceed to pay · ₹{grandTotal.toLocaleString()}</Text>
              <Ionicons name="lock-closed" size={16} color={c.onInverse} />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function Row({ c, label, val, sub }: any) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}><Text style={{ color: sub ? c.onSurface3 : c.onSurface2, fontSize: 13 }}>{label}</Text><Text style={{ color: sub ? c.onSurface3 : c.onSurface, fontSize: 13, fontWeight: "600" }}>{val}</Text></View>;
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  thumb: { width: 80, height: 80, borderRadius: 12 },
  h: { fontSize: 16, fontWeight: "800", marginTop: 24, marginBottom: 12 },
  methodRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  breakdown: { padding: 14, borderRadius: 16, borderWidth: 1 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, borderTopWidth: 1 },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 14 },
});
