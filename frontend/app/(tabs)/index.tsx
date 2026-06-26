import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { WebView } from "react-native-webview";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { tokens, useTheme } from "@/src/theme";

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

const CATS = [
  { key: "all", label: "All", icon: "apps" as const },
  { key: "car", label: "Cars", icon: "car-sport" as const },
  { key: "bike", label: "Bikes", icon: "bicycle" as const },
  { key: "subscription", label: "Subs", icon: "calendar" as const },
  { key: "swap", label: "Swap", icon: "swap-horizontal" as const },
];

const SMART_PROMPTS = ["Bike under Rs 1000 near me", "EV within 5 km", "Cars for weekend trip"];

export default function HomeScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [price, setPrice] = useState<"any" | "1000" | "2500" | "5000">("any");
  const [distance, setDistance] = useState<"any" | "2" | "5" | "10">("any");
  const [fuel, setFuel] = useState<"any" | "EV" | "Petrol" | "Diesel">("any");
  const [sort, setSort] = useState<"distance" | "price" | "rating">("distance");
  const [discoveryMode, setDiscoveryMode] = useState<"map" | "list">("map");
  const [items, setItems] = useState<Vehicle[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const data = await api<Vehicle[]>(`/vehicles?${params.toString()}`, { cache: true });
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Could not load vehicles");
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cat, q, price, distance, fuel, sort]);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={styles.topPad}>
          <View style={styles.headerRow}>
            <View>
              <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm }}>{greeting}</Text>
              <Text testID="home-greeting" style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: "800", marginTop: 2 }}>
                {user?.name?.split(" ")[0] || "Rider"}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <View style={[styles.pill, { backgroundColor: c.accentBg }]}>
                <Ionicons name="star" size={12} color={c.onAccentBg} />
                <Text style={{ color: c.onAccentBg, fontWeight: "700", fontSize: 12 }}>{user?.ride_miles ?? 0}</Text>
              </View>
              <Pressable testID="notif-btn" onPress={() => router.push("/notifications")}>
                <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
              </Pressable>
            </View>
          </View>

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
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptScroller}>
          {SMART_PROMPTS.map((prompt) => (
            <Pressable key={prompt} onPress={() => setQ(prompt)} style={[styles.promptChip, { backgroundColor: c.accentBg }]}>
              <Ionicons name="sparkles" size={12} color={c.onAccentBg} />
              <Text style={{ color: c.onAccentBg, fontWeight: "700", fontSize: 12 }}>{prompt}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroller} style={{ height: 56 }}>
          {CATS.map((it) => {
            const active = cat === it.key;
            return (
              <Pressable key={it.key} testID={`chip-${it.key}`} onPress={() => setCat(it.key)}
                style={[styles.chip, { backgroundColor: active ? c.inverse : c.surface2, borderColor: active ? c.inverse : c.border }]}>
                <Ionicons name={it.icon} size={14} color={active ? c.onInverse : c.onSurface2} />
                <Text style={{ color: active ? c.onInverse : c.onSurface, fontWeight: "600", fontSize: 13 }}>{it.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroller}>
          <FilterPill c={c} label={price === "any" ? "Any price" : `Under Rs ${price}`} onPress={() => setPrice(price === "any" ? "1000" : price === "1000" ? "2500" : price === "2500" ? "5000" : "any")} />
          <FilterPill c={c} label={distance === "any" ? "Any distance" : `Within ${distance} km`} onPress={() => setDistance(distance === "any" ? "2" : distance === "2" ? "5" : distance === "5" ? "10" : "any")} />
          <FilterPill c={c} label={fuel === "any" ? "Any fuel" : fuel} onPress={() => setFuel(fuel === "any" ? "EV" : fuel === "EV" ? "Petrol" : fuel === "Petrol" ? "Diesel" : "any")} />
          <FilterPill c={c} label={`Sort: ${sort}`} onPress={() => setSort(sort === "distance" ? "price" : sort === "price" ? "rating" : "distance")} />
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
              <DiscoveryModeSwitch c={c} mode={discoveryMode} onChange={setDiscoveryMode} />
              {discoveryMode === "map" ? (
                <NearbyMap c={c} items={items} onRefresh={fetchData} onSelect={(vehicleId: string) => router.push(`/vehicle/${vehicleId}`)} />
              ) : (
                <NoMapDiscovery c={c} items={items} onRefresh={fetchData} />
              )}
              {compareIds.length > 0 && (
                <View style={[styles.compareBar, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", flex: 1 }}>{compareIds.length} selected for compare</Text>
                  <Pressable onPress={() => setCompareIds([])}><Text style={{ color: c.onSurface3, fontWeight: "700" }}>Clear</Text></Pressable>
                  <Pressable onPress={compareVehicles} style={[styles.smallBtn, { backgroundColor: c.inverse }]}>
                    <Text style={{ color: c.onInverse, fontWeight: "800" }}>Compare</Text>
                  </Pressable>
                </View>
              )}
              <LinearGradient colors={["#000", "#1a1a1a"]} style={styles.pointsCard}>
                <Text style={styles.pointsEyebrow}>RIDEX POINTS</Text>
                <Text style={styles.pointsTier}>{user?.tier ?? "Silver"}</Text>
                <Text style={styles.pointsCopy}>{user?.ride_miles ?? 0} points. Earn on rentals, referrals, reviews, and on-time returns.</Text>
                <View style={styles.progressTrack}>
                  <View style={{ width: `${Math.min(100, ((user?.ride_miles ?? 0) / 1000) * 100)}%`, height: "100%", backgroundColor: "#05C46B" }} />
                </View>
              </LinearGradient>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 40 }}>
              <Ionicons name={error ? "cloud-offline-outline" : "car-outline"} size={48} color={c.onSurface3} />
              <Text style={{ color: c.onSurface2, marginTop: 12, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
                {error ? "Could not load vehicles" : "No vehicles found"}
              </Text>
              <Text style={{ color: c.onSurface3, marginTop: 6, textAlign: "center" }}>{error || "Try another search or filter."}</Text>
              {error && (
                <Pressable onPress={fetchData} style={[styles.retryBtn, { backgroundColor: c.inverse }]}>
                  <Text style={{ color: c.onInverse, fontWeight: "800" }}>Retry</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable testID={`vehicle-card-${item.vehicle_id}`} onPress={() => router.push(`/vehicle/${item.vehicle_id}`)}
              style={[styles.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Image source={item.image} style={styles.cardImg} contentFit="cover" />
              <View style={{ padding: tokens.spacing.lg }}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontSize: tokens.type.lg, fontWeight: "800" }} numberOfLines={1}>{item.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm, marginTop: 2 }}>{item.location}</Text>
                  </View>
                  <View style={[styles.ratingPill, { backgroundColor: c.surface }]}>
                    <Ionicons name="star" size={12} color="#F59E0B" />
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 12 }}>{item.rating.toFixed(1)}</Text>
                  </View>
                </View>
                <View style={styles.tags}>
                  <Tag c={c} icon="people" text={String(item.seats)} />
                  <Tag c={c} icon="speedometer" text={item.transmission} />
                  <Tag c={c} icon="flash" text={item.fuel_type} />
                  <Tag c={c} icon="location" text={`${item.distance_km} km`} />
                  <Tag c={c} icon="shield-checkmark" text={`${item.trust_score ?? 92} trust`} />
                  {item.instant_book !== false && <Tag c={c} icon="flash-outline" text="Instant" />}
                </View>
                <View style={[styles.cardFooter, { borderTopColor: c.border }]}>
                  <View>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>per day</Text>
                    <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: "900" }}>Rs {item.price_per_day.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.bookBtn, { backgroundColor: c.inverse }]}>
                    <Text style={{ color: c.onInverse, fontWeight: "800" }}>View</Text>
                    <Ionicons name="arrow-forward" size={14} color={c.onInverse} />
                  </View>
                </View>
                <Pressable testID={`compare-${item.vehicle_id}`} onPress={() => toggleCompare(item.vehicle_id)}
                  style={[styles.compareSelect, { borderColor: compareIds.includes(item.vehicle_id) ? c.accent : c.border }]}>
                  <Ionicons name={compareIds.includes(item.vehicle_id) ? "checkbox" : "square-outline"} size={16} color={compareIds.includes(item.vehicle_id) ? c.accent : c.onSurface3} />
                  <Text style={{ color: c.onSurface2, fontWeight: "700", fontSize: 12 }}>Compare</Text>
                </Pressable>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function Tag({ c, icon, text }: { c: any; icon: any; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: c.border }}>
      <Ionicons name={icon} size={11} color={c.onSurface2} />
      <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

function FilterPill({ c, label, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={[styles.filterPill, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 12 }}>{label}</Text>
      <Ionicons name="chevron-down" size={12} color={c.onSurface3} />
    </Pressable>
  );
}

function DiscoveryModeSwitch({ c, mode, onChange }: { c: any; mode: "map" | "list"; onChange: (mode: "map" | "list") => void }) {
  return (
    <View style={[styles.modeSwitch, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <ModeButton c={c} active={mode === "map"} icon="map" label="Map" onPress={() => onChange("map")} />
      <ModeButton c={c} active={mode === "list"} icon="list" label="List" onPress={() => onChange("list")} />
    </View>
  );
}

function ModeButton({ c, active, icon, label, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, { backgroundColor: active ? c.inverse : "transparent" }]}>
      <Ionicons name={icon} size={15} color={active ? c.onInverse : c.onSurface2} />
      <Text style={{ color: active ? c.onInverse : c.onSurface2, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function NearbyMap({ c, items, onRefresh, onSelect }: any) {
  const [mapFailed, setMapFailed] = useState(false);
  const centerLat = items.length ? items.reduce((sum: number, v: Vehicle) => sum + v.latitude, 0) / items.length : 19.076;
  const centerLng = items.length ? items.reduce((sum: number, v: Vehicle) => sum + v.longitude, 0) / items.length : 72.8777;
  const html = useMemo(() => mapLibreHtml(items.slice(0, 60), centerLat, centerLng), [items, centerLat, centerLng]);
  return (
    <View style={[styles.mapWrap, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <View style={styles.mapHeader}>
        <View>
          <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "900" }}>MapLibre discovery</Text>
          <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>Free OpenStreetMap tiles with live vehicle markers</Text>
        </View>
        <Pressable testID="map-refresh" onPress={onRefresh} style={[styles.mapRefresh, { backgroundColor: c.surface }]}>
          <Ionicons name="refresh" size={18} color={c.onSurface} />
        </Pressable>
      </View>
      {Platform.OS === "web" || mapFailed ? (
        <FallbackMap c={c} items={items} centerLat={centerLat} centerLng={centerLng} onSelect={onSelect} />
      ) : (
        <WebView
          testID="maplibre-webview"
          originWhitelist={["*"]}
          source={{ html }}
          style={styles.mapCanvas}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          onError={() => setMapFailed(true)}
          onHttpError={() => setMapFailed(true)}
          onMessage={(event) => {
            const vehicleId = event.nativeEvent.data;
            if (vehicleId === "__MAP_FAILED__") {
              setMapFailed(true);
              return;
            }
            if (vehicleId) onSelect(vehicleId);
          }}
        />
      )}
    </View>
  );
}

function mapLibreHtml(items: Vehicle[], centerLat: number, centerLng: number) {
  const safeItems = JSON.stringify(items.map((item) => ({
    id: item.vehicle_id,
    type: item.type,
    name: item.name,
    price: item.price_per_day,
    rating: item.rating,
    distance: item.distance_km,
    available: item.available !== false,
    lat: Number(item.latitude),
    lng: Number(item.longitude),
  }))).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; overflow: hidden; background: #eef2f0; }
    .marker {
      border: 2px solid #fff;
      border-radius: 999px;
      box-shadow: 0 8px 20px rgba(0,0,0,.22);
      color: #fff;
      cursor: pointer;
      font: 800 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 6px 8px;
      white-space: nowrap;
    }
    .marker.available { background: #050505; }
    .marker.unavailable { background: #777; }
    .user-dot {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: #05C46B;
      border: 3px solid #fff;
      box-shadow: 0 0 0 9px rgba(5,196,107,.18);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    window.onerror = () => window.ReactNativeWebView?.postMessage("__MAP_FAILED__");
    setTimeout(() => {
      if (!window.maplibregl) window.ReactNativeWebView?.postMessage("__MAP_FAILED__");
    }, 3500);
    const vehicles = ${safeItems};
    const center = [${Number(centerLng).toFixed(6)}, ${Number(centerLat).toFixed(6)}];
    const map = new maplibregl.Map({
      container: "map",
      center,
      zoom: 11,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "OpenStreetMap"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      }
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    const userDot = document.createElement("div");
    userDot.className = "user-dot";
    new maplibregl.Marker({ element: userDot }).setLngLat(center).addTo(map);
    vehicles.forEach((vehicle) => {
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lng)) return;
      const el = document.createElement("button");
      el.className = "marker " + (vehicle.available ? "available" : "unavailable");
      el.textContent = (vehicle.type === "bike" ? "B" : "C") + " · " + Math.round(vehicle.price / 1000) + "k";
      el.onclick = () => window.ReactNativeWebView?.postMessage(vehicle.id);
      const popup = new maplibregl.Popup({ offset: 18 }).setHTML(
        "<strong>" + vehicle.name + "</strong><br/>Rs " + vehicle.price + "/day · " + vehicle.rating.toFixed(1) + " rating · " + vehicle.distance + " km"
      );
      new maplibregl.Marker({ element: el }).setLngLat([vehicle.lng, vehicle.lat]).setPopup(popup).addTo(map);
    });
  </script>
</body>
</html>`;
}

function NoMapDiscovery({ c, items, onRefresh }: any) {
  const available = items.filter((item: Vehicle) => item.available !== false).length;
  const nearest = items.length ? Math.min(...items.map((item: Vehicle) => Number(item.distance_km) || 999)) : 0;
  const bestPrice = items.length ? Math.min(...items.map((item: Vehicle) => Number(item.price_per_day) || 999999)) : 0;

  return (
    <View style={[styles.noMapPanel, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <View style={styles.mapHeader}>
        <View>
          <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "900" }}>List-first discovery</Text>
          <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>No map needed. Compare nearby vehicles by distance, price, and trust.</Text>
        </View>
        <Pressable testID="list-refresh" onPress={onRefresh} style={[styles.mapRefresh, { backgroundColor: c.surface }]}>
          <Ionicons name="refresh" size={18} color={c.onSurface} />
        </Pressable>
      </View>
      <View style={styles.noMapStats}>
        <StatTile c={c} icon="car-sport" label="Available" value={String(available)} />
        <StatTile c={c} icon="navigate" label="Nearest" value={items.length ? `${nearest} km` : "-"} />
        <StatTile c={c} icon="cash" label="From" value={items.length ? `Rs ${bestPrice.toLocaleString()}` : "-"} />
      </View>
    </View>
  );
}

function StatTile({ c, icon, label, value }: any) {
  return (
    <View style={[styles.statTile, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Ionicons name={icon} size={18} color={c.accent} />
      <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "900", marginTop: 6 }}>{value}</Text>
      <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: "700", marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function FallbackMap({ c, items, centerLat, centerLng, onSelect }: any) {
  return (
    <View style={[styles.mapCanvas, { backgroundColor: c.surface }]}>
      {Array.from({ length: 5 }).map((_, i) => <View key={`h${i}`} style={[styles.mapGridH, { top: `${(i + 1) * 16}%`, backgroundColor: c.border }]} />)}
      {Array.from({ length: 5 }).map((_, i) => <View key={`v${i}`} style={[styles.mapGridV, { left: `${(i + 1) * 16}%`, backgroundColor: c.border }]} />)}
      <View style={[styles.userDot, { backgroundColor: c.accent }]} />
      {items.slice(0, 18).map((item: Vehicle) => {
        const left = Math.max(8, Math.min(88, 50 + (item.longitude - centerLng) * 900));
        const top = Math.max(10, Math.min(82, 50 - (item.latitude - centerLat) * 1300));
        return (
          <Pressable key={item.vehicle_id} onPress={() => onSelect(item.vehicle_id)}
            style={[styles.marker, { left: `${left}%`, top: `${top}%`, backgroundColor: item.available === false ? c.surface3 : c.inverse }]}>
            <Ionicons name={item.type === "bike" ? "bicycle" : "car-sport"} size={14} color={item.available === false ? c.onSurface3 : c.onInverse} />
          </Pressable>
        );
      })}
    </View>
  );
}

function DiscoverySkeleton({ c }: any) {
  return (
    <View style={{ padding: tokens.spacing.xl, gap: 14 }}>
      <View style={[styles.skeletonMap, { backgroundColor: c.surface2 }]} />
      <View style={[styles.skeletonLine, { backgroundColor: c.surface2, width: "70%" }]} />
      <View style={[styles.skeletonCard, { backgroundColor: c.surface2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  topPad: { paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginTop: tokens.spacing.lg },
  promptScroller: { paddingHorizontal: tokens.spacing.xl, gap: 8, paddingBottom: 8 },
  promptChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  chipScroller: { paddingHorizontal: tokens.spacing.xl, paddingVertical: tokens.spacing.sm, gap: 8 },
  filterScroller: { paddingHorizontal: tokens.spacing.xl, gap: 8, paddingBottom: tokens.spacing.md },
  filterPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 36, flexShrink: 0 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  modeSwitch: { flexDirection: "row", borderRadius: 16, borderWidth: 1, padding: 4 },
  modeButton: { flex: 1, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  mapWrap: { borderRadius: 22, borderWidth: 1, padding: 14 },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  mapCanvas: { height: 240, borderRadius: 18, overflow: "hidden", position: "relative" },
  mapGridH: { position: "absolute", left: 0, right: 0, height: 1, opacity: 0.75 },
  mapGridV: { position: "absolute", top: 0, bottom: 0, width: 1, opacity: 0.75 },
  mapRefresh: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  userDot: { position: "absolute", left: "48%", top: "48%", width: 16, height: 16, borderRadius: 999, borderWidth: 3, borderColor: "#fff" },
  marker: { position: "absolute", width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  noMapPanel: { borderRadius: 22, borderWidth: 1, padding: 14 },
  noMapStats: { flexDirection: "row", gap: 10 },
  statTile: { flex: 1, minHeight: 92, borderRadius: 16, borderWidth: 1, padding: 12, justifyContent: "center" },
  pointsCard: { borderRadius: 24, padding: tokens.spacing.xl, overflow: "hidden" },
  pointsEyebrow: { color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  pointsTier: { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 4 },
  pointsCopy: { color: "rgba(255,255,255,0.7)", marginTop: 6 },
  progressTrack: { height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, marginTop: 14, overflow: "hidden" },
  compareBar: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, padding: 12 },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  card: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  cardImg: { width: "100%", height: 180 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: tokens.spacing.md, paddingTop: tokens.spacing.md, borderTopWidth: 1 },
  bookBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  compareSelect: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginTop: 12 },
  retryBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, marginTop: 16 },
  skeletonMap: { height: 260, borderRadius: 22 },
  skeletonLine: { height: 18, borderRadius: 999 },
  skeletonCard: { height: 270, borderRadius: 20 },
});
