import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert, Platform } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

type Booking = {
  booking_id: string; status: string; plan: string; start_date: string; end_date: string;
  total_amount: number; vehicle_snapshot: { name: string; image: string; location: string; brand: string };
};

const STATUS_COLORS: any = {
  confirmed: { bg: "#E8F8F0", fg: "#037A42" },
  active: { bg: "#FEF3C7", fg: "#92400E" },
  completed: { bg: "#F4F4F5", fg: "#52525B" },
  cancelled: { bg: "#FEE2E2", fg: "#991B1B" },
};

export default function TripsScreen() {
  const c = useTheme();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"all" | "active" | "past">("all");

  const load = useCallback(async () => {
    try {
      const data = await api<Booking[]>("/bookings", { cache: true });
      setBookings(data);
    } catch (e) {
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = bookings.filter((b) => {
    if (tab === "all") return true;
    if (tab === "active") return b.status === "confirmed" || b.status === "active";
    return b.status === "completed" || b.status === "cancelled";
  });

  const onStart = (id: string) => router.push(`/inspection/${id}?phase=before` as any);
  const onEnd = (id: string) => router.push(`/inspection/${id}?phase=after` as any);
  const onResume = (id: string) => router.push(`/trip/${id}` as any);
  const cancelBooking = (id: string) => {
    Alert.alert("Cancel booking", "Cancel this booking? Refund due will be calculated by Raidex.", [
      { text: "Keep booking", style: "cancel" },
      {
        text: "Cancel",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/bookings/${id}/cancel`, { method: "POST", body: { reason: "Cancelled from app" } });
            load();
          } catch (e: any) {
            Alert.alert("Cancel failed", e.message || "Please try again.");
          }
        },
      },
    ]);
  };
  const showInvoice = async (id: string) => {
    try {
      const inv = await api<any>(`/bookings/${id}/invoice?gst=true`);
      Alert.alert("Invoice ready", `Invoice ${inv.invoice_id}\nTotal: ₹${inv.total.toLocaleString()}`);
    } catch (e: any) {
      Alert.alert("Invoice", e.message || "Could not create invoice.");
    }
  };
  const openDispute = (id: string) => {
    if (Platform.OS === "ios" && Alert.prompt) {
      Alert.prompt(
        "Raise dispute",
        "Describe the issue with this booking.",
        async (text) => {
          if (!text || text.trim().length < 10) return;
          try {
            await api(`/bookings/${id}/disputes`, { method: "POST", body: { booking_id: id, category: "other", message: text.trim() } });
            Alert.alert("Dispute opened", "Raidex support will review this booking.");
          } catch (e: any) {
            Alert.alert("Dispute failed", e.message || "Please try again.");
          }
        }
      );
      return;
    }
    Alert.alert("Dispute", "Open support chat and share your booking ID.", [
      { text: "Open support", onPress: () => router.push("/support" as any) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: "800" }}>My Trips</Text>
        </View>
        <View style={{ flexDirection: "row", paddingHorizontal: tokens.spacing.xl, gap: 8, paddingBottom: tokens.spacing.md }}>
          {(["all", "active", "past"] as const).map((t) => (
            <Pressable key={t} testID={`trips-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, { backgroundColor: tab === t ? c.inverse : c.surface2 }]}>
              <Text style={{ color: tab === t ? c.onInverse : c.onSurface, fontWeight: "700", textTransform: "capitalize" }}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.booking_id}
          contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: tokens.spacing.lg }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60 }}>
              <Ionicons name="car-outline" size={56} color={c.onSurface3} />
              <Text style={{ color: c.onSurface2, marginTop: 16, fontSize: 16, fontWeight: "600" }}>No trips yet</Text>
              <Text style={{ color: c.onSurface3, marginTop: 4 }}>Book a ride to see it here</Text>
              <Pressable testID="explore-btn" onPress={() => router.push("/(tabs)")} style={[styles.exploreBtn, { backgroundColor: c.inverse }]}>
                <Text style={{ color: c.onInverse, fontWeight: "700" }}>Explore Rides</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const sc = STATUS_COLORS[item.status] || STATUS_COLORS.confirmed;
            return (
              <View style={[styles.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Image source={item.vehicle_snapshot.image} style={styles.thumb} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: "700", flex: 1 }} numberOfLines={1}>{item.vehicle_snapshot.name}</Text>
                      <View style={{ backgroundColor: sc.bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                        <Text style={{ color: sc.fg, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>{item.status}</Text>
                      </View>
                    </View>
                    <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{item.vehicle_snapshot.location}</Text>
                    <Text style={{ color: c.onSurface2, fontSize: 13, marginTop: 8 }}>
                      {new Date(item.start_date).toLocaleDateString()} → {new Date(item.end_date).toLocaleDateString()}
                    </Text>
                    <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: "800", marginTop: 6 }}>₹{item.total_amount.toLocaleString()}</Text>
                  </View>
                </View>
                {item.status === "confirmed" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <Pressable testID={`start-trip-${item.booking_id}`} onPress={() => onStart(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.accent, flex: 1, marginTop: 0 }]}>
                      <Ionicons name="play" size={14} color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "700" }}>Start</Text>
                    </Pressable>
                    <Pressable testID={`cancel-booking-${item.booking_id}`} onPress={() => cancelBooking(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, flex: 1, marginTop: 0 }]}>
                      <Ionicons name="close" size={14} color={c.error} />
                      <Text style={{ color: c.error, fontWeight: "700" }}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
                {item.status === "active" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <Pressable testID={`resume-trip-${item.booking_id}`} onPress={() => onResume(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.accent, flex: 1 }]}>
                      <Ionicons name="navigate" size={14} color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "700" }}>Live trip</Text>
                    </Pressable>
                    <Pressable testID={`end-trip-${item.booking_id}`} onPress={() => onEnd(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.inverse, flex: 1 }]}>
                      <Ionicons name="stop" size={14} color={c.onInverse} />
                      <Text style={{ color: c.onInverse, fontWeight: "700" }}>End trip</Text>
                    </Pressable>
                  </View>
                )}
                {item.status === "completed" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <Pressable testID={`invoice-${item.booking_id}`} onPress={() => showInvoice(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.inverse, flex: 1, marginTop: 0 }]}>
                      <Ionicons name="receipt" size={14} color={c.onInverse} />
                      <Text style={{ color: c.onInverse, fontWeight: "700" }}>Invoice</Text>
                    </Pressable>
                    <Pressable testID={`dispute-${item.booking_id}`} onPress={() => openDispute(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, flex: 1, marginTop: 0 }]}>
                      <Ionicons name="flag" size={14} color={c.onSurface} />
                      <Text style={{ color: c.onSurface, fontWeight: "700" }}>Dispute</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  thumb: { width: 96, height: 96, borderRadius: 14 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
  exploreBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
});
