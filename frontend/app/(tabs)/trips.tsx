import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert, Platform } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { isBookingReviewed } from "@/src/features/reviews/reviewedStore";
import { RaidexCard, RaidexStatusPill, RaidexEmptyState } from "@/src/components/ui";

type Booking = {
  booking_id: string; status: string; plan: string; start_date: string; end_date: string;
  total_amount: number; vehicle_id: string; vehicle_snapshot: { name: string; image: string; location: string; brand: string };
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
  const onWriteReview = (b: Booking) => {
    router.push(
      `/review/${b.booking_id}?vehicle_id=${encodeURIComponent(b.vehicle_id)}&vehicle_name=${encodeURIComponent(b.vehicle_snapshot.name)}&vehicle_image=${encodeURIComponent(b.vehicle_snapshot.image)}` as any
    );
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
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: tokens.weight.bold }}>My Trips</Text>
        </View>
        <View style={{ flexDirection: "row", paddingHorizontal: tokens.spacing.xl, gap: 8, paddingBottom: tokens.spacing.md }}>
          {(["all", "active", "past"] as const).map((t) => (
            <Pressable key={t} testID={`trips-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, { backgroundColor: tab === t ? c.inverse : c.surface2 }]}>
              <Text style={{ color: tab === t ? c.onInverse : c.onSurface, fontWeight: tokens.weight.semibold, textTransform: "capitalize" }}>{t}</Text>
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
            <RaidexEmptyState
              icon="car-outline"
              title="No trips yet"
              subtitle="Book a ride to see it here"
              actionLabel="Explore Rides"
              onAction={() => router.push("/(tabs)")}
              testID="trips-empty"
            />
          }
          renderItem={({ item, index }) => (
            <TripCard
              item={item}
              index={index}
              c={c}
              onStart={onStart}
              onEnd={onEnd}
              onResume={onResume}
              cancelBooking={cancelBooking}
              showInvoice={showInvoice}
              onWriteReview={onWriteReview}
              openDispute={openDispute}
            />
          )}
        />
      )}
    </View>
  );
}

function TripCard({ item, index, c, onStart, onEnd, onResume, cancelBooking, showInvoice, onWriteReview, openDispute }: {
  item: Booking;
  index: number;
  c: any;
  onStart: (id: string) => void;
  onEnd: (id: string) => void;
  onResume: (id: string) => void;
  cancelBooking: (id: string) => void;
  showInvoice: (id: string) => void;
  onWriteReview: (b: Booking) => void;
  openDispute: (id: string) => void;
}) {
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = withDelay(Math.min(index, 6) * 40, withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) }));
  }, [appear, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 14 }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <RaidexCard variant="flat" padding={14}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Image source={item.vehicle_snapshot.image} style={styles.thumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: tokens.weight.semibold, flex: 1 }} numberOfLines={1}>{item.vehicle_snapshot.name}</Text>
              <RaidexStatusPill status={item.status} />
            </View>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{item.vehicle_snapshot.location}</Text>
            <Text style={{ color: c.onSurface2, fontSize: 13, marginTop: 8 }}>
              {new Date(item.start_date).toLocaleDateString()} → {new Date(item.end_date).toLocaleDateString()}
            </Text>
            <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: tokens.weight.black, marginTop: 6 }}>₹{item.total_amount.toLocaleString()}</Text>
          </View>
        </View>
        {item.status === "confirmed" && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable testID={`start-trip-${item.booking_id}`} onPress={() => onStart(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.accent, flex: 1, marginTop: 0 }]}>
              <Ionicons name="play" size={14} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: tokens.weight.semibold }}>Start</Text>
            </Pressable>
            <Pressable testID={`cancel-booking-${item.booking_id}`} onPress={() => cancelBooking(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, flex: 1, marginTop: 0 }]}>
              <Ionicons name="close" size={14} color={c.error} />
              <Text style={{ color: c.error, fontWeight: tokens.weight.semibold }}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {item.status === "active" && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable testID={`resume-trip-${item.booking_id}`} onPress={() => onResume(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.accent, flex: 1 }]}>
              <Ionicons name="navigate" size={14} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: tokens.weight.semibold }}>Live trip</Text>
            </Pressable>
            <Pressable testID={`end-trip-${item.booking_id}`} onPress={() => onEnd(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.inverse, flex: 1 }]}>
              <Ionicons name="stop" size={14} color={c.onInverse} />
              <Text style={{ color: c.onInverse, fontWeight: tokens.weight.semibold }}>End trip</Text>
            </Pressable>
          </View>
        )}
        {item.status === "completed" && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable testID={`invoice-${item.booking_id}`} onPress={() => showInvoice(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.inverse, flex: 1, marginTop: 0 }]}>
              <Ionicons name="receipt" size={14} color={c.onInverse} />
              <Text style={{ color: c.onInverse, fontWeight: tokens.weight.semibold }}>Invoice</Text>
            </Pressable>
            <Pressable testID={`dispute-${item.booking_id}`} onPress={() => openDispute(item.booking_id)} style={[styles.actionBtn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, flex: 1, marginTop: 0 }]}>
              <Ionicons name="flag" size={14} color={c.onSurface} />
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>Dispute</Text>
            </Pressable>
          </View>
        )}
        {item.status === "completed" && (
          isBookingReviewed(item.booking_id) ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
              <Ionicons name="checkmark-circle" size={14} color={c.accent} />
              <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: tokens.weight.semibold }}>You reviewed this trip</Text>
            </View>
          ) : (
            <Pressable testID={`write-review-${item.booking_id}`} onPress={() => onWriteReview(item)} style={[styles.actionBtn, { backgroundColor: c.warning, marginTop: 8 }]}>
              <Ionicons name="star" size={14} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: tokens.weight.semibold }}>Write a review</Text>
            </Pressable>
          )
        )}
      </RaidexCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  thumb: { width: 96, height: 96, borderRadius: 14 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
});
