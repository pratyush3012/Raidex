import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, FlatList, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View, Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withDelay, Easing,
} from "react-native-reanimated";
import type BottomSheet from "@gorhom/bottom-sheet";
import {
  addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameDay, isSameMonth, isBefore, isAfter,
  addHours, startOfDay, differenceInCalendarDays, setHours, setMinutes,
} from "date-fns";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { tokens, useTheme } from "@/src/theme";
import {
  RaidexBottomSheet, RaidexButton, RaidexChip,
  RaidexEmptyState, RaidexErrorState, RaidexSkeleton, RaidexVehicleCard,
} from "@/src/components/ui";
import { getSavedLocation, SavedLocation } from "@/src/utils/location";

type Vehicle = {
  vehicle_id: string;
  type: "car" | "bike";
  name: string;
  brand: string;
  model?: string;
  image: string;
  price_per_day: number;
  price_per_hour: number;
  rating: number;
  trips: number;
  distance_km: number;
  location: string;
  fuel_type: string;
  transmission: string;
  seats: number;
  latitude: number;
  longitude: number;
  available?: boolean;
  instant_book?: boolean;
  trust_score?: number;
  safety_score?: number;
};

type IntentKey = "daily" | "bike";
type Step = "intent" | "duration" | "results";

// Zoomcar-style guided entry: pick what you want, then for how long, THEN see
// results - instead of a single screen with every filter visible at once
// (search + 5 chips + 4 filter pills all fighting for attention on load).
const INTENTS: { key: IntentKey; type: "car" | "bike"; title: string; copy: string; icon: keyof typeof Ionicons.glyphMap; image: string; badge?: string }[] = [
  {
    key: "daily", type: "car", title: "Daily Drive", copy: "Cars by the day for errands, work, or a trip.",
    icon: "car-sport", badge: "Most popular",
    image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80",
  },
  {
    key: "bike", type: "bike", title: "Bike Rental", copy: "Quick, affordable two-wheeler rentals nearby.",
    icon: "bicycle",
    image: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=900&q=80",
  },
];

const NAV_INTENTS: { title: string; copy: string; icon: keyof typeof Ionicons.glyphMap; route: string; image: string }[] = [
  {
    title: "Monthly Subscription", copy: "One flat plan, swap anytime.", icon: "calendar", route: "/subscriptions",
    image: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=700&q=80",
  },
  {
    title: "Vehicle Swap", copy: "Trade your ride for another.", icon: "swap-horizontal", route: "/subscriptions",
    image: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=700&q=80",
  },
];

// Bookings must start at least this far in the future - no next-minute
// pickups, gives owners/ops time to prep the vehicle.
const MIN_LEAD_HOURS = 2;

// Grouped instead of one 24-chip scroll, so picking an evening slot doesn't
// mean hunting through the whole day - and a group with nothing bookable
// (e.g. all of "Night" before the lead-time cutoff) just disappears.
const TIME_GROUPS: { label: string; icon: keyof typeof Ionicons.glyphMap; hours: number[] }[] = [
  { label: "Morning", icon: "sunny-outline", hours: [5, 6, 7, 8, 9, 10, 11] },
  { label: "Afternoon", icon: "partly-sunny-outline", hours: [12, 13, 14, 15, 16] },
  { label: "Evening", icon: "moon-outline", hours: [17, 18, 19, 20, 21] },
  { label: "Night", icon: "moon", hours: [22, 23, 0, 1, 2, 3, 4] },
];

function slotLabel(value: string): string {
  const hour = Number(value.split(":")[0]);
  return format(setMinutes(setHours(new Date(), hour), 0), "h:mm a");
}

type TripDates = { start: Date; end: Date; pickupTime: string; returnTime: string; days: number };

const SMART_PROMPTS = ["Bike under Rs 1000 near me", "EV within 5 km", "Cars for weekend trip"];

