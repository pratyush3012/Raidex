import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Modal, Platform } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { format } from "date-fns";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexButton, RaidexChip, RaidexInput, RaidexModal } from "@/src/components/ui";

type Phase = "before" | "after";
const ANGLES = [
  { key: "front", label: "Front" }, { key: "back", label: "Back" },
  { key: "left", label: "Left" }, { key: "right", label: "Right" },
  { key: "dashboard", label: "Dashboard" }, { key: "odometer", label: "Odometer" },
];
const FUELS = [
  { key: "empty", label: "E" }, { key: "quarter", label: "¼" },
  { key: "half", label: "½" }, { key: "threequarter", label: "¾" },
  { key: "full", label: "F" },
];

/**
 * On a native build: opens the camera directly (real capture).
 * On web / Expo Go: falls back to the photo library.
 * Always returns a base64 data URI or null.
 */
async function captureOrPickImg(): Promise<string | null> {
  // Native build — prefer camera
  if (Platform.OS !== "web") {
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (camPerm.status === "granted") {
      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.5,
        allowsEditing: false,
      });
      if (!r.canceled && r.assets?.[0]?.base64) {
        return `data:image/jpeg;base64,${r.assets[0].base64}`;
      }
      // User cancelled camera — fall through to library
    }
  }

  // Web or camera cancelled — use photo library
  const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (libPerm.status !== "granted") {
    Alert.alert("Permission required", "Allow camera or photo library access to capture vehicle photos.");
    return null;
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    base64: true,
    quality: 0.5,
  });
  if (r.canceled || !r.assets?.[0]?.base64) return null;
  return `data:image/jpeg;base64,${r.assets[0].base64}`;
}

type LateFee = {
  billable_hours: number;
  original_hourly_rate: number;
  late_fee_multiplier: number;
  late_fee: number;
  host_share: number;
  platform_share: number;
} | null;

type CompletionData = { distance_km: number; miles_earned: number; ai_verdict: string; late_fee?: LateFee };

// What GET /bookings/{id}/early-checkin-preview returns.
type EarlyPreview = {
  is_early: boolean;
  billable_hours: number;
  within_grace: boolean;
  charge: number;
  host_share: number;
  platform_share: number;
  policy: "not_allowed" | "free_only" | "paid_allowed";
  allowed: boolean;
  original_hourly_rate?: number;
};

