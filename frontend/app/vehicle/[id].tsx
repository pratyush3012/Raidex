import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions, Alert, FlatList, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { MapCanvas } from "@/src/features/maps/MapView";
import { getVehicleReviews } from "@/src/features/reviews/api/reviews";
import { RaidexBadge, RaidexButton, RaidexCard, RaidexEmptyState, RaidexErrorState } from "@/src/components/ui";

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
  const [activeImage, setActiveImage] = useState(0);
  const { user } = useAuth();

  // Subtle entrance for the price/CTA footer once the vehicle has actually
  // loaded - a small "it just arrived" cue rather than the footer just
  // popping into existence with the rest of the layout.
  const footerReveal = useSharedValue(0);
  const footerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: footerReveal.value,
    transform: [{ translateY: (1 - footerReveal.value) * 16 }],
  }));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const vehicle = await api<any>(`/vehicles/${id}`);
      setV(vehicle);
      setActiveImage(0);
      footerReveal.value = 0;
      footerReveal.value = withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
      const [wishlist, reviewItems] = await Promise.all([
        api<any[]>("/wishlist").catch(() => []),
        getVehicleReviews(id).catch(() => []),
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

  // Re-fetch reviews whenever this screen regains focus (e.g. the customer
  // just submitted a review from the trips screen and navigated back here),
  // so a newly submitted review doesn't stay invisible until a full reload.
  // Skip the very first focus - the mount effect above already fetched it.
  const skippedInitialFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      if (!skippedInitialFocus.current) {
        skippedInitialFocus.current = true;
        return;
      }
      getVehicleReviews(id)
        .then((reviewItems: any[]) => setReviews(reviewItems))
        .catch(() => {});
    }, [id])
  );

  const toggleWishlist = async () => {
    if (!v) return;
    const next = !wished;
    setWished(next);
    try {
      await api(`/wishlist/${v.vehicle_id}`, { method: next ? "POST" : "DELETE", queueOnFailure: true });
    } catch (e: any) {
      setWished(!next);
      Alert.alert("Wishlist", e.message || "Could not update wishlist.");
    }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={c.accent} size="large" /></View>;
  if (!v) return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {error ? (
        <RaidexErrorState testID="vehicle-error-state" title="Could not load vehicle" message={error} onRetry={load} />
      ) : (
        <RaidexEmptyState
          testID="vehicle-not-found-state"
          icon="car-outline"
          title="Vehicle not found"
          subtitle="This listing may no longer be available."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      )}
    </View>
  );

  const images: string[] = v.images && v.images.length > 0 ? v.images : v.image ? [v.image] : [];

  const onGalleryScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveImage(Math.max(0, Math.min(idx, images.length - 1)));
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={{ position: "relative" }}>
          <FlatList
            data={images}
            keyExtractor={(item, i) => `${item}-${i}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onGalleryScrollEnd}
            renderItem={({ item }) => <Image source={item} style={{ width, height: 360 }} contentFit="cover" />}
          />
          <LinearGradient colors={["rgba(0,0,0,0.35)", "transparent"]} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 120 }} />
          {images.length > 1 && (
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 14, flexDirection: "row", justifyContent: "center", gap: 6 }} pointerEvents="none">
              {images.map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === activeImage ? 18 : 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: i === activeImage ? "#fff" : "rgba(255,255,255,0.55)",
                  }}
                />
              ))}
            </View>
          )}
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
              <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: tokens.weight.semibold }}>{v.brand.toUpperCase()}</Text>
              <Text testID="vehicle-name" style={{ color: c.onSurface, fontSize: 28, fontWeight: tokens.weight.bold, marginTop: 4 }}>{v.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                <Ionicons name="location" size={14} color={c.onSurface3} />
                <Text style={{ color: c.onSurface3, fontSize: 13 }}>{v.location} · {v.distance_km} km away</Text>
              </View>
            </View>
            <View style={[styles.ratingBox, { backgroundColor: c.surface2 }]}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{v.rating.toFixed(1)}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 11 }}>({v.trips})</Text>
            </View>
          </View>

          {Number.isFinite(v.latitude) && Number.isFinite(v.longitude) ? (
            <View style={{ marginTop: 16 }}>
              <MapCanvas
                c={c}
                items={[{ vehicle_id: v.vehicle_id, latitude: v.latitude, longitude: v.longitude, price_per_day: v.price_per_day, available: v.available !== false }]}
                centerLat={v.latitude}
                centerLng={v.longitude}
                height={160}
              />
            </View>
          ) : null}

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
                  <RaidexBadge key={f} label={f} icon="checkmark" tone="neutral" />
                ))}
              </View>
            </>
          )}

          <Text style={[styles.h2, { color: c.onSurface }]}>Hosted by</Text>
          <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Image source={v.host_avatar} style={{ width: 48, height: 48, borderRadius: 999 }} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 15 }}>{v.host_name}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{v.trips} trips · Verified host</Text>
            </View>
            <Pressable testID="host-chat-btn" onPress={() => router.push("/support" as any)} style={[styles.chatBtn, { backgroundColor: c.surface3 }]}><Ionicons name="chatbubble-outline" size={18} color={c.onSurface} /></Pressable>
          </RaidexCard>

          <Text style={[styles.h2, { color: c.onSurface }]}>Reviews</Text>
          {reviews.length === 0 ? (
            <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Ionicons name="star-outline" size={20} color={c.onSurface3} />
              <Text style={{ color: c.onSurface3, flex: 1 }}>No reviews yet. Complete a trip to leave the first review.</Text>
            </RaidexCard>
          ) : reviews.slice(0, 3).map((r) => (
            <RaidexCard key={r.review_id} variant="flat" style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="star" size={14} color="#F59E0B" />
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{r.rating}/5</Text>
                <Text style={{ color: c.onSurface3, fontSize: 12 }}>by {r.user_name}</Text>
              </View>
              {!!r.comment && <Text style={{ color: c.onSurface2, marginTop: 6, lineHeight: 20 }}>{r.comment}</Text>}
            </RaidexCard>
          ))}

          <Text style={[styles.h2, { color: c.onSurface }]}>Security deposit</Text>
          <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name="shield-checkmark" size={20} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>Refundable deposit</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Returned within 48hrs of trip end</Text>
            </View>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16 }}>₹{v.deposit.toLocaleString()}</Text>
          </RaidexCard>
        </View>
      </ScrollView>

      <Animated.View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }, footerAnimatedStyle]}>
        <View>
          <Text style={{ color: c.onSurface3, fontSize: 11 }}>starting from</Text>
          <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: tokens.weight.bold }}>₹{v.price_per_day.toLocaleString()}<Text style={{ fontSize: 12, color: c.onSurface3, fontWeight: tokens.weight.regular }}> /day</Text></Text>
        </View>
        <RaidexButton
          testID="book-now-btn"
          label="Book now"
          icon="arrow-forward"
          iconPosition="trailing"
          fullWidth={false}
          onPress={() => {
            if ((user as any)?.kyc_status !== "verified") {
              router.push(`/kyc?from=/vehicle/${v.vehicle_id}` as any);
              return;
            }
            router.push(`/booking/${v.vehicle_id}`);
          }}
        />
      </Animated.View>
    </View>
  );
}

function SpecCard({ c, icon, label, value }: any) {
  return (
    <RaidexCard variant="flat" padding={12} style={{ width: 100, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={20} color={c.onSurface} />
      <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 6 }}>{label}</Text>
      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold, fontSize: 14, marginTop: 2 }}>{value}</Text>
    </RaidexCard>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  ratingBox: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  h2: { fontSize: 18, fontWeight: tokens.weight.bold, marginTop: 24, marginBottom: 10 },
  chatBtn: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1 },
});