export default function HomeScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>("intent");
  const [intent, setIntent] = useState<IntentKey | null>(null);
  const [tripDates, setTripDates] = useState<TripDates | null>(null);

  // Real user location (lat/lng + label), persisted in src/utils/location.ts.
  // Loaded on mount and re-loaded whenever this screen regains focus, so
  // picking a location on /location is reflected here immediately on return.
  const [location, setLocation] = useState<SavedLocation | null>(null);
  const [locationLoaded, setLocationLoaded] = useState(false);
  const promptedForLocationRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const saved = await getSavedLocation();
        if (!cancelled) {
          setLocation(saved);
          setLocationLoaded(true);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [price, setPrice] = useState<"any" | "1000" | "2500" | "5000">("any");
  const [distance, setDistance] = useState<"any" | "2" | "5" | "10">("any");
  const [fuel, setFuel] = useState<"any" | "EV" | "Petrol" | "Diesel">("any");
  const [sort, setSort] = useState<"distance" | "price" | "rating">("distance");
  const [items, setItems] = useState<Vehicle[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Real count from a live API call, never a guess - populated only when the
  // primary search comes back empty for a specific vehicle type, so the empty
  // state can offer "N bikes nearby" instead of a dead end.
  const [altAvailable, setAltAvailable] = useState<{ type: "car" | "bike"; count: number } | null>(null);

  const filtersSheetRef = useRef<BottomSheet>(null);
  const activeFilterCount = [price !== "any", distance !== "any", fuel !== "any"].filter(Boolean).length;

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (cat === "car" || cat === "bike") params.set("type", cat);
      if (q.trim()) params.set("q", q.trim());
      if (price !== "any") params.set("max_price", price);
      if (distance !== "any") params.set("max_distance", distance);
      if (fuel !== "any") params.set("fuel_type", fuel);
      params.set("sort", sort);
      // Real coordinates, when a location is set, so "distance" is a real
      // computed figure (backend/server.py haversine) instead of the fixed
      // seed value - see src/utils/location.ts for how this is captured.
      if (location) {
        params.set("lat", String(location.lat));
        params.set("lng", String(location.lng));
      }
      const data = await api<Vehicle[]>(`/vehicles?${params.toString()}`, { cache: true });
      setItems(data);

      if (data.length === 0 && (cat === "car" || cat === "bike")) {
        const altType = cat === "car" ? "bike" : "car";
        const altParams = new URLSearchParams();
        altParams.set("type", altType);
        if (distance !== "any") altParams.set("max_distance", distance);
        if (location) {
          altParams.set("lat", String(location.lat));
          altParams.set("lng", String(location.lng));
        }
        try {
          const alt = await api<Vehicle[]>(`/vehicles?${altParams.toString()}`, { cache: true });
          setAltAvailable(alt.length > 0 ? { type: altType, count: alt.length } : null);
        } catch {
          setAltAvailable(null);
        }
      } else {
        setAltAvailable(null);
      }
    } catch (e: any) {
      setError(e.message || "Could not load vehicles");
      setItems([]);
      setAltAvailable(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cat, q, price, distance, fuel, sort, location]);

  useEffect(() => {
    if (step !== "results" || !locationLoaded) return;
    // First time this screen has a chance to send a real location and still
    // doesn't have one, send the rider to set it instead of silently calling
    // /vehicles with no coordinates forever. They can back out of /location
    // (it's a normal screen) and results still load via the static fallback.
    if (!location && !promptedForLocationRef.current) {
      promptedForLocationRef.current = true;
      router.push("/location");
    }
    fetchData();
  }, [step, locationLoaded, location, fetchData, router]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const toggleCompare = (vehicleId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(vehicleId)) return prev.filter((id) => id !== vehicleId);
      if (prev.length >= 4) {
        Alert.alert("Compare", "You can compare up to 4 vehicles at once.");
        return prev;
      }
      return [...prev, vehicleId];
    });
  };

  const compareVehicles = async () => {
    if (compareIds.length < 2) {
      Alert.alert("Compare vehicles", "Select at least two vehicles to compare.");
      return;
    }
    try {
      const res = await api<any>("/vehicles/compare", { method: "POST", body: { vehicle_ids: compareIds } });
      const summary = res.items.map((v: Vehicle) => `${v.name}: Rs ${v.price_per_day}/day, ${v.rating.toFixed(1)} rating, ${v.distance_km} km`).join("\n");
      Alert.alert("Comparison", summary);
    } catch (e: any) {
      Alert.alert("Compare failed", e.message || "Please try again.");
    }
  };

  const selectIntent = (opt: (typeof INTENTS)[number]) => {
    setIntent(opt.key);
    setCat(opt.type);
    setStep("duration");
  };

  const confirmTripDates = (d: TripDates) => {
    setTripDates(d);
    setStep("results");
  };

  const resetToIntent = () => {
    setStep("intent");
    setIntent(null);
    setTripDates(null);
    setCat("all");
    setQ("");
    setPrice("any");
    setDistance("any");
    setFuel("any");
  };

  if (step === "intent") {
    return (
      <IntentScreen
        c={c}
        insets={insets}
        greeting={greeting}
        user={user}
        router={router}
        onSelectIntent={selectIntent}
        location={location}
      />
    );
  }

  if (step === "duration") {
    const chosen = INTENTS.find((i) => i.key === intent);
    return (
      <TripDatesScreen
        c={c}
        insets={insets}
        intentTitle={chosen?.title ?? ""}
        intentIcon={chosen?.icon ?? "car-sport"}
        onBack={() => setStep("intent")}
        onConfirm={confirmTripDates}
      />
    );
  }

  const chosenIntent = INTENTS.find((i) => i.key === intent);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={styles.topPad}>
          <View style={styles.headerRow}>
            <Pressable testID="change-intent-btn" onPress={resetToIntent} style={[styles.changePill, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Ionicons name="chevron-back" size={16} color={c.onSurface2} />
              <Ionicons name={chosenIntent?.icon ?? "car-sport"} size={14} color={c.accent} />
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 12 }} numberOfLines={1}>
                {chosenIntent?.title} · {tripDates ? `${tripDates.days} day${tripDates.days > 1 ? "s" : ""}` : ""}
              </Text>
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable testID="ride-miles-pill" onPress={() => router.push("/(tabs)/rewards" as any)} style={[styles.pill, { backgroundColor: c.accentBg }]}>
                <Ionicons name="star" size={12} color={c.onAccentBg} />
                <Text style={{ color: c.onAccentBg, fontWeight: "700", fontSize: 12 }}>{user?.ride_miles ?? 0}</Text>
              </Pressable>
              <Pressable testID="notif-btn" onPress={() => router.push("/notifications")}>
                <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
              </Pressable>
            </View>
          </View>

          <Pressable
            testID="location-pill"
            onPress={() => router.push("/location")}
            style={[styles.locationPill, { backgroundColor: c.surface2, borderColor: c.border }]}
          >
            <Ionicons name="location" size={13} color={c.accent} />
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 12.5, flexShrink: 1 }} numberOfLines={1}>
              {location ? location.label : "Set your location"}
            </Text>
            <Ionicons name="chevron-forward" size={13} color={c.onSurface3} />
          </Pressable>

          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Ionicons name="search" size={18} color={c.onSurface3} />
              <TextInput
                testID="search-input"
                value={q}
                onChangeText={setQ}
                placeholder="Try 'Bike under Rs 1000 near me'"
                placeholderTextColor={c.onSurface3}
                style={{ flex: 1, color: c.onSurface, fontSize: tokens.type.base }}
                returnKeyType="search"
                onSubmitEditing={fetchData}
              />
              {q.length > 0 && (
                <Pressable onPress={() => setQ("")}>
                  <Ionicons name="close-circle" size={18} color={c.onSurface3} />
                </Pressable>
              )}
            </View>
            <Pressable
              testID="open-filters-btn"
              onPress={() => filtersSheetRef.current?.expand()}
              style={[styles.filtersBtn, { backgroundColor: activeFilterCount ? c.inverse : c.surface2, borderColor: c.border }]}
            >
              <Ionicons name="options" size={18} color={activeFilterCount ? c.onInverse : c.onSurface} />
              {activeFilterCount > 0 && (
                <View style={[styles.filterBadge, { backgroundColor: c.accent }]}>
                  <Text style={{ color: c.onAccentBg, fontSize: 10, fontWeight: "900" }}>{activeFilterCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptScroller}>
          {SMART_PROMPTS.map((prompt) => (
            <Pressable key={prompt} onPress={() => setQ(prompt)} style={[styles.promptChip, { backgroundColor: c.accentBg }]}>
              <Ionicons name="sparkles" size={12} color={c.onAccentBg} />
              <Text style={{ color: c.onAccentBg, fontWeight: "700", fontSize: 12 }}>{prompt}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>

      {loading ? (
        <DiscoverySkeleton c={c} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.vehicle_id}
          contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: insets.bottom + 80 }}
          ItemSeparatorComponent={() => <View style={{ height: tokens.spacing.lg }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
          ListHeaderComponent={
            <View style={{ marginBottom: tokens.spacing.lg, gap: 14 }}>
              <DiscoveryHero c={c} items={items} onRefresh={fetchData} refreshing={refreshing} />
              {compareIds.length > 0 && (
                <View style={[styles.compareBar, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", flex: 1 }}>{compareIds.length} selected for compare</Text>
                  <Pressable onPress={() => setCompareIds([])}><Text style={{ color: c.onSurface3, fontWeight: "700" }}>Clear</Text></Pressable>
                  <Pressable onPress={compareVehicles} style={[styles.smallBtn, { backgroundColor: c.inverse }]}>
                    <Text style={{ color: c.onInverse, fontWeight: "800" }}>Compare</Text>
                  </Pressable>
                </View>
              )}
              <Pressable testID="ride-miles-card" onPress={() => router.push("/(tabs)/rewards" as any)}>
                <LinearGradient colors={["#0F2E22", "#122016"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.pointsCard, { borderWidth: 1, borderColor: c.border }]}>
                  <Text style={[styles.pointsEyebrow, { color: c.onAccentBg }]}>RIDEX POINTS</Text>
                  <Text style={styles.pointsTier}>{user?.tier ?? "Silver"}</Text>
                  <Text style={styles.pointsCopy}>{user?.ride_miles ?? 0} points. Earn on rentals, referrals, reviews, and on-time returns.</Text>
                  <RideMilesProgressBar targetPct={Math.min(100, ((user?.ride_miles ?? 0) / 1000) * 100)} />
                </LinearGradient>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            error ? (
              <RaidexErrorState message={error} onRetry={fetchData} testID="discovery-error-state" />
            ) : altAvailable ? (
              <NoResultsSmartState
                c={c}
                searchedType={cat}
                alt={altAvailable}
                onTryAlt={() => setCat(altAvailable.type)}
                onOpenFilters={() => filtersSheetRef.current?.expand()}
              />
            ) : (
              <RaidexEmptyState
                icon="car-outline"
                title="No vehicles found"
                subtitle="Try another search or filter."
                testID="discovery-empty-state"
              />
            )
          }
          renderItem={({ item, index }) => (
            <RaidexVehicleCard
              testID={`vehicle-card-${item.vehicle_id}`}
              vehicle={item}
              index={index}
              badge={cardBadge(items, item)}
              onPress={() => router.push(`/vehicle/${item.vehicle_id}`)}
              selected={compareIds.includes(item.vehicle_id)}
              onToggleSelect={() => toggleCompare(item.vehicle_id)}
              selectLabel="Compare"
            />
          )}
        />
      )}

      <RaidexBottomSheet ref={filtersSheetRef} snapPoints={["55%"]}>
        <FiltersSheetContent
          c={c}
          cat={cat}
          setCat={setCat}
          price={price}
          setPrice={setPrice}
          distance={distance}
          setDistance={setDistance}
          fuel={fuel}
          setFuel={setFuel}
          sort={sort}
          setSort={setSort}
          onApply={() => filtersSheetRef.current?.close()}
          onReset={() => { setCat(chosenIntent?.type ?? "all"); setPrice("any"); setDistance("any"); setFuel("any"); setSort("distance"); }}
        />
      </RaidexBottomSheet>
    </View>
  );
}

function StepEntrance({ children }: { children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) });
  }, [opacity, translateY]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}

const SCREEN_WIDTH = Dimensions.get("window").width;

function IntentScreen({ c, insets, greeting, user, router, onSelectIntent, location }: any) {
  // Everything here is real: a live vehicle count and the rider's own
  // nearest upcoming booking, both fetched fresh on open. No placeholder
  // numbers, no invented "trip coming up" copy when there isn't one.
  const [nearbyCount, setNearbyCount] = useState<number | null>(null);
  const [upcomingBooking, setUpcomingBooking] = useState<any>(null);
  const [hasBookingHistory, setHasBookingHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vehiclesPath = location
        ? `/vehicles?sort=distance&lat=${location.lat}&lng=${location.lng}`
        : "/vehicles?sort=distance";
      const [vehicles, bookings] = await Promise.all([
        api<any[]>(vehiclesPath, { cache: true }).catch(() => null),
        api<any[]>("/bookings").catch(() => null),
      ]);
      if (cancelled) return;
      if (vehicles) setNearbyCount(vehicles.length);
      if (bookings) {
        setHasBookingHistory(bookings.length > 0);
        const upcoming = bookings
          .filter((b) => b.status === "confirmed" || b.status === "active")
          .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0];
        setUpcomingBooking(upcoming ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [location]);

  const heading = upcomingBooking
    ? (upcomingBooking.status === "active" ? "Your trip is in progress" : "Your ride is coming up")
    : hasBookingHistory
      ? "Ready for your next ride?"
      : "What do you want to do?";
  const subheading = upcomingBooking
    ? null
    : hasBookingHistory
      ? "Pick up where you left off - we'll only show what's relevant next."
      : "Pick one to get started - we'll only show what's relevant next.";

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <StepEntrance>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
            <View style={[styles.headerRow, { paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md }]}>
              <View>
                <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm }}>{greeting}</Text>
                <Text testID="home-greeting" style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: "800", marginTop: 2 }}>
                  {user?.name?.split(" ")[0] || "Rider"}
                </Text>
                <Pressable testID="intent-location-pill" onPress={() => router.push("/location")} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                  <Ionicons name="location" size={11} color={c.accent} />
                  <Text style={{ color: c.onSurface2, fontWeight: "700", fontSize: 11.5 }} numberOfLines={1}>
                    {location ? location.label : "Set your location"}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.headerActions}>
                <Pressable testID="ride-miles-pill" onPress={() => router.push("/(tabs)/rewards" as any)} style={[styles.pill, { backgroundColor: c.accentBg }]}>
                  <Ionicons name="star" size={12} color={c.onAccentBg} />
                  <Text style={{ color: c.onAccentBg, fontWeight: "700", fontSize: 12 }}>{user?.ride_miles ?? 0}</Text>
                </Pressable>
                <Pressable testID="notif-btn" onPress={() => router.push("/notifications")}>
                  <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
                </Pressable>
              </View>
            </View>

            <View style={{ paddingHorizontal: tokens.spacing.xl }}>
              {upcomingBooking ? (
                <Pressable
                  testID="upcoming-booking-banner"
                  onPress={() => upcomingBooking.status === "active" && router.push(`/trip/${upcomingBooking.booking_id}`)}
                  style={[styles.upcomingBanner, { marginTop: 20 }]}
                >
                  <LinearGradient colors={c.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.upcomingBanner, { borderColor: c.border, borderWidth: 1 }]}>
                    <Image source={upcomingBooking.vehicle_snapshot?.image} style={styles.upcomingBannerImage} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <View style={[styles.upcomingStatusPill, { backgroundColor: upcomingBooking.status === "active" ? c.infoBg : c.accentBg }]}>
                        <View style={[styles.liveDotSmall, { backgroundColor: upcomingBooking.status === "active" ? c.info : c.accent }]} />
                        <Text style={{ color: upcomingBooking.status === "active" ? c.onInfoBg : c.onAccentBg, fontSize: 10, fontWeight: "900" }}>
                          {upcomingBooking.status === "active" ? "LIVE NOW" : "UPCOMING"}
                        </Text>
                      </View>
                      <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15, marginTop: 6 }} numberOfLines={1}>{upcomingBooking.vehicle_snapshot?.name}</Text>
                      <Text style={{ color: c.onSurface2, fontSize: 12, marginTop: 2 }}>
                        {upcomingBooking.status === "active" ? "Tap to open live trip" : format(new Date(upcomingBooking.start_date), "EEE, MMM d · h:mm a")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward-circle" size={22} color={c.accent} />
                  </LinearGradient>
                </Pressable>
              ) : (
                <View style={[styles.liveStrip, { backgroundColor: c.accentBg, marginTop: 20 }]}>
                  <View style={[styles.liveDotSmall, { backgroundColor: c.accent }]} />
                  <Text style={{ color: c.onAccentBg, fontWeight: "800", fontSize: 11.5 }}>
                    {nearbyCount == null ? "Finding vehicles near you..." : nearbyCount > 0 ? `${nearbyCount} vehicles ready near you right now` : "Checking availability near you"}
                  </Text>
                </View>
              )}
              <Text style={{ color: c.onSurface, fontSize: 27, fontWeight: "900", marginTop: 14 }}>{heading}</Text>
              {subheading && (
                <Text style={{ color: c.onSurface2, fontSize: 14, marginTop: 6, lineHeight: 20 }}>{subheading}</Text>
              )}
            </View>

            <View style={styles.intentGrid}>
              {INTENTS.map((opt, index) => (
                <IntentCard key={opt.key} c={c} index={index} title={opt.title} copy={opt.copy} icon={opt.icon} image={opt.image} badge={opt.badge}
                  testID={`intent-${opt.key}`} onPress={() => onSelectIntent(opt)} size="large" />
              ))}
            </View>

            <View style={styles.intentGrid}>
              {NAV_INTENTS.map((opt, index) => (
                <IntentCard key={opt.title} c={c} index={INTENTS.length + index} title={opt.title} copy={opt.copy} icon={opt.icon} image={opt.image}
                  testID={`intent-nav-${index}`} onPress={() => router.push(opt.route)} size="small" />
              ))}
            </View>
          </ScrollView>
        </StepEntrance>
      </SafeAreaView>
    </View>
  );
}

