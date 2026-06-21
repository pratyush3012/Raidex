import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, Platform } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

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

  const capturedCount = Object.values(photos).filter(Boolean).length;
  const allReq = capturedCount >= 4 && odo && parseFloat(odo) > 0;

  const takePhoto = async (key: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const uri = await captureOrPickImg();
    if (uri) {
      setPhotos((prev) => ({ ...prev, [key]: uri }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const submit = async () => {
    if (!allReq) { Alert.alert("Incomplete", "Capture at least 4 angles and enter odometer."); return; }
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
        await api(`/bookings/${booking_id}/start`, { method: "POST" });
        router.replace(`/trip/${booking_id}` as any);
      } else {
        const r = await api<any>(`/bookings/${booking_id}/end`, { method: "POST" });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Trip completed", `Distance: ${r.distance_km} km · +${r.miles_earned} RideMiles\nAI: ${r.ai_verdict}`, [
          { text: "OK", onPress: () => router.replace("/(tabs)/trips" as any) },
        ]);
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
          <View style={{ marginLeft: "auto", alignItems: "center" }}>
            <Text style={{ color: c.accent, fontSize: 22, fontWeight: "900" }}>{capturedCount}/6</Text>
            <Text style={{ color: c.onSurface3, fontSize: 10 }}>photos</Text>
          </View>
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
        <Text style={[styles.h, { color: c.onSurface }]}>Photos</Text>
        <View style={styles.grid}>
          {ANGLES.map((a) => (
            <Pressable
              key={a.key}
              testID={`photo-${a.key}`}
              onPress={() => takePhoto(a.key)}
              style={[styles.tile, { backgroundColor: c.surface2, borderColor: photos[a.key] ? c.accent : c.border }]}
            >
              {photos[a.key] ? (
                <>
                  <Image source={photos[a.key]!} style={{ width: "100%", height: "100%", borderRadius: 10 }} contentFit="cover" />
                  <View style={{ position: "absolute", bottom: 4, right: 4, backgroundColor: c.accent, borderRadius: 999, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                </>
              ) : (
                <View style={{ alignItems: "center" }}>
                  <Ionicons name={Platform.OS !== "web" ? "camera" : "cloud-upload"} size={22} color={c.onSurface3} />
                  <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: "700", marginTop: 4 }}>{a.label}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
        <Text style={[styles.h, { color: c.onSurface }]}>Odometer (km)</Text>
        <TextInput
          testID="odometer-input"
          value={odo}
          onChangeText={setOdo}
          placeholder="12345"
          keyboardType="numeric"
          placeholderTextColor={c.onSurface3}
          style={[styles.input, { backgroundColor: c.surface2, borderColor: c.border, color: c.onSurface }]}
        />
        <Text style={[styles.h, { color: c.onSurface }]}>Fuel level</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {FUELS.map((f) => (
            <Pressable key={f.key} testID={`fuel-${f.key}`} onPress={() => setFuel(f.key)} style={[styles.fuel, { backgroundColor: fuel === f.key ? c.inverse : c.surface2, borderColor: fuel === f.key ? c.inverse : c.border }]}>
              <Text style={{ color: fuel === f.key ? c.onInverse : c.onSurface, fontWeight: "800", fontSize: 16 }}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.h, { color: c.onSurface }]}>Notes (optional)</Text>
        <TextInput
          testID="notes-input"
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Any pre-existing scratches or damage?"
          placeholderTextColor={c.onSurface3}
          style={[styles.input, { backgroundColor: c.surface2, borderColor: c.border, color: c.onSurface, minHeight: 80, paddingTop: 12 }]}
        />
        <Pressable
          testID="submit-inspection"
          disabled={!allReq || busy}
          onPress={submit}
          style={[styles.primary, { backgroundColor: c.inverse, opacity: !allReq || busy ? 0.4 : 1, marginTop: 28 }]}
        >
          {busy ? <ActivityIndicator color={c.onInverse} /> : (
            <>
              <Ionicons name={phase === "before" ? "play" : "stop"} size={18} color={c.onInverse} />
              <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>{phase === "before" ? "Submit & Start trip" : "Submit & End trip"}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 14, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31%", aspectRatio: 1, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  fuel: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
});
