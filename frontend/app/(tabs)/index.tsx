import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  FlatList, ActivityIndicator, RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

type Vehicle = {
  vehicle_id: string; type: "car" | "bike"; name: string; brand: string;
  image: string; price_per_day: number; price_per_hour: number; rating: number;
  trips: number; distance_km: number; location: string; fuel_type: string;
  transmission: string; seats: number;
};

const CATS = [
  { key: "all", label: "All", icon: "apps" as const },
  { key: "car", label: "Cars", icon: "car-sport" as const },
  { key: "bike", label: "Bikes", icon: "bicycle" as const },
  { key: "subscription", label: "Subs", icon: "calendar" as const },
  { key: "swap", label: "Swap", icon: "swap-horizontal" as const },
];

export default function HomeScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (cat === "car" || cat === "bike") params.set("type", cat);
      if (q.trim()) params.set("q", q.trim());
      const data = await api<Vehicle[]>(`/vehicles?${params.toString()}`);
      setItems(data);
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cat, q]);

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

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm }}>{greeting}</Text>
              <Text testID="home-greeting" style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: "800", marginTop: 2 }}>
                {user?.name?.split(" ")[0] || "Rider"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={[styles.pill, { backgroundColor: c.accentBg }]}>
                <Ionicons name="star" size={12} color={c.onAccentBg} />
                <Text style={{ color: c.onAccentBg, fontWeight: "700", fontSize: 12 }}>{user?.ride_miles ?? 0}</Text>
              </View>
              <Pressable testID="notif-btn" onPress={() => router.push("/notifications")}>
                <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.searchBox, { backgroundColor: c.surface2, borderColor: c.border, marginTop: tokens.spacing.lg }]}>
            <Ionicons name="search" size={18} color={c.onSurface3} />
            <TextInput
              testID="search-input"
              value={q}
              onChangeText={setQ}
              placeholder="Search cars, bikes, locations"
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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: tokens.spacing.xl, paddingVertical: tokens.spacing.sm, gap: 8 }}
          style={{ height: 56 }}
        >
          {CATS.map((it) => {
            const active = cat === it.key;
            return (
              <Pressable
                key={it.key}
                testID={`chip-${it.key}`}
                onPress={() => setCat(it.key)}
                style={[styles.chip, { backgroundColor: active ? c.inverse : c.surface2, borderColor: active ? c.inverse : c.border }]}
              >
                <Ionicons name={it.icon} size={14} color={active ? c.onInverse : c.onSurface2} />
                <Text style={{ color: active ? c.onInverse : c.onSurface, fontWeight: "600", fontSize: 13 }}>{it.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.vehicle_id}
          contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: insets.bottom + 80 }}
          ItemSeparatorComponent={() => <View style={{ height: tokens.spacing.lg }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
          ListHeaderComponent={
            <View style={{ marginBottom: tokens.spacing.lg }}>
              <LinearGradient
                colors={["#000", "#1a1a1a"]}
                style={{ borderRadius: 24, padding: tokens.spacing.xl, overflow: "hidden" }}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 2 }}>RIDEMILES TIER</Text>
                <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 }}>{user?.tier ?? "Silver"}</Text>
                <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 6 }}>
                  {user?.ride_miles ?? 0} miles · Earn more on every trip
                </Text>
                <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, marginTop: 14, overflow: "hidden" }}>
                  <View style={{ width: `${Math.min(100, ((user?.ride_miles ?? 0) / 1000) * 100)}%`, height: "100%", backgroundColor: "#05C46B" }} />
                </View>
              </LinearGradient>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 40 }}>
              <Ionicons name="car-outline" size={48} color={c.onSurface3} />
              <Text style={{ color: c.onSurface2, marginTop: 12, fontSize: 16 }}>No vehicles found</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`vehicle-card-${item.vehicle_id}`}
              onPress={() => router.push(`/vehicle/${item.vehicle_id}`)}
              style={[styles.card, { backgroundColor: c.surface2, borderColor: c.border }]}
            >
              <Image source={item.image} style={styles.cardImg} contentFit="cover" />
              <View style={{ padding: tokens.spacing.lg }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontSize: tokens.type.lg, fontWeight: "700" }} numberOfLines={1}>{item.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm, marginTop: 2 }}>{item.location}</Text>
                  </View>
                  <View style={[styles.ratingPill, { backgroundColor: c.surface }]}>
                    <Ionicons name="star" size={12} color="#F59E0B" />
                    <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 12 }}>{item.rating.toFixed(1)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  <Tag c={c}><Ionicons name="people" size={11} color={c.onSurface2} /><Text style={tagText(c)}>{item.seats}</Text></Tag>
                  <Tag c={c}><Ionicons name="speedometer" size={11} color={c.onSurface2} /><Text style={tagText(c)}>{item.transmission}</Text></Tag>
                  <Tag c={c}><Ionicons name="flash" size={11} color={c.onSurface2} /><Text style={tagText(c)}>{item.fuel_type}</Text></Tag>
                  <Tag c={c}><Ionicons name="location" size={11} color={c.onSurface2} /><Text style={tagText(c)}>{item.distance_km} km</Text></Tag>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: tokens.spacing.md, paddingTop: tokens.spacing.md, borderTopWidth: 1, borderTopColor: c.border }}>
                  <View>
                    <Text style={{ color: c.onSurface3, fontSize: 11 }}>per day</Text>
                    <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: "800" }}>₹{item.price_per_day.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.bookBtn, { backgroundColor: c.inverse }]}>
                    <Text style={{ color: c.onInverse, fontWeight: "700" }}>View</Text>
                    <Ionicons name="arrow-forward" size={14} color={c.onInverse} />
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function Tag({ children, c }: any) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: c.border }}>{children}</View>;
}
const tagText = (c: any) => ({ color: c.onSurface2, fontSize: 11, fontWeight: "600" as const });

const styles = StyleSheet.create({
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 36, flexShrink: 0 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  card: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  cardImg: { width: "100%", height: 180 },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  bookBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
});