function IntentCard({ c, index, title, copy, icon, image, badge, onPress, testID, size }: any) {
  const appear = useSharedValue(0);
  const press = useSharedValue(1);
  const large = size === "large";
  const cardWidth = (SCREEN_WIDTH - tokens.spacing.xl * 2 - tokens.spacing.md) / 2;

  useEffect(() => {
    appear.value = withDelay(180 + index * 90, withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) }));
  }, [appear, index]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 22 }, { scale: 0.94 + appear.value * 0.06 * press.value }],
  }));

  return (
    <Animated.View style={[containerStyle, { width: cardWidth }]}>
      <Pressable
        testID={testID}
        onPressIn={() => { press.value = withTiming(0.97, { duration: tokens.motion.quick }); }}
        onPressOut={() => { press.value = withTiming(1, { duration: tokens.motion.quick }); }}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onPress(); }}
        style={[styles.intentImgCard, { height: large ? 208 : 148, borderColor: c.border }]}
      >
        <Image source={image} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={250} />
        <LinearGradient
          colors={["rgba(10,10,14,0)", "rgba(10,10,14,0.35)", "rgba(10,10,14,0.94)"]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        {badge && (
          <View style={[styles.intentBadge, { backgroundColor: c.accent }]}>
            <Ionicons name="sparkles" size={10} color={c.onInverse} />
            <Text style={{ color: c.onInverse, fontSize: 10, fontWeight: "900" }}>{badge.toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.intentIconWrap, { backgroundColor: "rgba(255,255,255,0.16)", borderColor: "rgba(255,255,255,0.28)" }]}>
          <Ionicons name={icon} size={large ? 20 : 17} color="#fff" />
        </View>
        <View style={styles.intentCardText}>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: large ? 17 : 14.5 }} numberOfLines={1}>{title}</Text>
          <Text style={{ color: "rgba(255,255,255,0.78)", fontSize: large ? 12.5 : 11, marginTop: 3, lineHeight: 16 }} numberOfLines={2}>{copy}</Text>
        </View>
        <View style={styles.intentChevron}>
          <Ionicons name="chevron-forward-circle" size={22} color="#fff" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function TripDatesScreen({ c, insets, intentTitle, intentIcon, onBack, onConfirm }: any) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [pickupTime, setPickupTime] = useState<string | null>(null);
  const [returnTime, setReturnTime] = useState<string | null>(null);

  const cutoff = useMemo(() => addHours(new Date(), MIN_LEAD_HOURS), []);
  const sameDayTrip = !!(rangeStart && rangeEnd && isSameDay(rangeStart, rangeEnd));

  const onDayPress = (day: Date) => {
    if (isBefore(day, today)) return;
    Haptics.selectionAsync().catch(() => {});
    // Standard range-picker behavior: first tap after a complete (or empty)
    // selection always starts a fresh pick - only a *second* tap (on or after
    // the start day) completes the range. Auto-completing the range on a
    // single tap would make it impossible to ever tell "extend to this later
    // day" apart from "start over here".
    if (!rangeStart || rangeEnd) {
      setRangeStart(day);
      setRangeEnd(null);
      setPickupTime(null);
      setReturnTime(null);
    } else if (isBefore(day, rangeStart)) {
      setRangeStart(day);
      setRangeEnd(null);
      setPickupTime(null);
      setReturnTime(null);
    } else {
      setRangeEnd(day);
      setReturnTime(null);
    }
  };

  const isPickupDisabled = (hour: number) => {
    if (!rangeStart) return true;
    if (!isSameDay(rangeStart, today)) return false;
    return isBefore(setMinutes(setHours(rangeStart, hour), 0), cutoff);
  };

  const isReturnDisabled = (hour: number) => {
    if (!rangeEnd) return true;
    if (sameDayTrip && pickupTime) {
      const pickupHour = Number(pickupTime.split(":")[0]);
      return hour <= pickupHour;
    }
    return false;
  };

  const days = rangeStart && rangeEnd ? differenceInCalendarDays(rangeEnd, rangeStart) + 1 : 0;
  const canContinue = !!(rangeStart && rangeEnd && pickupTime && returnTime);

  const handleContinue = () => {
    if (!canContinue) return;
    onConfirm({ start: rangeStart, end: rangeEnd, pickupTime, returnTime, days: Math.max(1, days) });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <StepEntrance>
          <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
            <Pressable testID="duration-back-btn" onPress={onBack} style={[styles.backCircle, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Ionicons name="chevron-back" size={22} color={c.onSurface} />
            </Pressable>

            <View style={[styles.intentSummaryPill, { backgroundColor: c.accentBg, marginTop: 18 }]}>
              <Ionicons name={intentIcon} size={13} color={c.onAccentBg} />
              <Text style={{ color: c.onAccentBg, fontWeight: "900", fontSize: 12 }}>{intentTitle}</Text>
            </View>
            <Text style={{ color: c.onSurface, fontSize: 24, fontWeight: "900", marginTop: 14 }}>Pick your dates</Text>
            <Text style={{ color: c.onSurface2, fontSize: 13.5, marginTop: 6, lineHeight: 19 }}>
              Tap a start date, then an end date. Bookings need at least {MIN_LEAD_HOURS} hours' notice.
            </Text>

            <TripSummaryCard c={c} rangeStart={rangeStart} rangeEnd={rangeEnd} pickupTime={pickupTime} returnTime={returnTime} days={days} />

            <View style={[styles.calendarCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <View style={styles.calendarNavRow}>
                <Pressable
                  testID="calendar-prev-month"
                  onPress={() => setVisibleMonth((m) => subMonths(m, 1))}
                  disabled={isSameMonth(visibleMonth, today)}
                  style={[styles.calendarNavBtn, { opacity: isSameMonth(visibleMonth, today) ? 0.3 : 1 }]}
                >
                  <Ionicons name="chevron-back" size={18} color={c.onSurface} />
                </Pressable>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 }}>{format(visibleMonth, "MMMM yyyy")}</Text>
                <Pressable testID="calendar-next-month" onPress={() => setVisibleMonth((m) => addMonths(m, 1))} style={styles.calendarNavBtn}>
                  <Ionicons name="chevron-forward" size={18} color={c.onSurface} />
                </Pressable>
              </View>

              <View style={styles.weekdayRow}>
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <Text key={i} style={[styles.weekdayLabel, { color: c.onSurface3 }]}>{d}</Text>
                ))}
              </View>

              <CalendarGrid
                c={c}
                visibleMonth={visibleMonth}
                today={today}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onDayPress={onDayPress}
              />
            </View>

            {rangeStart && (
              <View style={{ marginTop: 22 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 }}>Pickup time</Text>
                <Text style={{ color: c.onSurface3, fontSize: 11.5, marginTop: 2, marginBottom: 12 }}>
                  {isSameDay(rangeStart, today) ? `Earliest slot is ${format(cutoff, "h:mm a")} today (${MIN_LEAD_HOURS}h notice)` : `On ${format(rangeStart, "EEE, MMM d")}`}
                </Text>
                <TimeSlotGroups c={c} selected={pickupTime} isDisabled={isPickupDisabled} onSelect={setPickupTime} testIDPrefix="pickup" />
              </View>
            )}

            {rangeEnd && pickupTime && (
              <View style={{ marginTop: 24 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 }}>Return time</Text>
                <Text style={{ color: c.onSurface3, fontSize: 11.5, marginTop: 2, marginBottom: 12 }}>
                  {sameDayTrip ? "Must be after your pickup time" : `On ${format(rangeEnd, "EEE, MMM d")}`}
                </Text>
                <TimeSlotGroups c={c} selected={returnTime} isDisabled={isReturnDisabled} onSelect={setReturnTime} testIDPrefix="return" />
              </View>
            )}
          </ScrollView>

          <View style={[styles.continueBar, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 14 }]}>
            <RaidexButton testID="confirm-trip-dates-btn" label={canContinue ? "See vehicles" : "Select dates & times"} onPress={handleContinue} disabled={!canContinue} />
          </View>
        </StepEntrance>
      </SafeAreaView>
    </View>
  );
}

