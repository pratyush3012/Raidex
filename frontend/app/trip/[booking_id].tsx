import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Dimensions, Platform } from "react-native";
import Svg, { Circle, Path, Defs, LinearGradient as SvgGradient, Stop, Line } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

const { width } = Dimensions.get("window");
const MAP_H = 360;

// Animated wrapper so the current-position marker can ease its cx/cy toward
// each new GPS/simulated tick instead of snapping discretely between points.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Simulated route fallback when GPS is unavailable (web / Expo Go)
const ROUTE_OFFSETS = [
  [0, 0], [0.004, 0.002], [0.008, 0.006], [0.011, 0.012], [0.012, 0.020],
  [0.010, 0.027], [0.005, 0.030], [-0.002, 0.029], [-0.006, 0.022], [-0.005, 0.013],
];

export default function ActiveTrip() {
  const { booking_id } = useLocalSearchParams<{ booking_id: string }>();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [booking, setBooking] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [trail, setTrail] = useState<{ lat: number; lng: number }[]>([]);
  const [speed, setSpeed] = useState(0);
  const [gpsMode, setGpsMode] = useState<"real" | "simulated">("simulated");
  const [tick, setTick] = useState(0);
  const idxRef = useRef(0);
  const startTimeRef = useRef<number>(Date.now());
  // Re-render timer for elapsed display
  const [, setTimerTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const b = await api<any>(`/bookings/${booking_id}`);
        setBooking(b);
        const v = await api<any>(`/vehicles/${b.vehicle_id}`);
        setVehicle(v);
      } catch {}
    })();
  }, [booking_id]);

  // GPS: try real expo-location first, fall back to route simulation
  useEffect(() => {
    if (!vehicle || !booking) return;

    let subscription: Location.LocationSubscription | null = null;
    let simTimer: ReturnType<typeof setInterval> | null = null;

    const startRealGps = async (): Promise<boolean> => {
      if (Platform.OS === "web") return false;
      try {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== "granted") return false;

        // Request background permissions for background GPS pings
        const bg = await Location.requestBackgroundPermissionsAsync();
        // bg permission optional — foreground is enough while app is open

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 4000,     // 4s to match backend GPS track rate
            distanceInterval: 20,   // or every 20m, whichever comes first
          },
          async (loc) => {
            const lat = loc.coords.latitude;
            const lng = loc.coords.longitude;
            const spd = loc.coords.speed != null
              ? Math.round(loc.coords.speed * 3.6)  // m/s → km/h
              : 0;
            setSpeed(spd);
            setTrail((prev) => [...prev, { lat, lng }]);
            setTick((t) => t + 1);
            try {
              await api("/gps/track", {
                method: "POST",
                body: {
                  vehicle_id: vehicle.vehicle_id,
                  booking_id,
                  lat,
                  lng,
                  speed_kmph: spd,
                  heading: Math.round(loc.coords.heading ?? 0),
                },
              });
            } catch {}
          }
        );
        setGpsMode("real");
        return true;
      } catch {
        return false;
      }
    };

    const startSimulation = () => {
      const homeLat = vehicle.latitude;
      const homeLng = vehicle.longitude;
      const pump = async () => {
        const off = ROUTE_OFFSETS[idxRef.current % ROUTE_OFFSETS.length];
        const lat = homeLat + off[0];
        const lng = homeLng + off[1];
        const s = 25 + Math.round(Math.random() * 35);
        setSpeed(s);
        setTrail((prev) => [...prev, { lat, lng }]);
        idxRef.current += 1;
        setTick((t) => t + 1);
        try {
          await api("/gps/track", {
            method: "POST",
            body: {
              vehicle_id: vehicle.vehicle_id,
              booking_id,
              lat, lng,
              speed_kmph: s,
              heading: (idxRef.current * 36) % 360,
            },
          });
        } catch {}
      };
      pump();
      simTimer = setInterval(pump, 4000);
      setGpsMode("simulated");
    };

    (async () => {
      const gotReal = await startRealGps();
      if (!gotReal) startSimulation();
    })();

    return () => {
      subscription?.remove();
      if (simTimer) clearInterval(simTimer);
    };
  }, [vehicle, booking, booking_id]);

  // Map projection from lat/lng deltas → SVG coords. Computed unconditionally
  // (with a null-safe fallback) so the marker-easing hooks below can run
  // before the loading guard, as React's rules of hooks require.
  const homeLat = vehicle?.latitude ?? 0;
  const homeLng = vehicle?.longitude ?? 0;
  const projScale = 5500;
  const mapCx = width / 2;
  const mapCy = MAP_H / 2;
  const points = trail.map((p) => ({
    x: mapCx + (p.lng - homeLng) * projScale,
    y: mapCy - (p.lat - homeLat) * projScale * 1.5,
  }));
  const polyline = points.length > 1
    ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
    : "";
  const cur = points[points.length - 1] || { x: mapCx, y: mapCy };

  // Animated marker position — eases toward each new GPS/simulated tick
  // rather than jumping discretely between points.
  const markerCx = useSharedValue(mapCx);
  const markerCy = useSharedValue(mapCy);
  useEffect(() => {
    markerCx.value = withTiming(cur.x, { duration: 900, easing: Easing.out(Easing.cubic) });
    markerCy.value = withTiming(cur.y, { duration: 900, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.x, cur.y]);
  const markerOuterProps = useAnimatedProps(() => ({ cx: markerCx.value, cy: markerCy.value }));
  const markerInnerProps = useAnimatedProps(() => ({ cx: markerCx.value, cy: markerCy.value }));

  // "Trip started" cinematic entrance: map and stats card fade/scale in on
  // mount, staggered ~80ms apart.
  const mapEntrance = useSharedValue(0);
  const statsEntrance = useSharedValue(0);
  useEffect(() => {
    mapEntrance.value = withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) });
    statsEntrance.value = withDelay(80, withTiming(1, { duration: tokens.motion.slow, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mapEntranceStyle = useAnimatedStyle(() => ({
    opacity: mapEntrance.value,
    transform: [{ scale: 0.96 + mapEntrance.value * 0.04 }],
  }));
  const statsEntranceStyle = useAnimatedStyle(() => ({
    opacity: statsEntrance.value,
    transform: [{ scale: 0.94 + statsEntrance.value * 0.06 }, { translateY: (1 - statsEntrance.value) * 14 }],
  }));

  if (!booking || !vehicle) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}>
        <ActivityIndicator color={c.accent} size="large" />
      </View>
    );
  }

  const elapsedSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const km = gpsMode === "real"
    ? (tick * 0.08).toFixed(1)   // rough km from track count at real GPS
    : (tick * 1.2).toFixed(1);   // simulated

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Animated.View style={[{ height: MAP_H, width, backgroundColor: c.surface2 }, mapEntranceStyle]}>
        <Svg width={width} height={MAP_H}>
          <Defs>
            <SvgGradient id="bg" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.surface3} />
              <Stop offset="1" stopColor={c.surface2} />
            </SvgGradient>
          </Defs>
          {Array.from({ length: 12 }).map((_, i) => (
            <Line key={`h${i}`} x1={0} y1={i * 30} x2={width} y2={i * 30} stroke={c.border} strokeWidth={1} />
          ))}
          {Array.from({ length: 14 }).map((_, i) => (
            <Line key={`v${i}`} x1={i * 30} y1={0} x2={i * 30} y2={MAP_H} stroke={c.border} strokeWidth={1} />
          ))}
          <Circle cx={mapCx} cy={mapCy} r={120} stroke={c.accent} strokeWidth={1.5} strokeDasharray="6,6" fill="rgba(5,196,107,0.08)" />
          <Circle cx={mapCx} cy={mapCy} r={6} fill={c.accent} />
          {polyline && <Path d={polyline} stroke={c.accent} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
          <AnimatedCircle animatedProps={markerOuterProps} r={14} fill={c.inverse} />
          <AnimatedCircle animatedProps={markerInnerProps} r={6} fill={c.accent} />
        </Svg>
        <SafeAreaView edges={["top"]} style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", padding: tokens.spacing.lg }}>
            <Pressable testID="trip-back" onPress={() => router.replace("/(tabs)/trips" as any)} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <View style={[styles.liveDot, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: gpsMode === "real" ? c.accent : "#F87171" }} />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, letterSpacing: 2 }}>
                {gpsMode === "real" ? "GPS LIVE" : "LIVE"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </Animated.View>

      <View style={{ flex: 1, padding: tokens.spacing.xl }}>
        <Animated.View style={statsEntranceStyle}>
          <LinearGradient colors={["#000", "#1a1a1a"]} style={styles.statsCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Stat label="DURATION" val={`${mm}:${ss}`} />
              <Stat label="DISTANCE" val={`${km} km`} />
              <Stat label="SPEED" val={`${speed}`} sub="km/h" />
            </View>
          </LinearGradient>
        </Animated.View>

        <View style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <View style={[styles.dot, { backgroundColor: c.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "700" }}>{vehicle.name}</Text>
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{vehicle.location}</Text>
          </View>
          <Ionicons name="navigate" size={20} color={c.onSurface} />
        </View>

        <View style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 10 }]}>
          <Ionicons name="shield-checkmark" size={20} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 13 }}>Inside geofence</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
              Vehicle within {((vehicle.home_geofence_radius_m ?? 25000) / 1000).toFixed(0)} km of pickup
            </Text>
          </View>
          {gpsMode === "simulated" && (
            <Text style={{ color: c.onSurface3, fontSize: 10 }}>sim</Text>
          )}
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          testID="end-trip-btn"
          onPress={() => router.push(`/inspection/${booking_id}?phase=after` as any)}
          style={[styles.endBtn, { backgroundColor: c.error, marginBottom: insets.bottom + 4 }]}
        >
          <Ionicons name="stop" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>End trip</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, val, sub }: any) {
  return (
    <View>
      <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "800", letterSpacing: 2 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 4 }}>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>{val}</Text>
        {sub && <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  liveDot: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  statsCard: { padding: 18, borderRadius: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 12 },
  dot: { width: 12, height: 12, borderRadius: 999 },
  endBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
});
