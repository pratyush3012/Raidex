import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

const { width } = Dimensions.get("window");

export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [v, setV] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wished, setWished] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const vehicle = await api<any>(`/vehicles/${id}`);
      setV(vehicle);
      const [wishlist, reviewItems] = await Promise.all([
        api<any[]>("/wishlist").catch(() => []),
        api<any[]>(`/vehicles/${id}/reviews`).catch(() => []),
      ]);
      setWished(wishlist.some((it) => it.vehicle_id === id));
      setReviews(reviewItems);
    } catch (e: any) {
      setError(e.message || "Could not load vehicle");
      setV(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const toggleWishlist = async () => {
    if (!v) return;
    const next = !wished;
    setWished(next);
    try {
      await api(`/wishlist/${v.vehicle_id}`, { method: next ? "POST" : "DELETE" });
    } catch (e: any) {
      setWished(!next);
      Alert.alert("Wishlist", e.message || "Could not update wishlist.");
    }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={c.accent} size="large" /></View>;
  if (!v) return (
    <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", padding: 28 }}>
      <Ionicons name={error ? "cloud-offline-outline" : "car-outline"} size={54} color={c.onSurface3} />
      <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "800", marginTop: 14 }}>{error ? "Could not load vehicle" : "Vehicle not found"}</Text>
      <Text style={{ color: c.onSurface3, textAlign: "center", marginTop: 6 }}>{error || "This listing may no longer be available."}</Text>
      <Pressable onPress={load} style={[styles.retryBtn, { backgroundColor: c.inverse }]}>
        <Text style={{ color: c.onInverse, fontWeight: "800" }}>Retry</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={{ position: "relative" }}>
          <Image source={v.image} style={{ width: width, height: 360 }} contentFit="cover" />
          <LinearGradient colors={["rgba(0,0,0,0.35)", "transparent"]} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 120 }} />
          <SafeAreaView edges={["top"]} style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", padding: tokens.spacing.lg }}>
              <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable testID="wishlist-btn" onPress={toggleWishlist} style={styles.iconBtn}>
                  <Ionicons name={wished ? "heart" : "heart-outline"} size={20} color={wished ? "#EF4444" : "#fff"} />
                </Pressable>
                <Pressable testID="share-btn" onPress={() => Alert.alert("Share", `${v.name} is available on Raidex in ${v.location}.`)} style={styles.iconBtn}>
                  <Ionicons name="share-outline" size={20} color="#fff" />
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>

        <View style={{ padding: tokens.spacing.xl }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: "700" }}>{v.brand.toUpperCase()}</Text>
              <Text testID="vehicle-name" style={{ color: c.onSurface, fontSize: 28, fontWeight: "800", marginTop: 4 }}>{v.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                <Ionicons name="location" size={14} color={c.onSurface3} />
                <Text style={{ color: c.onSurface3, fontSize: 13 }}>{v.location} · {v.distance_km} km away</Text>
              </View>
            </View>
            <View style={[styles.ratingBox, { backgroundColor: c.surface2 }]}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={{ color: c.onSurface, fontWeight: "800" }}>{v.rating.toFixed(1)}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 11 }}>({v.trips})</Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginTop: 20 }}>
            <SpecCard c={c} icon="people" label="Seats" value={String(v.seats)} />
            <SpecCard c={c} icon="settings" label="Transmission" value={v.transmission} />
            <SpecCard c={c} icon="flash" label="Fuel" value={v.fuel_type} />
            <SpecCard c={c} icon="car-sport" label="Type" value={v.type === "car" ? "Car" : "Bike"} />
          </ScrollView>

          <Text style={[styles.h2, { color: c.onSurface }]}>About this {v.type}</Text>
          <Text style={{ color: c.onSurface2, fontSize: 14, lineHeight: 22 }}>{v.description}</Text>

          {v.features?.length > 0 && (
            <>
              <Text style={[styles.h2, { color: c.onSurface }]}>Features</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {v.features.map((f: string) => (
                  <View key={f} style={[styles.feat, { backgroundColor: c.surface2, borderColor: c.border }]}>
                    <Ionicons name="checkmark" size={12} color={c.accent} />
                    <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: "600" }}>{f}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={[styles.h2, { color: c.onSurface }]}>Hosted by</Text>
          <View style={[styles.hostCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <Image source={v.host_avatar} style={{ width: 48, height: 48, borderRadius: 999 }} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 }}>{v.host_name}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.trips} trips · Verified host</Text>
            </View>
            <Pressable testID="host-chat-btn" onPress={() => router.push("/support" as any)} style={[styles.chatBtn, { backgroundColor: c.surface3 }]}><Ionicons name="chatbubble-outline" size={18} color={c.onSurface} /></Pressable>
          </View>

          <Text style={[styles.h2, { color: c.onSurface }]}>Reviews</Text>
          {reviews.length === 0 ? (
            <View style={[styles.depositRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Ionicons name="star-outline" size={20} color={c.onSurface3} />
              <Text style={{ color: c.onSurface3, flex: 1 }}>No reviews yet. Complete a trip to leave the first review.</Text>
            </View>
          ) : reviews.slice(0, 3).map((r) => (
            <View key={r.review_id} style={[styles.reviewCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="star" size={14} color="#F59E0B" />
                <Text style={{ color: c.onSurface, fontWeight: "800" }}>{r.rating}/5</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12 }}>by {r.user_name}</Text>
              </View>
              {!!r.comment && <Text style={{ color: c.onSurface2, marginTop: 6, lineHeight: 20 }}>{r.comment}</Text>}
            </View>
          ))}

          <Text style={[styles.h2, { color: c.onSurface }]}>Security deposit</Text>
          <View style={[styles.depositRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <Ionicons name="shield-checkmark" size={20} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: "700" }}>Refundable deposit</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Returned within 48hrs of trip end</Text>
            </View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 }}>₹{v.deposit.toLocaleString()}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }]}>
        <View>
          <Text style={{ color: c.onSurface3, fontSize: 11 }}>starting from</Text>
          <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800" }}>₹{v.price_per_day.toLocaleString()}<Text style={{ fontSize: 12, color: c.onSurface3, fontWeight: "500" }}> /day</Text></Text>
        </View>
        <Pressable testID="book-now-btn" onPress={() => {
          if ((user as any)?.kyc_status !== "verified") {
            router.push(`/kyc?from=/vehicle/${v.vehicle_id}` as any);
            return;
          }
          router.push(`/booking/${v.vehicle_id}`);
        }} style={[styles.bookBtn, { backgroundColor: c.inverse }]}>
          <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>Book now</Text>
          <Ionicons name="arrow-forward" size={18} color={c.onInverse} />
        </Pressable>
      </View>
    </View>
  );
}

function SpecCard({ c, icon, label, value }: any) {
  return (
    <View style={[styles.specCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <Ionicons name={icon} size={20} color={c.onSurface} />
      <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 6 }}>{label}</Text>
      <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 14, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  ratingBox: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  specCard: { width: 100, padding: 12, borderRadius: 14, borderWidth: 1 },
  h2: { fontSize: 18, fontWeight: "800", marginTop: 24, marginBottom: 10 },
  feat: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  hostCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  chatBtn: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  depositRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  reviewCard: { padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1 },
  bookBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 18 },
});
