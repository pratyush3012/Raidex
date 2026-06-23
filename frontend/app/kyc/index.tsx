import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Alert, Platform } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";

type Step = 0 | 1 | 2 | 3; // 0 intro, 1 aadhaar, 2 dl, 3 face

/**
 * On a native build: opens camera directly for document / face capture.
 * On Expo Go / web: falls back to photo library.
 */
async function captureDocument(opts?: { front?: boolean; selfie?: boolean }): Promise<string | null> {
  if (Platform.OS !== "web") {
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (camPerm.status === "granted") {
      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.6,
        // For selfies, enable front-facing camera hint via cameraType
        cameraType: opts?.selfie
          ? ImagePicker.CameraType.front
          : ImagePicker.CameraType.back,
        allowsEditing: opts?.selfie,
        aspect: opts?.selfie ? [1, 1] : undefined,
      });
      if (!r.canceled && r.assets?.[0]?.base64) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return `data:image/jpeg;base64,${r.assets[0].base64}`;
      }
    }
  }
  // Fallback: photo library
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== "granted") {
    Alert.alert("Permission required", "Allow camera or photo library access to upload documents.");
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    base64: true,
    quality: 0.6,
  });
  if (res.canceled || !res.assets?.[0]?.base64) return null;
  return `data:image/jpeg;base64,${res.assets[0].base64}`;
}