function CalendarGrid({ c, visibleMonth, today, rangeStart, rangeEnd, onDayPress }: any) {
  const gridDays = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const monthEnd = endOfMonth(visibleMonth);
    return eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });
  }, [visibleMonth]);

  return (
    <View style={styles.calendarGrid}>
      {gridDays.map((day) => {
        const inMonth = isSameMonth(day, visibleMonth);
        const isPast = isBefore(day, today);
        const isStart = rangeStart && isSameDay(day, rangeStart);
        const isEnd = rangeEnd && isSameDay(day, rangeEnd);
        const inRange = rangeStart && rangeEnd && isAfter(day, rangeStart) && isBefore(day, rangeEnd);
        const isEdge = isStart || isEnd;
        const disabled = !inMonth || isPast;

        return (
          <Pressable
            key={day.toISOString()}
            testID={`calendar-day-${format(day, "yyyy-MM-dd")}`}
            disabled={disabled}
            onPress={() => onDayPress(day)}
            style={[styles.calendarCell, inRange ? { backgroundColor: c.accentBg } : null]}
          >
            <View style={[styles.calendarCellInner, isEdge ? { backgroundColor: c.accent } : null]}>
              <Text
                style={{
                  color: !inMonth || isPast ? c.onSurface3 : isEdge ? c.onInverse : isSameDay(day, today) ? c.accent : c.onSurface,
                  fontWeight: isEdge || isSameDay(day, today) ? "900" : "600",
                  fontSize: 14,
                  opacity: disabled ? 0.35 : 1,
                }}
              >
                {day.getDate()}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function TimeSlotGroups({ c, selected, isDisabled, onSelect, testIDPrefix }: any) {
  return (
    <View style={{ gap: 16 }}>
      {TIME_GROUPS.map((group) => {
        const anyEnabled = group.hours.some((h) => !isDisabled(h));
        if (!anyEnabled) return null; // whole section is in the past - don't show a dead-end row
        return (
          <View key={group.label}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 9 }}>
              <Ionicons name={group.icon} size={13} color={c.onSurface3} />
              <Text style={{ color: c.onSurface3, fontWeight: "800", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>{group.label}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {group.hours.map((h) => {
                const value = `${String(h).padStart(2, "0")}:00`;
                const disabled = isDisabled(h);
                const active = selected === value;
                return (
                  <Pressable
                    key={h}
                    testID={`${testIDPrefix}-slot-${value}`}
                    disabled={disabled}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); onSelect(value); }}
                    style={[
                      styles.timeSlot,
                      {
                        backgroundColor: active ? c.accent : c.surface2,
                        borderColor: active ? c.accent : c.border,
                        opacity: disabled ? 0.32 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: active ? c.onInverse : c.onSurface, fontWeight: "800", fontSize: 13 }}>
                      {slotLabel(value)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

// A pickup/return "boarding pass" style summary that reflects picked state
// live - "--" placeholders before a choice exists, real values the instant
// they're picked, so the user never loses track of what they've committed to
// while scrolling down to the calendar/time pickers below it.
function TripSummaryCard({ c, rangeStart, rangeEnd, pickupTime, returnTime, days }: any) {
  return (
    <View style={[styles.tripSummaryCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.summaryLabel, { color: c.onSurface3 }]}>PICKUP</Text>
        <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 }}>{rangeStart ? format(rangeStart, "d MMM") : "--"}</Text>
        <Text style={{ color: rangeStart ? c.onSurface2 : c.onSurface3, fontWeight: "700", fontSize: 12.5, marginTop: 2 }}>
          {pickupTime ? slotLabel(pickupTime) : rangeStart ? "Select time" : "Select date"}
        </Text>
      </View>
      <View style={styles.summaryDivider}>
        <View style={{ width: 1, flex: 1, backgroundColor: c.border }} />
        {days > 0 && (
          <View style={[styles.durationPill, { backgroundColor: c.accent }]}>
            <Text style={{ color: c.onInverse, fontWeight: "900", fontSize: 10 }}>{days}D</Text>
          </View>
        )}
        <View style={{ width: 1, flex: 1, backgroundColor: c.border }} />
      </View>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text style={[styles.summaryLabel, { color: c.onSurface3 }]}>RETURN</Text>
        <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 19 }}>{rangeEnd ? format(rangeEnd, "d MMM") : "--"}</Text>
        <Text style={{ color: rangeEnd ? c.onSurface2 : c.onSurface3, fontWeight: "700", fontSize: 12.5, marginTop: 2 }}>
          {returnTime ? slotLabel(returnTime) : rangeEnd ? "Select time" : "Select date"}
        </Text>
      </View>
    </View>
  );
}

function FiltersSheetContent({ c, cat, setCat, price, setPrice, distance, setDistance, fuel, setFuel, sort, setSort, onApply, onReset }: any) {
  const CATS = [
    { key: "all", label: "All", icon: "apps" as const },
    { key: "car", label: "Cars", icon: "car-sport" as const },
    { key: "bike", label: "Bikes", icon: "bicycle" as const },
  ];
  return (
    <View style={{ flex: 1, paddingTop: tokens.spacing.lg }}>
      <View style={styles.sheetHeaderRow}>
        <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 }}>Filters & sort</Text>
        <Pressable onPress={onReset}><Text style={{ color: c.onSurface2, fontWeight: "700" }}>Reset</Text></Pressable>
      </View>

      <Text style={[styles.sheetLabel, { color: c.onSurface2 }]}>Vehicle type</Text>
      <View style={styles.sheetChipRow}>
        {CATS.map((it) => (
          <RaidexChip key={it.key} testID={`sheet-chip-${it.key}`} label={it.label} icon={it.icon} active={cat === it.key} onPress={() => setCat(it.key)} />
        ))}
      </View>

      <SheetRow c={c} label="Max price" value={price === "any" ? "Any" : `Under Rs ${price}`}
        onPress={() => setPrice(price === "any" ? "1000" : price === "1000" ? "2500" : price === "2500" ? "5000" : "any")} />
      <SheetRow c={c} label="Distance" value={distance === "any" ? "Any" : `Within ${distance} km`}
        onPress={() => setDistance(distance === "any" ? "2" : distance === "2" ? "5" : distance === "5" ? "10" : "any")} />
      <SheetRow c={c} label="Fuel type" value={fuel === "any" ? "Any" : fuel}
        onPress={() => setFuel(fuel === "any" ? "EV" : fuel === "EV" ? "Petrol" : fuel === "Petrol" ? "Diesel" : "any")} />
      <SheetRow c={c} label="Sort by" value={sort}
        onPress={() => setSort(sort === "distance" ? "price" : sort === "price" ? "rating" : "distance")} />

      <View style={{ flex: 1 }} />
      <RaidexButton testID="apply-filters-btn" label="Show results" onPress={onApply} style={{ marginBottom: tokens.spacing.lg }} />
    </View>
  );
}

function SheetRow({ c, label, value, onPress }: any) {
  return (
    <Pressable testID={`sheet-row-${label}`} onPress={onPress} style={[styles.sheetRow, { borderColor: c.border }]}>
      <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: c.onSurface2, fontWeight: "800", fontSize: 13, textTransform: "capitalize" }}>{value}</Text>
        <Ionicons name="chevron-forward" size={16} color={c.onSurface3} />
      </View>
    </Pressable>
  );
}

// Picks the ONE cheapest and ONE highest-rated card to badge, purely from
// the real list already on screen - never invented, never server-fetched
// separately. A list of 0-1 items gets no badge (nothing to stand out from).
function cardBadge(items: Vehicle[], item: Vehicle): "best_value" | "top_rated" | undefined {
  if (items.length < 2) return undefined;
  const cheapest = items.reduce((min, v) => (v.price_per_day < min.price_per_day ? v : min), items[0]);
  if (item.vehicle_id === cheapest.vehicle_id) return "best_value";
  const topRated = items.reduce((max, v) => (v.rating > max.rating ? v : max), items[0]);
  if (item.vehicle_id === topRated.vehicle_id && topRated.rating >= 4.7) return "top_rated";
  return undefined;
}

// Zero results shouldn't be a dead end. When the exact search (car OR bike)
// comes back empty, fetchData already made one extra real API call to check
// the other vehicle type for the same distance filter - this renders that
// actual count instead of a flat "No vehicles found."
function NoResultsSmartState({ c, searchedType, alt, onTryAlt, onOpenFilters }: any) {
  const searchedLabel = searchedType === "car" ? "cars" : "bikes";
  const altLabel = alt.type === "car" ? "cars" : "bikes";
  const altIcon = alt.type === "car" ? "car-sport" : "bicycle";
  return (
    <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 }}>
      <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Ionicons name={altIcon} size={28} color={c.onAccentBg} />
      </View>
      <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "900", textAlign: "center" }}>No {searchedLabel} available right now</Text>
      <Text style={{ color: c.onSurface2, fontSize: 13, textAlign: "center", marginTop: 6, lineHeight: 19 }}>
        Good news - {alt.count} {altLabel} {alt.count === 1 ? "is" : "are"} available nearby for these dates.
      </Text>
      <Pressable
        testID="try-alt-category-btn"
        onPress={onTryAlt}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.inverse, paddingHorizontal: 20, paddingVertical: 14, borderRadius: tokens.radius.md, marginTop: 20 }}
      >
        <Ionicons name={altIcon} size={16} color={c.onInverse} />
        <Text style={{ color: c.onInverse, fontWeight: "800" }}>Explore {alt.count} {altLabel}</Text>
      </Pressable>
      <Pressable testID="adjust-filters-btn" onPress={onOpenFilters} style={{ marginTop: 14, padding: 6 }}>
        <Text style={{ color: c.onSurface2, fontWeight: "700", fontSize: 13 }}>Or adjust filters</Text>
      </Pressable>
    </View>
  );
}

