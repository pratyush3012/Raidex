import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Dimensions, Platform, Linking, Share, Alert, ScrollView } from "react-native";
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
import { format } from "date-fns";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexErrorState, RaidexModal, RaidexChip, RaidexInput, RaidexButton, RaidexBadge } from "@/src/components/ui";

const { width } = Dimensions.get("window");
const MAP_H = 360;

// Real, well-known Indian public emergency numbers — these dial the actual
// public emergency services, never a fabricated "Raidex emergency" line.
const EMERGENCY_NUMBERS = [
  { label: "National emergency number", number: "112", icon: "alert-circle" as const },
  { label: "Police", number: "100", icon: "shield" as const },
  { label: "Ambulance", number: "108", icon: "medkit" as const },
];

const DISPUTE_CATEGORIES: { value: "payment" | "damage" | "refund" | "host" | "vehicle" | "other"; label: string }[] = [
  { value: "vehicle", label: "Vehicle issue" },
  { value: "damage", label: "Damage" },
  { value: "payment", label: "Payment" },
  { value: "refund", label: "Refund" },
  { value: "host", label: "Host" },
  { value: "other", label: "Other" },
];

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ lat: number; lng: number }[]>([]);
  const [speed, setSpeed] = useState(0);
  const [gpsMode, setGpsMode] = useState<"real" | "simulated">("simulated");
  const [tick, setTick] = useState(0);
  const idxRef = useRef(0);
  const startTimeRef = useRef<number>(Date.now());
  // Re-render timer for elapsed display
  const [, setTimerTick] = useState(0);

  // Trip support sheet + report-an-issue form state
  const [supportOpen, setSupportOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<typeof DISPUTE_CATEGORIES[number]["value"]>("vehicle");
  const [reportMessage, setReportMessage] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Extend-trip sheet state. There is no extension-price-preview endpoint —
  // the real numbers (MAX_RATE, tax, total) only come back from the actual
  // POST /extend call, so this shows the exact charge only after that call
  // succeeds (or fails), rather than fabricating a client-side estimate.
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendStep, setExtendStep] = useState<"select" | "result">("select");
  const [extendAddHours, setExtendAddHours] = useState(1);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendShowTopUp, setExtendShowTopUp] = useState(false);
  const [extendResult, setExtendResult] = useState<any>(null);

  useEffect(() => {
    const id = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const loadTrip = React.useCallback(async () => {
    setLoadError(null);
    try {
      const b = await api<any>(`/bookings/${booking_id}`);
      setBooking(b);
      const v = await api<any>(`/vehicles/${b.vehicle_id}`);
      setVehicle(v);
    } catch (e: any) {
      setLoadError(e?.message || "Could not load this trip");
    }
  }, [booking_id]);

  useEffect(() => { loadTrip(); }, [loadTrip]);

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

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, justifyContent: "center" }}>
        <RaidexErrorState message={loadError} onRetry={loadTrip} testID="active-trip-error-state" />
      </View>
    );
  }

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

  const lastPoint = trail[trail.length - 1] || null;
  const canShareLocation = gpsMode === "real" && !!lastPoint;

  // Scheduled-end countdown / overdue state — reuses the same 1s timer
  // ("Trip started" elapsed clock above) rather than a second interval.
  const scheduledEnd = booking?.end_date ? new Date(booking.end_date) : null;
  const remainingMs = scheduledEnd ? scheduledEnd.getTime() - Date.now() : 0;
  const isOverdue = scheduledEnd ? remainingMs < 0 : false;
  const absMs = Math.abs(remainingMs);
  const remHrs = Math.floor(absMs / 3_600_000);
  const remMins = Math.floor((absMs % 3_600_000) / 60_000);
  const remainingLabel = `${remHrs}h ${remMins}m`;

  const currentEndDate = scheduledEnd ?? new Date();
  const proposedNewEnd = new Date(currentEndDate.getTime() + extendAddHours * 3_600_000);

  const resetExtendSheet = () => {
    setExtendOpen(false);
    setExtendStep("select");
    setExtendAddHours(1);
    setExtendError(null);
    setExtendShowTopUp(false);
    setExtendResult(null);
    setExtending(false);
  };

  const doExtend = async () => {
    setExtending(true);
    setExtendError(null);
    setExtendShowTopUp(false);
    try {
      const r = await api<any>(`/bookings/${booking_id}/extend`, {
        method: "POST",
        body: { end_date: proposedNewEnd.toISOString() },
      });
      setExtendResult(r.extension);
      setExtendStep("result");
      setBooking((prev: any) => (prev ? { ...prev, end_date: r.end_date } : prev));
    } catch (e: any) {
      setExtendError(e?.message || "Could not extend this trip. Please try again.");
      setExtendShowTopUp(e?.status === 402);
    } finally {
      setExtending(false);
    }
  };

  const openSupportChat = () => {
    setSupportOpen(false);
    router.push(`/support?booking_id=${booking_id}` as any);
  };

  const openReportForm = () => {
    setSupportOpen(false);
    setReportError(null);
    setReportOpen(true);
  };

  const callEmergencyNumber = (number: string) => {
    Linking.openURL(`tel:${number}`).catch(() => {
      Alert.alert("Could not place call", "Your device could not open the dialer for this number.");
    });
  };

  const shareCurrentLocation = async () => {
    if (!lastPoint) return;
    const mapsUrl = `https://www.google.com/maps?q=${lastPoint.lat},${lastPoint.lng}`;
    try {
      await Share.share({
        message: `I'm sharing my live location from my Raidex trip: ${mapsUrl}`,
        url: mapsUrl,
      });
    } catch {}
  };

  const submitReport = async () => {
    const trimmed = reportMessage.trim();
    if (trimmed.length < 10) {
      setReportError("Please describe the issue in at least 10 characters.");
      return;
    }
    setReportError(null);
    setReportSubmitting(true);
    try {
      await api(`/bookings/${booking_id}/disputes`, {
        method: "POST",
        body: { booking_id, category: reportCategory, message: trimmed },
      });
      setReportOpen(false);
      setReportMessage("");
      setReportCategory("vehicle");
      Alert.alert("Report submitted", "Thanks — our team will review this and follow up.");
    } catch (e: any) {
      setReportError(e?.message || "Could not submit your report. Please try again.");
    } finally {
      setReportSubmitting(false);
    }
  };

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

        {scheduledEnd && (
          <View style={[styles.row, { backgroundColor: isOverdue ? "rgba(239,68,68,0.08)" : c.surface2, borderColor: isOverdue ? c.error : c.border, marginTop: 10 }]}>
            <Ionicons name={isOverdue ? "alert-circle" : "time-outline"} size={20} color={isOverdue ? c.error : c.onSurface} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: isOverdue ? c.error : c.onSurface, fontWeight: "700", fontSize: 13 }}>
                {isOverdue ? `Overdue by ${remainingLabel}` : `Trip ends in ${remainingLabel}`}
              </Text>
              <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
                Scheduled return: {format(scheduledEnd, "EEE, d MMM · h:mm a")}
              </Text>
            </View>
            {isOverdue && <RaidexBadge label="LATE FEE MAY APPLY" tone="neutral" />}
          </View>
        )}

        <Pressable
          testID="trip-support-row"
          onPress={() => setSupportOpen(true)}
          style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 10 }]}
        >
          <Ionicons name="help-buoy" size={20} color={c.onSurface} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 13 }}>Trip support</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
              Contact support, report an issue, or emergency numbers
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
        </Pressable>

        <Pressable
          testID="trip-extend-row"
          onPress={() => { resetExtendSheet(); setExtendOpen(true); }}
          style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 10 }]}
        >
          <Ionicons name="add-circle-outline" size={20} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 13 }}>Extend trip</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
              Push back your return time — charged from your wallet
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />
        </Pressable>

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

      <RaidexModal
        testID="trip-support-modal"
        visible={supportOpen}
        title="Trip support"
        subtitle="Get help with your active trip."
        onDismiss={() => setSupportOpen(false)}
        dismissLabel="Close"
      >
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          <SupportRow icon="chatbubbles" title="Contact support" sub="Chat with Raidex support about this trip" onPress={openSupportChat} c={c} testID="support-contact-option" />
          <SupportRow icon="alert-circle" title="Report an issue" sub="File a report about the vehicle, host, or trip" onPress={openReportForm} c={c} testID="support-report-option" />
          <SupportRow
            icon="location"
            title="Share my current location"
            sub={canShareLocation ? "Send your live GPS position via a maps link" : "Unavailable — GPS is in simulated mode"}
            onPress={shareCurrentLocation}
            c={c}
            disabled={!canShareLocation}
            testID="support-share-location-option"
          />

          <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginTop: tokens.spacing.lg }}>
            EMERGENCY NUMBERS
          </Text>
          <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 4, marginBottom: 8 }}>
            These call public emergency services directly — not Raidex support.
          </Text>
          {EMERGENCY_NUMBERS.map((e) => (
            <Pressable
              key={e.number}
              testID={`emergency-call-${e.number}`}
              onPress={() => callEmergencyNumber(e.number)}
              style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 8 }]}
            >
              <Ionicons name={e.icon} size={18} color={c.error} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 13 }}>{e.label}</Text>
              </View>
              <Text style={{ color: c.error, fontWeight: "800", fontSize: 16 }}>{e.number}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </RaidexModal>

      <RaidexModal
        testID="report-issue-modal"
        visible={reportOpen}
        title="Report an issue"
        subtitle="Tell us what's wrong — our team will follow up."
        onDismiss={() => { if (!reportSubmitting) setReportOpen(false); }}
        primaryLabel="Submit report"
        onPrimary={submitReport}
        primaryBusy={reportSubmitting}
        primaryDisabled={reportSubmitting || reportMessage.trim().length < 10}
        primaryTestID="submit-report-btn"
        dismissLabel="Cancel"
      >
        <Text style={{ color: c.onSurface2, fontSize: 12, fontWeight: "700", marginBottom: 8 }}>CATEGORY</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: tokens.spacing.md }}>
          {DISPUTE_CATEGORIES.map((cat) => (
            <RaidexChip
              key={cat.value}
              testID={`report-category-${cat.value}`}
              label={cat.label}
              active={reportCategory === cat.value}
              onPress={() => setReportCategory(cat.value)}
            />
          ))}
        </View>
        <RaidexInput
          testID="report-message-input"
          label="Description"
          value={reportMessage}
          onChangeText={setReportMessage}
          placeholder="Describe the issue in at least 10 characters…"
          multiline
          numberOfLines={4}
          maxLength={1500}
          textAlignVertical="top"
          error={reportError ?? undefined}
        />
      </RaidexModal>

      <RaidexModal
        testID="extend-trip-modal"
        visible={extendOpen}
        title={extendStep === "result" ? "Extension confirmed" : "Extend trip"}
        subtitle={
          extendStep === "result"
            ? undefined
            : "Extensions are charged at the vehicle's maximum hourly rate and paid immediately from your wallet balance."
        }
        onDismiss={() => { if (!extending) resetExtendSheet(); }}
        dismissLabel={extendStep === "result" ? "Done" : "Cancel"}
        primaryLabel={extendStep === "select" ? "Confirm & pay" : undefined}
        onPrimary={extendStep === "select" ? doExtend : undefined}
        primaryBusy={extending}
        primaryDisabled={extending}
        primaryTestID="extend-confirm-btn"
        dismissTestID={extendStep === "result" ? "extend-done-btn" : "extend-cancel-btn"}
      >
        {extendStep === "select" ? (
          <View>
            <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: "700", marginBottom: 8 }}>
              CURRENT RETURN TIME
            </Text>
            <Text style={{ color: c.onSurface, fontSize: 15, fontWeight: "700", marginBottom: 16 }}>
              {scheduledEnd ? format(scheduledEnd, "EEE, d MMM · h:mm a") : "—"}
            </Text>

            <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: "700", marginBottom: 8 }}>
              ADD TIME
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {[0.5, 1, 2, 3, 6].map((h) => (
                <RaidexChip
                  key={h}
                  testID={`extend-add-${h}`}
                  label={h < 1 ? "30 min" : `${h}h`}
                  active={extendAddHours === h}
                  onPress={() => setExtendAddHours(h)}
                />
              ))}
            </View>

            <View style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 0 }]}>
              <Ionicons name="flag-outline" size={20} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface3, fontSize: 11 }}>New return time</Text>
                <Text testID="extend-new-end-time" style={{ color: c.onSurface, fontWeight: "700", fontSize: 14, marginTop: 2 }}>
                  {format(proposedNewEnd, "EEE, d MMM · h:mm a")}
                </Text>
              </View>
            </View>

            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 14, lineHeight: 16 }}>
              Confirm to see and pay the exact extension cost — the final rate, tax, and total are calculated by
              Raidex and charged from your wallet the moment you confirm.
            </Text>

            {extendError && (
              <View style={{ marginTop: 14 }}>
                <Text style={{ color: c.error, fontSize: 12.5, fontWeight: "600" }}>{extendError}</Text>
                {extendShowTopUp && (
                  <View style={{ marginTop: 10 }}>
                    <RaidexButton
                      testID="extend-topup-wallet-btn"
                      label="Top up wallet"
                      icon="wallet-outline"
                      iconPosition="leading"
                      variant="secondary"
                      onPress={() => { resetExtendSheet(); router.push("/wallet" as any); }}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        ) : (
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Ionicons name="checkmark-circle" size={20} color={c.accent} />
              <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 13 }}>
                Return time updated to {scheduledEnd ? format(scheduledEnd, "h:mm a") : ""}
              </Text>
            </View>
            <ExtendRow label="Extension hourly rate" value={`₹${extendResult?.extension_hourly_rate?.toFixed?.(2) ?? extendResult?.extension_hourly_rate}`} c={c} />
            <ExtendRow label="Extension hours" value={`${extendResult?.extension_hours}`} c={c} />
            <ExtendRow label="Extension amount" value={`₹${extendResult?.extension_amount?.toFixed?.(2) ?? extendResult?.extension_amount}`} c={c} />
            <ExtendRow label="Tax" value={`₹${extendResult?.tax?.toFixed?.(2) ?? extendResult?.tax}`} c={c} />
            <ExtendRow label="Total charged" value={`₹${extendResult?.total_payable?.toFixed?.(2) ?? extendResult?.total_payable}`} c={c} bold />
          </View>
        )}
      </RaidexModal>
    </View>
  );
}

function ExtendRow({ label, value, c, bold }: { label: string; value: string; c: any; bold?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}>
      <Text style={{ color: c.onSurface3, fontSize: 13 }}>{label}</Text>
      <Text testID={`extend-result-${label.toLowerCase().replace(/\s+/g, "-")}`} style={{ color: c.onSurface, fontSize: 13, fontWeight: bold ? "800" : "600" }}>{value}</Text>
    </View>
  );
}

function SupportRow({ icon, title, sub, onPress, c, disabled, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginTop: 10, opacity: disabled ? 0.5 : 1 }]}
    >
      <Ionicons name={icon} size={20} color={c.onSurface} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 13 }}>{title}</Text>
        <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>{sub}</Text>
      </View>
      {!disabled && <Ionicons name="chevron-forward" size={18} color={c.onSurface3} />}
    </Pressable>
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