export default function Inspection() {
  const { booking_id, phase: ph } = useLocalSearchParams<{ booking_id: string; phase: Phase }>();
  const phase: Phase = (ph as Phase) || "before";
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<Record<string, string | null>>({ front: null, back: null, left: null, right: null, dashboard: null, odometer: null });
  const [odo, setOdo] = useState("");
  const [fuel, setFuel] = useState<string>("half");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [completion, setCompletion] = useState<CompletionData | null>(null);

  // Early check-in: only relevant on the before-trip inspection, and only
  // when the customer has shown up ahead of the scheduled pickup time.
  const [booking, setBooking] = useState<any>(null);
  const [earlyPreview, setEarlyPreview] = useState<EarlyPreview | null>(null);
  const [earlyConfirmOpen, setEarlyConfirmOpen] = useState(false);
  const [earlyConfirmed, setEarlyConfirmed] = useState(false);

  useEffect(() => {
    if (phase !== "before") return;
    (async () => {
      try {
        const b = await api<any>(`/bookings/${booking_id}`);
        setBooking(b);
        const scheduledStart = b?.start_date ? new Date(b.start_date) : null;
        if (scheduledStart && scheduledStart.getTime() > Date.now()) {
          const preview = await api<EarlyPreview>(`/bookings/${booking_id}/early-checkin-preview`);
          setEarlyPreview(preview);
        }
      } catch {
        // Non-fatal — if this fails, the flow just proceeds as a normal
        // (non-early) pickup and /start enforces the real rules server-side.
      }
    })();
  }, [phase, booking_id]);

  const capturedCount = Object.values(photos).filter(Boolean).length;
  const allReq = capturedCount >= 4 && odo && parseFloat(odo) > 0;

  // Pop the "N/6 photos" counter whenever it changes, so a capture reads as
  // progress rather than the number just silently updating.
  const counterScale = useSharedValue(1);
  const prevCount = useRef(capturedCount);
  useEffect(() => {
    if (capturedCount !== prevCount.current) {
      counterScale.value = withSequence(
        withTiming(1.25, { duration: 120, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) })
      );
      prevCount.current = capturedCount;
    }
  }, [capturedCount, counterScale]);
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ scale: counterScale.value }] }));

  const takePhoto = async (key: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const uri = await captureOrPickImg();
    if (uri) {
      setPhotos((prev) => ({ ...prev, [key]: uri }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // Beyond the free grace period, with the host not opting into paid early
  // pickup: the host's policy simply doesn't allow starting early at all —
  // don't offer it, block the submit button, and let the customer proceed
  // normally once the scheduled pickup time arrives.
  const earlyBeyondGraceBlocked =
    phase === "before" && !!earlyPreview?.is_early && !earlyPreview.within_grace && earlyPreview.policy !== "paid_allowed";
  // Beyond grace, but the host allows paid early pickup: real charge, real
  // confirmation required before /start is ever called.
  const earlyPaidRequiresConfirm =
    phase === "before" && !!earlyPreview?.is_early && !earlyPreview.within_grace && earlyPreview.policy === "paid_allowed" && !earlyConfirmed;

  const submit = async () => {
    if (!allReq) { Alert.alert("Incomplete", "Capture at least 4 angles and enter odometer."); return; }
    if (earlyBeyondGraceBlocked) return;
    if (earlyPaidRequiresConfirm) { setEarlyConfirmOpen(true); return; }
    await doSubmit();
  };

  const doSubmit = async () => {
    setBusy(true);
    try {
      await api("/inspections", {
        method: "POST",
        body: {
          booking_id, phase,
          photo_front: photos.front || "", photo_back: photos.back || "",
          photo_left: photos.left || "", photo_right: photos.right || "",
          photo_dashboard: photos.dashboard || "", photo_odometer: photos.odometer || "",
          video_url: "", odometer_value: parseFloat(odo), fuel_level: fuel as any, notes,
        },
      });
      if (phase === "before") {
        try {
          await api(`/bookings/${booking_id}/start`, { method: "POST" });
          router.replace(`/trip/${booking_id}` as any);
        } catch (e: any) {
          // The inspection is already recorded — only the early-checkin
          // authorization/charge failed, e.g. the situation changed between
          // the preview and this confirm (host policy, or wallet balance).
          if (e?.status === 403) {
            Alert.alert("Early pickup not allowed", e.message || "This vehicle's host does not allow early pickup right now.");
          } else if (e?.status === 402) {
            Alert.alert(
              "Insufficient wallet balance",
              e.message || "Your wallet balance can't cover the early pickup charge.",
              [
                { text: "Top up wallet", onPress: () => router.push("/wallet" as any) },
                { text: "Cancel", style: "cancel" },
              ]
            );
          } else {
            Alert.alert("Could not start trip", e?.message || "Please try again.");
          }
        }
      } else {
        const r = await api<any>(`/bookings/${booking_id}/end`, { method: "POST" });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCompletion({ distance_km: r.distance_km, miles_earned: r.miles_earned, ai_verdict: r.ai_verdict, late_fee: r.late_fee ?? null });
      }
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg }}>
          <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <View style={{ marginLeft: 8 }}>
            <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: "700", letterSpacing: 2 }}>{phase.toUpperCase()} TRIP</Text>
            <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: "800" }}>Inspection</Text>
          </View>
          <Animated.View style={[{ marginLeft: "auto", alignItems: "center" }, counterStyle]}>
            <Text style={{ color: c.accent, fontSize: 22, fontWeight: "900" }}>{capturedCount}/6</Text>
            <Text style={{ color: c.onSurface3, fontSize: 10 }}>photos</Text>
          </Animated.View>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: insets.bottom + 100 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: c.accentBg, marginBottom: 16 }}>
          <Ionicons name={Platform.OS !== "web" ? "camera" : "information-circle"} size={16} color={c.onAccentBg} />
          <Text style={{ color: c.onAccentBg, fontSize: 12, flex: 1 }}>
            {Platform.OS !== "web"
              ? "Tap any tile to open the camera. All 6 angles help AI detect damage accurately."
              : "Upload at least 4 angles. AI uses these to detect damage between rental phases."}
          </Text>
        </View>

        {phase === "before" && earlyPreview?.is_early && (() => {
          const scheduledStart = booking?.start_date ? new Date(booking.start_date) : null;
          const earlyMs = scheduledStart ? Math.max(0, scheduledStart.getTime() - Date.now()) : 0;
          const earlyH = Math.floor(earlyMs / 3_600_000);
          const earlyM = Math.floor((earlyMs % 3_600_000) / 60_000);
          const earlyLabel = `${earlyH}h ${earlyM}m`;

          if (earlyPreview.within_grace) {
            return (
              <View testID="early-checkin-free-banner" style={[styles.banner, { backgroundColor: c.accentBg }]}>
                <Ionicons name="time-outline" size={16} color={c.onAccentBg} />
                <Text style={{ color: c.onAccentBg, fontSize: 12, flex: 1 }}>
                  Early pickup available (free, {earlyLabel} early)
                </Text>
              </View>
            );
          }
          if (earlyPreview.policy === "paid_allowed") {
            return (
              <View testID="early-checkin-paid-banner" style={[styles.banner, { backgroundColor: "rgba(240,184,76,0.14)" }]}>
                <Ionicons name="alert-circle-outline" size={16} color={c.warning} />
                <Text style={{ color: c.onSurface, fontSize: 12, flex: 1 }}>
                  You're {earlyLabel} early — starting now costs a one-time charge of{" "}
                  <Text style={{ fontWeight: "800" }}>₹{earlyPreview.charge.toFixed(2)}</Text>, billed from your wallet.
                  You'll be asked to confirm before starting.
                </Text>
              </View>
            );
          }
          return (
            <View testID="early-checkin-blocked-banner" style={[styles.banner, { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }]}>
              <Ionicons name="lock-closed-outline" size={16} color={c.onSurface3} />
              <Text style={{ color: c.onSurface2, fontSize: 12, flex: 1 }}>
                Early pickup isn't available for this vehicle. Your scheduled pickup is{" "}
                {scheduledStart ? format(scheduledStart, "h:mm a") : "later"} — please come back then to start your trip.
              </Text>
            </View>
          );
        })()}

        <Text style={[styles.h, { color: c.onSurface }]}>Photos</Text>
        <View style={styles.grid}>
          {ANGLES.map((a) => (
            <PhotoTile
              key={a.key}
              testID={`photo-${a.key}`}
              uri={photos[a.key]}
              label={a.label}
              onPress={() => takePhoto(a.key)}
              c={c}
            />
          ))}
        </View>
        <RaidexInput
          testID="odometer-input"
          label="Odometer (km)"
          icon="speedometer-outline"
          value={odo}
          onChangeText={setOdo}
          placeholder="12345"
          keyboardType="numeric"
        />
        <Text style={[styles.h, { color: c.onSurface, marginTop: 4 }]}>Fuel level</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: tokens.spacing.md }}>
          {FUELS.map((f) => (
            <RaidexChip
              key={f.key}
              testID={`fuel-${f.key}`}
              label={f.label}
              active={fuel === f.key}
              onPress={() => setFuel(f.key)}
            />
          ))}
        </View>
        <RaidexInput
          testID="notes-input"
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          placeholder="Any pre-existing scratches or damage?"
        />
        <View style={{ marginTop: 12 }}>
          <RaidexButton
            testID="submit-inspection"
            label={phase === "before" ? "Submit & Start trip" : "Submit & End trip"}
            icon={phase === "before" ? "play" : "stop"}
            iconPosition="leading"
            loading={busy}
            disabled={!allReq || earlyBeyondGraceBlocked}
            onPress={submit}
          />
        </View>
      </ScrollView>

      <RaidexModal
        testID="early-checkin-confirm-modal"
        visible={earlyConfirmOpen}
        title="Confirm early pickup charge"
        subtitle="This vehicle's host allows early pickup for a fee, charged immediately from your wallet."
        onDismiss={() => setEarlyConfirmOpen(false)}
        primaryLabel={`Confirm & pay ₹${earlyPreview?.charge?.toFixed?.(2) ?? "0.00"}`}
        onPrimary={() => {
          setEarlyConfirmed(true);
          setEarlyConfirmOpen(false);
          doSubmit();
        }}
        primaryTestID="early-checkin-confirm-btn"
        dismissTestID="early-checkin-cancel-btn"
      >
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.onSurface3, fontSize: 13 }}>Early hours</Text>
            <Text style={{ color: c.onSurface, fontSize: 13, fontWeight: "700" }}>{earlyPreview?.billable_hours}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.onSurface3, fontSize: 13 }}>Rate</Text>
            <Text style={{ color: c.onSurface, fontSize: 13, fontWeight: "700" }}>₹{earlyPreview?.original_hourly_rate?.toFixed?.(2)}/hr</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
            <Text style={{ color: c.onSurface3, fontSize: 13 }}>Total charge</Text>
            <Text style={{ color: c.onSurface, fontSize: 14, fontWeight: "800" }}>₹{earlyPreview?.charge?.toFixed?.(2)}</Text>
          </View>
        </View>
      </RaidexModal>

      <TripCompletionReveal
        visible={!!completion}
        data={completion}
        c={c}
        onDone={() => {
          setCompletion(null);
          router.replace("/(tabs)/trips" as any);
        }}
      />
    </View>
  );
}