// Discovery used to be map-first (live pins over an OSM tile). Riders found
// that fiddly on a phone, so this is a single list-first hero: a quick
// standout pick up top plus at-a-glance stats, then the full ranked list
// below it - same underlying data, none of the map chrome.
function DiscoveryHero({ c, items, onRefresh, refreshing }: any) {
  const available = items.filter((item: Vehicle) => item.available !== false).length;
  const nearest = items.length ? Math.min(...items.map((item: Vehicle) => Number(item.distance_km) || 999)) : 0;
  const bestPrice = items.length ? Math.min(...items.map((item: Vehicle) => Number(item.price_per_day) || 999999)) : 0;
  const router = useRouter();

  const pick = useMemo(() => {
    if (!items.length) return null;
    return [...items].sort((a: Vehicle, b: Vehicle) => (Number(a.distance_km) || 99) - (Number(b.distance_km) || 99))[0];
  }, [items]);

  return (
    <View style={[styles.heroPanel, { borderColor: c.border }]}>
      <LinearGradient colors={c.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroTop}>
        <View style={styles.mapHeader}>
          <View>
            <Text style={[styles.heroTitle, { color: c.onSurface }]}>Nearby rides</Text>
            <Text style={[styles.heroSubtitle, { color: c.onSurface2 }]}>{items.length} vehicles ready near you</Text>
          </View>
          <Pressable testID="discovery-refresh" onPress={onRefresh} style={[styles.heroRefresh, { backgroundColor: c.surface3, borderColor: c.border }]}>
            <Ionicons name="refresh" size={17} color={c.onSurface} style={refreshing ? { transform: [{ rotate: "45deg" }] } : undefined} />
          </Pressable>
        </View>

        <View style={styles.heroStatsRow}>
          <StatTile c={c} icon="car-sport" label="Available" value={String(available)} />
          <StatTile c={c} icon="navigate" label="Nearest" value={items.length ? `${nearest} km` : "-"} />
          <StatTile c={c} icon="pricetag" label="From" value={items.length ? `Rs ${bestPrice.toLocaleString()}` : "-"} />
        </View>
      </LinearGradient>

      {pick ? (
        <Pressable testID="discovery-top-pick" onPress={() => router.push(`/vehicle/${pick.vehicle_id}`)}
          style={[styles.pickCard, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Image source={pick.image} style={styles.pickImage} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <View style={styles.pickBadgeRow}>
              <View style={[styles.pickBadge, { backgroundColor: c.accentBg }]}>
                <Ionicons name="flash" size={10} color={c.onAccentBg} />
                <Text style={{ color: c.onAccentBg, fontSize: 10, fontWeight: "900" }}>CLOSEST PICK</Text>
              </View>
            </View>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15, marginTop: 6 }} numberOfLines={1}>{pick.name}</Text>
            <View style={styles.mapMetaRow}>
              <Ionicons name="star" size={12} color={c.gold} />
              <Text style={{ color: c.onSurface2, fontWeight: "800", fontSize: 12 }}>{pick.rating.toFixed(1)}</Text>
              <Text style={{ color: c.onSurface3, fontSize: 12 }}>|</Text>
              <Text style={{ color: c.onSurface2, fontWeight: "800", fontSize: 12 }}>{pick.distance_km} km away</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 }}>₹{pick.price_per_day.toLocaleString()}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11 }}>per day</Text>
            <Ionicons name="chevron-forward-circle" size={22} color={c.accent} style={{ marginTop: 6 }} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function StatTile({ c, icon, label, value }: any) {
  return (
    <View style={[styles.statTile, { backgroundColor: c.surface3, borderColor: c.border }]}>
      <Ionicons name={icon} size={18} color={c.accent} />
      <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "900", marginTop: 6 }}>{value}</Text>
      <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: "700", marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function RideMilesProgressBar({ targetPct }: { targetPct: number }) {
  const width = useSharedValue(0);
  useEffect(() => { width.value = withTiming(targetPct, { duration: tokens.motion.slow }); }, [targetPct, width]);
  const animatedStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[{ height: "100%", backgroundColor: "#05C46B", borderRadius: 999 }, animatedStyle]} />
    </View>
  );
}