export default function KycWizard() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState<Step>(0);
  const [aadhaarF, setAadhaarF] = useState<string | null>(null);
  const [aadhaarB, setAadhaarB] = useState<string | null>(null);
  const [aadhaarLast4, setAadhaarLast4] = useState("");
  const [dlF, setDlF] = useState<string | null>(null);
  const [dlB, setDlB] = useState<string | null>(null);
  const [dlNumber, setDlNumber] = useState("");
  const [face, setFace] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!pollingStatus) return;
    const t = setInterval(async () => {
      try {
        const r = await api<any>("/kyc/status");
        if (r.kyc_status === "verified" || r.kyc_status === "rejected") {
          setPollingStatus(r.kyc_status);
          await refresh();
          clearInterval(t);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(t);
  }, [pollingStatus, refresh]);

  const totalSteps = 3;
  const progress = step === 0 ? 0 : (step / totalSteps) * 100;

  if (pollingStatus) {
    const verified = pollingStatus === "verified";
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <SafeAreaView style={{ flex: 1, justifyContent: "center", padding: tokens.spacing.xl }}>
          <View style={[styles.statusCard, { backgroundColor: c.surface2 }]}>
            <View style={[styles.statusIcon, { backgroundColor: verified ? c.accentBg : c.surface3 }]}>
              <Ionicons name={verified ? "checkmark-circle" : pollingStatus === "rejected" ? "close-circle" : "hourglass"} size={56} color={verified ? c.accent : c.error} />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 24, fontWeight: "800", marginTop: 20, textAlign: "center" }}>
              {pollingStatus === "submitted" ? "Verifying…" : verified ? "Verified!" : "Verification failed"}
            </Text>
            <Text style={{ color: c.onSurface3, fontSize: 14, marginTop: 8, textAlign: "center" }}>
              {pollingStatus === "submitted"
                ? "Our team is reviewing your documents. This usually takes a few seconds."
                : verified
                ? "You can now book vehicles instantly."
                : "Please retry with clearer photos."}
            </Text>
            {pollingStatus === "submitted" && <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />}
            {pollingStatus !== "submitted" && (
              <Pressable
                testID="kyc-done-btn"
                onPress={() => {
                  if (verified && from) router.replace(from as any);
                  else if (verified) router.replace("/(tabs)");
                  else { setPollingStatus(null); setStep(1); }
                }}
                style={[styles.primaryBtn, { backgroundColor: c.inverse, marginTop: 24 }]}
              >
                <Text style={{ color: c.onInverse, fontWeight: "700", fontSize: 16 }}>{verified ? "Continue" : "Retry"}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const onSubmit = async () => {
    if (!aadhaarF || !aadhaarB || !dlF || !dlB || !face) {
      Alert.alert("Missing documents", "Please upload all required photos before submitting.");
      return;
    }
    if (aadhaarLast4.length !== 4) {
      Alert.alert("Aadhaar", "Enter the last 4 digits of your Aadhaar number.");
      return;
    }
    if (dlNumber.trim().length < 6) {
      Alert.alert("DL", "Enter your driving license number (min 6 chars).");
      return;
    }
    setSubmitting(true);
    try {
      await api("/kyc/submit", {
        method: "POST",
        body: {
          aadhaar_front: aadhaarF, aadhaar_back: aadhaarB, aadhaar_last4: aadhaarLast4,
          dl_front: dlF, dl_back: dlB, dl_number: dlNumber.trim(),
          dl_expiry: "", face_selfie: face,
        },
      });
      setPollingStatus("submitted");
    } catch (e: any) {
      Alert.alert("Submission failed", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md, flexDirection: "row", alignItems: "center" }}>
          <Pressable testID="kyc-back-btn" onPress={() => (step <= 1 ? router.back() : setStep((step - 1) as Step))}>
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: "800", marginLeft: 8 }}>Identity verification</Text>
        </View>
        {step > 0 && (
          <View style={{ paddingHorizontal: tokens.spacing.xl }}>
            <View style={{ height: 4, backgroundColor: c.surface3, borderRadius: 999 }}>
              <View style={{ width: `${progress}%`, height: "100%", backgroundColor: c.accent, borderRadius: 999 }} />
            </View>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 6 }}>Step {step} of {totalSteps}</Text>
          </View>
        )}
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: insets.bottom + 100 }}>
        {step === 0 && (
          <View>
            <Text style={{ color: c.onSurface, fontSize: 28, fontWeight: "800" }}>Get verified in 60 seconds</Text>
            <Text style={{ color: c.onSurface3, marginTop: 8, fontSize: 14, lineHeight: 22 }}>
              We need to verify your identity to comply with regulations and unlock booking. Your data is encrypted.
            </Text>
            <View style={{ marginTop: 24, gap: 12 }}>
              <InfoRow c={c} icon="document-text" title="Aadhaar Card" sub="Front + back photo" />
              <InfoRow c={c} icon="car-sport" title="Driving License" sub="Front + back photo, DL number" />
              <InfoRow c={c} icon="happy" title="Face selfie" sub="Live liveness check" />
            </View>
            <Pressable testID="kyc-start-btn" onPress={() => setStep(1)} style={[styles.primaryBtn, { backgroundColor: c.inverse, marginTop: 32 }]}>
              <Text style={{ color: c.onInverse, fontWeight: "700", fontSize: 16 }}>Start verification</Text>
              <Ionicons name="arrow-forward" size={18} color={c.onInverse} />
            </Pressable>
          </View>
        )}

        {step === 1 && (
          <View>
            <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800" }}>Aadhaar Card</Text>
            <Text style={{ color: c.onSurface3, marginTop: 6, fontSize: 13 }}>Upload clear photos of both sides.</Text>
            <UploadTile c={c} label="Aadhaar — front" value={aadhaarF} onPress={async () => setAadhaarF(await captureDocument())} testID="aadhaar-front" />
            <UploadTile c={c} label="Aadhaar — back" value={aadhaarB} onPress={async () => setAadhaarB(await captureDocument())} testID="aadhaar-back" />
            <Text style={[styles.label, { color: c.onSurface2 }]}>Last 4 digits of Aadhaar</Text>
            <TextInput
              testID="aadhaar-last4"
              value={aadhaarLast4}
              onChangeText={(t) => setAadhaarLast4(t.replace(/\D/g, "").slice(0, 4))}
              placeholder="1234"
              keyboardType="number-pad"
              placeholderTextColor={c.onSurface3}
              style={[styles.input, { backgroundColor: c.surface2, borderColor: c.border, color: c.onSurface }]}
            />
            <Pressable
              testID="kyc-next-1"
              disabled={!aadhaarF || !aadhaarB || aadhaarLast4.length !== 4}
              onPress={() => setStep(2)}
              style={[styles.primaryBtn, { backgroundColor: c.inverse, marginTop: 24, opacity: (!aadhaarF || !aadhaarB || aadhaarLast4.length !== 4) ? 0.4 : 1 }]}
            >
              <Text style={{ color: c.onInverse, fontWeight: "700" }}>Continue</Text>
            </Pressable>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800" }}>Driving License</Text>
            <Text style={{ color: c.onSurface3, marginTop: 6, fontSize: 13 }}>Make sure your DL is current and the photo is clear.</Text>
            <UploadTile c={c} label="DL — front" value={dlF} onPress={async () => setDlF(await captureDocument())} testID="dl-front" />
            <UploadTile c={c} label="DL — back" value={dlB} onPress={async () => setDlB(await captureDocument())} testID="dl-back" />
            <Text style={[styles.label, { color: c.onSurface2 }]}>DL Number</Text>
            <TextInput
              testID="dl-number"
              value={dlNumber}
              onChangeText={setDlNumber}
              placeholder="MH12 20210012345"
              autoCapitalize="characters"
              placeholderTextColor={c.onSurface3}
              style={[styles.input, { backgroundColor: c.surface2, borderColor: c.border, color: c.onSurface }]}
            />
            <Pressable
              testID="kyc-next-2"
              disabled={!dlF || !dlB || dlNumber.trim().length < 6}
              onPress={() => setStep(3)}
              style={[styles.primaryBtn, { backgroundColor: c.inverse, marginTop: 24, opacity: (!dlF || !dlB || dlNumber.trim().length < 6) ? 0.4 : 1 }]}
            >
              <Text style={{ color: c.onInverse, fontWeight: "700" }}>Continue</Text>
            </Pressable>
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800" }}>Face selfie</Text>
            <Text style={{ color: c.onSurface3, marginTop: 6, fontSize: 13 }}>Position your face inside the frame in good light. Live camera will be enabled in the published app.</Text>
            <UploadTile c={c} label="Selfie" value={face} onPress={async () => setFace(await captureDocument({ selfie: true }))} aspect="round" testID="face-selfie" />
            <Pressable
              testID="kyc-submit-btn"
              disabled={!face || submitting}
              onPress={onSubmit}
              style={[styles.primaryBtn, { backgroundColor: c.inverse, marginTop: 24, opacity: !face || submitting ? 0.4 : 1 }]}
            >
              {submitting ? <ActivityIndicator color={c.onInverse} /> : <>
                <Ionicons name="shield-checkmark" size={18} color={c.onInverse} />
                <Text style={{ color: c.onInverse, fontWeight: "700" }}>Submit for verification</Text>
              </>}
            </Pressable>
            {Platform.OS !== "web" && (
              <Text style={{ color: c.onSurface3, fontSize: 11, textAlign: "center", marginTop: 12 }}>
                {ImagePicker.CameraType ? "Front camera enabled for selfie capture." : "Camera capture requires a native build."}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ c, icon, title, sub }: any) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: c.surface2, borderRadius: 14, borderWidth: 1, borderColor: c.border }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={20} color={c.onAccentBg} />
      </View>
      <View><Text style={{ color: c.onSurface, fontWeight: "700" }}>{title}</Text><Text style={{ color: c.onSurface3, fontSize: 12 }}>{sub}</Text></View>
    </View>
  );
}

function UploadTile({ c, label, value, onPress, aspect, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.tile, { backgroundColor: c.surface2, borderColor: value ? c.accent : c.border, height: aspect === "round" ? 200 : 140 }]}>
      {value ? (
        <Image source={value} style={{ width: "100%", height: "100%", borderRadius: 12 }} contentFit="cover" />
      ) : (
        <View style={{ alignItems: "center" }}>
          <Ionicons name="cloud-upload" size={28} color={c.onSurface3} />
          <Text style={{ color: c.onSurface, fontWeight: "700", marginTop: 8 }}>{label}</Text>
          <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>Tap to upload</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
  label: { fontSize: 12, fontWeight: "600", marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  tile: { borderRadius: 14, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginTop: 12, overflow: "hidden" },
  statusCard: { padding: 32, borderRadius: 24, alignItems: "center" },
  statusIcon: { width: 96, height: 96, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