// A single capture tile. Owns its own scale-pop animation so a landed photo
// reads as instant, tactile feedback rather than the image just appearing.
function PhotoTile({
  testID,
  uri,
  label,
  onPress,
  c,
}: {
  testID: string;
  uri: string | null;
  label: string;
  onPress: () => void;
  c: any;
}) {
  const scale = useSharedValue(1);
  const prevUri = useRef<string | null>(uri);
  useEffect(() => {
    if (uri && uri !== prevUri.current) {
      scale.value = withSequence(
        withTiming(1.12, { duration: 140, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) })
      );
    }
    prevUri.current = uri;
  }, [uri, scale]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.tile, { backgroundColor: c.surface2, borderColor: uri ? c.accent : c.border }]}
    >
      <Animated.View style={[{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }, animatedStyle]}>
        {uri ? (
          <>
            <Image source={uri} style={{ width: "100%", height: "100%", borderRadius: 10 }} contentFit="cover" />
            <View style={{ position: "absolute", bottom: 4, right: 4, backgroundColor: c.accent, borderRadius: 999, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="checkmark" size={12} color="#fff" />
            </View>
          </>
        ) : (
          <View style={{ alignItems: "center" }}>
            <Ionicons name={Platform.OS !== "web" ? "camera" : "cloud-upload"} size={22} color={c.onSurface3} />
            <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: "700", marginTop: 4 }}>{label}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

// A single confetti particle - flies outward from the celebration badge and
// fades as `progress` runs 0 -> 1.
function ConfettiParticle({ progress, angle, color }: { progress: Animated.SharedValue<number>; angle: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const dist = progress.value * 60;
    const rad = (angle * Math.PI) / 180;
    return {
      opacity: 1 - progress.value,
      transform: [
        { translateX: Math.cos(rad) * dist },
        { translateY: Math.sin(rad) * dist - progress.value * 18 },
        { scale: 1 - progress.value * 0.35 },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        { position: "absolute", top: "50%", left: "50%", width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: 4, backgroundColor: color },
        style,
      ]}
    />
  );
}

// In-app trip-completion reveal - replaces the old OS-level Alert with a
// polished, dismissable moment showing distance + RideMiles earned, per the
// brief's "trip completion" signature-moment request. Shows exactly the same
// data the previous Alert did (distance_km / miles_earned / ai_verdict from
// the /bookings/{id}/end response) and dismissal still routes to the trips
// tab - only the presentation changed.
function TripCompletionReveal({
  visible,
  data,
  c,
  onDone,
}: {
  visible: boolean;
  data: CompletionData | null;
  c: any;
  onDone: () => void;
}) {
  const badgeScale = useSharedValue(0.4);
  const contentReveal = useSharedValue(0);
  const celebrate = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      badgeScale.value = withSequence(
        withTiming(1.15, { duration: 260, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) })
      );
      contentReveal.value = withDelay(120, withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) }));
      celebrate.value = 0;
      celebrate.value = withDelay(80, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
    } else {
      badgeScale.value = 0.4;
      contentReveal.value = 0;
      celebrate.value = 0;
    }
  }, [visible, badgeScale, contentReveal, celebrate]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value }] }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentReveal.value,
    transform: [{ translateY: (1 - contentReveal.value) * 16 }],
  }));

  const particleColors = [c.accent, c.warning, c.accent, c.onSurface3, c.warning, c.accent, c.onSurface3, c.accent];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone} testID="trip-completion-modal">
      <View style={{ flex: 1, backgroundColor: c.overlay, alignItems: "center", justifyContent: "center", padding: tokens.spacing.xl }}>
        <View style={{ backgroundColor: c.surface, borderRadius: tokens.radius.xl, padding: tokens.spacing.xl, width: "100%", alignItems: "center" }}>
          <View style={{ width: 88, height: 88, alignItems: "center", justifyContent: "center" }}>
            {particleColors.map((color, i) => (
              <ConfettiParticle key={i} progress={celebrate} angle={(360 / particleColors.length) * i} color={color} />
            ))}
            <Animated.View
              style={[
                { width: 72, height: 72, borderRadius: 999, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
                badgeStyle,
              ]}
            >
              <Ionicons name="checkmark-circle" size={44} color={c.accent} />
            </Animated.View>
          </View>

          <Animated.View style={[{ alignItems: "center", width: "100%" }, contentStyle]}>
            <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: tokens.weight.bold, letterSpacing: 2, marginTop: 14 }}>
              TRIP COMPLETED
            </Text>
            <View style={{ flexDirection: "row", gap: 32, marginTop: 18 }}>
              <View style={{ alignItems: "center" }}>
                <Text testID="completion-distance" style={{ color: c.onSurface, fontSize: 28, fontWeight: tokens.weight.black }}>
                  {data?.distance_km ?? 0}
                </Text>
                <Text style={{ color: c.onSurface3, fontSize: 12 }}>km driven</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text testID="completion-miles" style={{ color: c.accent, fontSize: 28, fontWeight: tokens.weight.black }}>
                  +{data?.miles_earned ?? 0}
                </Text>
                <Text style={{ color: c.onSurface3, fontSize: 12 }}>RideMiles</Text>
              </View>
            </View>
            {!!data?.ai_verdict && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface2, borderRadius: tokens.radius.md, padding: 12, marginTop: 20, width: "100%" }}>
                <Ionicons name="sparkles" size={16} color={c.accent} />
                <Text testID="completion-ai-verdict" style={{ color: c.onSurface2, fontSize: 13, flex: 1 }}>AI: {data.ai_verdict}</Text>
              </View>
            )}
            {!!data?.late_fee && (
              <View testID="completion-late-fee" style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "rgba(240,184,76,0.14)", borderRadius: tokens.radius.md, padding: 12, marginTop: 12, width: "100%" }}>
                <Ionicons name="alert-circle-outline" size={16} color={c.warning} style={{ marginTop: 1 }} />
                <Text style={{ color: c.onSurface, fontSize: 13, flex: 1, lineHeight: 18 }}>
                  A late fee of <Text style={{ fontWeight: "800" }}>₹{data.late_fee.late_fee.toFixed(2)}</Text> applies for
                  returning {data.late_fee.billable_hours} hour{data.late_fee.billable_hours === 1 ? "" : "s"} late.
                </Text>
              </View>
            )}
            <View style={{ marginTop: 22, width: "100%" }}>
              <RaidexButton testID="trip-completion-done" label="Done" onPress={onDone} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 14, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31%", aspectRatio: 1, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, marginBottom: 16 },
});