function DiscoverySkeleton({ c }: any) {
  return (
    <View style={{ padding: tokens.spacing.xl, gap: 14 }}>
      <RaidexSkeleton height={260} radius={22} />
      <RaidexSkeleton width="70%" height={18} />
      <RaidexSkeleton height={270} radius={20} />
      <RaidexSkeleton height={270} radius={20} />
    </View>
  );
}

const styles = StyleSheet.create({
  topPad: { paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  changePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, maxWidth: "62%" },
  locationPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, marginTop: 10, maxWidth: "100%" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: tokens.spacing.lg },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  filtersBtn: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterBadge: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  promptScroller: { paddingHorizontal: tokens.spacing.xl, gap: 8, paddingTop: tokens.spacing.md, paddingBottom: 8 },
  promptChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  liveStrip: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  liveDotSmall: { width: 7, height: 7, borderRadius: 99 },
  upcomingBanner: { borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, overflow: "hidden" },
  upcomingBannerImage: { width: 56, height: 56, borderRadius: 14 },
  upcomingStatusPill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  intentGrid: { flexDirection: "row", gap: tokens.spacing.md, paddingHorizontal: tokens.spacing.xl, marginTop: tokens.spacing.lg },
  intentImgCard: { flex: 1, borderRadius: 22, borderWidth: 1, overflow: "hidden", justifyContent: "flex-end" },
  intentIconWrap: { position: "absolute", top: 12, left: 12, width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  intentBadge: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  intentCardText: { padding: 14, paddingRight: 40 },
  intentChevron: { position: "absolute", right: 12, bottom: 14 },
  backCircle: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  intentSummaryPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  tripSummaryCard: { flexDirection: "row", alignItems: "stretch", borderRadius: 20, borderWidth: 1, padding: 16, marginTop: 18 },
  summaryLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  summaryDivider: { width: 34, alignItems: "center", marginHorizontal: 4 },
  durationPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, marginVertical: 6 },
  calendarCard: { borderRadius: 22, borderWidth: 1, padding: 14, marginTop: 20 },
  calendarNavRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  calendarNavBtn: { width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  weekdayRow: { flexDirection: "row", marginTop: 14 },
  weekdayLabel: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "800" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  calendarCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  calendarCellInner: { width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  timeSlot: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  continueBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: tokens.spacing.xl, paddingTop: 14, borderTopWidth: 1 },
  sheetHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  sheetLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  sheetChipRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  sheetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, borderBottomWidth: 1 },
  heroPanel: { borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  heroTop: { padding: 16, paddingBottom: 14 },
  heroTitle: { fontSize: 20, fontWeight: "900" },
  heroSubtitle: { fontSize: 12, marginTop: 3, fontWeight: "700" },
  heroRefresh: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  heroStatsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mapMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  statTile: { flex: 1, minHeight: 84, borderRadius: 16, borderWidth: 1, padding: 12, justifyContent: "center" },
  pickCard: { margin: 12, marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  pickImage: { width: 72, height: 64, borderRadius: 14 },
  pickBadgeRow: { flexDirection: "row" },
  pickBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  pointsCard: { borderRadius: 24, padding: tokens.spacing.xl, overflow: "hidden" },
  pointsEyebrow: { color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  pointsTier: { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 4 },
  pointsCopy: { color: "rgba(255,255,255,0.7)", marginTop: 6 },
  progressTrack: { height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, marginTop: 14, overflow: "hidden" },
  compareBar: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, padding: 12 },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
});
