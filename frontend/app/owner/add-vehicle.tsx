import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexButton, RaidexCard, RaidexInput, RaidexChip, RaidexVehicleCard } from "@/src/components/ui";

// Same placeholder used by the previous single-screen add-vehicle form -
// kept verbatim so a host who never touches the photo step still submits
// the exact same default image value as before.
const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85";

// Exactly the fields the backend's VehicleCreate model accepts (see
// backend/server.py) plus the local string-typed form representation of
// each - no field is invented and none is dropped.
type VehicleForm = {
  type: "car" | "bike";
  name: string;
  brand: string;
  model: string;
  image: string;
  price_per_hour: string;
  price_per_day: string;
  price_per_week: string;
  price_per_month: string;
  deposit: string;
  transmission: string;
  fuel_type: string;
  seats: string;
  location: string;
  description: string;
};

const STEP_TITLES = [
  "Vehicle type",
  "Brand & specs",
  "Photos",
  "Pricing",
  "Deposit",
  "Pickup location",
  "Rules & notes",
  "Preview",
  "Publish",
];

const TRANSMISSIONS = ["Auto", "Manual"];
const FUEL_TYPES = ["Petrol", "Diesel", "EV"];

/** Library-only photo picker for a vehicle hero image - mirrors the
 * data-URI-via-base64 approach used by the KYC capture flow
 * (app/kyc/index.tsx), minus the camera branch, which isn't relevant for
 * picking a listing photo. */
async function pickVehiclePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== "granted") {
    Alert.alert("Permission required", "Allow photo library access to upload a vehicle photo.");
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    base64: true,
    quality: 0.6,
    allowsEditing: true,
    aspect: [4, 3],
  });
  if (res.canceled || !res.assets?.[0]?.base64) return null;
  return `data:image/jpeg;base64,${res.assets[0].base64}`;
}

const isPositiveNumber = (v: string) => { const n = parseFloat(v); return !Number.isNaN(n) && n > 0; };
const isNonNegativeNumber = (v: string) => { const n = parseFloat(v); return !Number.isNaN(n) && n >= 0; };
const isPositiveInt = (v: string) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0; };

export default function AddVehicleWizard() {
  const c = useTheme();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<VehicleForm>({
    type: "car", name: "", brand: "", model: "",
    image: DEFAULT_IMAGE,
    price_per_hour: "200", price_per_day: "2000", price_per_week: "12000", price_per_month: "40000",
    deposit: "5000", transmission: "Auto", fuel_type: "Petrol", seats: "5",
    location: "Mumbai", description: "Well maintained and ready for your next trip.",
  });

  const set = <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const lastStep = STEP_TITLES.length - 1;

  // Per-step gating. Only requirements the backend already enforces (name +
  // brand, per the original form's own check; positive prices; non-negative
  // deposit; a positive seat count) block "Next" - nothing stricter is
  // invented beyond what VehicleCreate already requires.
  const stepValid = (() => {
    switch (step) {
      case 0: return form.type === "car" || form.type === "bike";
      case 1: return form.name.trim().length > 0 && form.brand.trim().length > 0 && isPositiveInt(form.seats);
      case 2: return form.image.trim().length > 0;
      case 3: return isPositiveNumber(form.price_per_hour) && isPositiveNumber(form.price_per_day) && isPositiveNumber(form.price_per_week) && isPositiveNumber(form.price_per_month);
      case 4: return isNonNegativeNumber(form.deposit);
      case 5: return form.location.trim().length > 0;
      default: return true;
    }
  })();

  const submit = async () => {
    setBusy(true);
    try {
      // Identical payload shape (same keys/types) to the old inline
      // AddVehicleForm's submit call - see frontend/app/owner/index.tsx
      // history / PR diff for the byte-for-byte comparison.
      await api("/owner/vehicles", {
        method: "POST",
        body: {
          ...form,
          price_per_hour: parseFloat(form.price_per_hour),
          price_per_day: parseFloat(form.price_per_day),
          price_per_week: parseFloat(form.price_per_week),
          price_per_month: parseFloat(form.price_per_month),
          deposit: parseFloat(form.deposit),
          seats: parseInt(form.seats, 10),
          features: ["AC", "Music System"],
        },
      });
      Alert.alert("Submitted", "Your listing is pending Raidex admin approval.");
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    if (step === lastStep) { submit(); return; }
    setStep((s) => Math.min(s + 1, lastStep));
  };
  const goBack = () => {
    if (step === 0) { router.back(); return; }
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 20, paddingBottom: 12 }}>
          <Pressable onPress={goBack} testID="wizard-back-btn">
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: tokens.weight.bold, marginLeft: 8 }}>List a vehicle</Text>
        </View>
        <StepProgress step={step} total={STEP_TITLES.length} label={STEP_TITLES[step]} />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={20}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <StepReveal step={step}>
            {step === 0 && <TypeStep form={form} set={set} />}
            {step === 1 && <SpecsStep form={form} set={set} />}
            {step === 2 && <PhotoStep form={form} set={set} />}
            {step === 3 && <PricingStep form={form} set={set} />}
            {step === 4 && <DepositStep form={form} set={set} />}
            {step === 5 && <LocationStep form={form} set={set} />}
            {step === 6 && <RulesStep form={form} set={set} />}
            {step === 7 && <PreviewStep form={form} />}
            {step === 8 && <PublishStep form={form} />}
          </StepReveal>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 10, padding: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
          {step > 0 && (
            <RaidexButton testID="wizard-back-step-btn" label="Back" variant="secondary" onPress={goBack} fullWidth={false} style={{ flex: 1 }} />
          )}
          <RaidexButton
            testID={step === lastStep ? "create-vehicle-btn" : "wizard-next-btn"}
            label={step === lastStep ? "Publish listing" : step === lastStep - 1 ? "Continue to publish" : "Next"}
            onPress={goNext}
            disabled={!stepValid || busy}
            loading={busy && step === lastStep}
            style={{ flex: step > 0 ? 2 : undefined }}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function StepProgress({ step, total, label }: { step: number; total: number; label: string }) {
  const c = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ color: c.onSurface2, fontSize: 12, fontWeight: tokens.weight.bold }}>
          Step {step + 1} of {total}
        </Text>
        <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: tokens.weight.medium }}>{label}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{ flex: 1, height: 4, borderRadius: tokens.radius.pill, backgroundColor: i <= step ? c.accent : c.surface3 }}
          />
        ))}
      </View>
    </View>
  );
}

// Subtle fade/rise on every step change - same technique as the entrance
// reveals used elsewhere in this app (owner/index.tsx's `Reveal`,
// RaidexVehicleCard, the pay/booking screens' content reveals), just
// re-triggered on `step` instead of on list index.
function StepReveal({ step, children }: { step: number; children: React.ReactNode }) {
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = 0;
    appear.value = withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) });
  }, [appear, step]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 14 }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16, marginBottom: 14 }}>{children}</Text>
  );
}

type StepProps = { form: VehicleForm; set: <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) => void };

function TypeStep({ form, set }: StepProps) {
  const c = useTheme();
  return (
    <View>
      <SectionLabel>What are you listing?</SectionLabel>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {([{ key: "car", label: "Car", icon: "car" }, { key: "bike", label: "Bike", icon: "bicycle" }] as const).map((t) => {
          const active = form.type === t.key;
          return (
            <Pressable
              key={t.key}
              testID={`type-${t.key}`}
              onPress={() => set("type", t.key)}
              style={{
                flex: 1,
                alignItems: "center",
                gap: 10,
                paddingVertical: 28,
                borderRadius: tokens.radius.lg,
                borderWidth: 1.5,
                borderColor: active ? c.accent : c.border,
                backgroundColor: active ? c.accentBg : c.surface2,
              }}
            >
              <Ionicons name={t.icon} size={30} color={active ? c.onAccentBg : c.onSurface3} />
              <Text style={{ color: active ? c.onAccentBg : c.onSurface, fontWeight: tokens.weight.bold, fontSize: 15 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SpecsStep({ form, set }: StepProps) {
  const c = useTheme();
  return (
    <View>
      <SectionLabel>Brand, model & specs</SectionLabel>
      <RaidexInput testID="form-name" label="Vehicle name" value={form.name} onChangeText={(t) => set("name", t)} placeholder="Hyundai Creta Premium" />
      <RaidexInput testID="form-brand" label="Brand" value={form.brand} onChangeText={(t) => set("brand", t)} placeholder="Hyundai" />
      <RaidexInput testID="form-model" label="Model" value={form.model} onChangeText={(t) => set("model", t)} placeholder="Creta SX" />
      <RaidexInput testID="form-seats" label="Seats" value={form.seats} onChangeText={(t) => set("seats", t)} placeholder="5" keyboardType="numeric" />

      <Text style={{ color: c.onSurface2, fontSize: tokens.type.sm, fontWeight: tokens.weight.bold, marginBottom: 7 }}>Transmission</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: tokens.spacing.md }}>
        {TRANSMISSIONS.map((t) => (
          <RaidexChip key={t} testID={`transmission-${t}`} label={t} active={form.transmission === t} onPress={() => set("transmission", t)} />
        ))}
      </View>

      <Text style={{ color: c.onSurface2, fontSize: tokens.type.sm, fontWeight: tokens.weight.bold, marginBottom: 7 }}>Fuel type</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {FUEL_TYPES.map((f) => (
          <RaidexChip key={f} testID={`fuel-${f}`} label={f} active={form.fuel_type === f} onPress={() => set("fuel_type", f)} />
        ))}
      </View>
    </View>
  );
}

function PhotoStep({ form, set }: StepProps) {
  const c = useTheme();
  const [picking, setPicking] = useState(false);
  return (
    <View>
      <SectionLabel>Vehicle photo</SectionLabel>
      <Image source={form.image} style={{ width: "100%", height: 200, borderRadius: tokens.radius.lg, backgroundColor: c.surface2 }} contentFit="cover" />
      <RaidexButton
        testID="pick-photo-btn"
        label="Choose photo from library"
        variant="secondary"
        icon="image"
        loading={picking}
        style={{ marginTop: tokens.spacing.md }}
        onPress={async () => {
          setPicking(true);
          try {
            const uri = await pickVehiclePhoto();
            if (uri) set("image", uri);
          } finally { setPicking(false); }
        }}
      />
      <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 10 }}>
        A clear, well-lit photo of the vehicle helps renters trust the listing. A default placeholder is used until you upload one.
      </Text>
    </View>
  );
}

function PricingStep({ form, set }: StepProps) {
  return (
    <View>
      <SectionLabel>Set your pricing</SectionLabel>
      <RaidexInput testID="form-price_per_hour" label="Price per hour (₹)" value={form.price_per_hour} onChangeText={(t) => set("price_per_hour", t)} placeholder="200" keyboardType="numeric" />
      <RaidexInput testID="form-price_per_day" label="Price per day (₹)" value={form.price_per_day} onChangeText={(t) => set("price_per_day", t)} placeholder="2000" keyboardType="numeric" />
      <RaidexInput testID="form-price_per_week" label="Price per week (₹)" value={form.price_per_week} onChangeText={(t) => set("price_per_week", t)} placeholder="12000" keyboardType="numeric" />
      <RaidexInput testID="form-price_per_month" label="Price per month (₹)" value={form.price_per_month} onChangeText={(t) => set("price_per_month", t)} placeholder="40000" keyboardType="numeric" />
    </View>
  );
}

function DepositStep({ form, set }: StepProps) {
  const c = useTheme();
  return (
    <View>
      <SectionLabel>Security deposit</SectionLabel>
      <RaidexInput testID="form-deposit" label="Deposit (₹)" value={form.deposit} onChangeText={(t) => set("deposit", t)} placeholder="5000" keyboardType="numeric" />
      <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: -4 }}>
        Refundable amount collected from renters before a trip starts.
      </Text>
    </View>
  );
}

function LocationStep({ form, set }: StepProps) {
  return (
    <View>
      <SectionLabel>Pickup location</SectionLabel>
      <RaidexInput testID="form-location" label="City / Location" value={form.location} onChangeText={(t) => set("location", t)} placeholder="Mumbai" icon="location" />
    </View>
  );
}

function RulesStep({ form, set }: StepProps) {
  return (
    <View>
      <SectionLabel>Rules & notes</SectionLabel>
      <RaidexInput
        testID="form-description"
        label="Description"
        value={form.description}
        onChangeText={(t) => set("description", t)}
        placeholder="Well maintained and ready for your next trip."
        multiline
        numberOfLines={5}
      />
    </View>
  );
}

function PreviewStep({ form }: { form: VehicleForm }) {
  const c = useTheme();
  const seats = parseInt(form.seats, 10);
  const priceDay = parseFloat(form.price_per_day);
  return (
    <View>
      <SectionLabel>Preview</SectionLabel>
      <Text style={{ color: c.onSurface3, fontSize: 12, marginBottom: 14 }}>
        This is roughly what renters will see once your listing is approved.
      </Text>
      <RaidexVehicleCard
        testID="preview-vehicle-card"
        onPress={() => {}}
        vehicle={{
          vehicle_id: "preview",
          name: form.name || "Your vehicle",
          image: form.image,
          location: form.location,
          rating: 4.5,
          seats: Number.isFinite(seats) ? seats : undefined,
          transmission: form.transmission,
          fuel_type: form.fuel_type,
          price_per_day: Number.isFinite(priceDay) ? priceDay : 0,
        }}
      />
      <RaidexCard variant="flat" style={{ marginTop: tokens.spacing.md }}>
        <PreviewRow label="Brand / model" value={`${form.brand} ${form.model}`.trim()} />
        <PreviewRow label="Type" value={form.type === "car" ? "Car" : "Bike"} />
        <PreviewRow label="Price / hour" value={`₹${form.price_per_hour}`} />
        <PreviewRow label="Price / week" value={`₹${form.price_per_week}`} />
        <PreviewRow label="Price / month" value={`₹${form.price_per_month}`} />
        <PreviewRow label="Deposit" value={`₹${form.deposit}`} />
        {!!form.description && <PreviewRow label="Notes" value={form.description} last />}
      </RaidexCard>
    </View>
  );
}

function PreviewRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border, gap: 12 }}>
      <Text style={{ color: c.onSurface3, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: c.onSurface, fontSize: 12, fontWeight: tokens.weight.semibold, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

function PublishStep({ form }: { form: VehicleForm }) {
  const c = useTheme();
  return (
    <View>
      <RaidexCard variant="dark" padding={tokens.spacing.xl}>
        <Ionicons name="checkmark-circle" size={40} color="#22D98B" />
        <Text style={{ color: "#fff", fontSize: tokens.type.xxl, fontWeight: tokens.weight.black, marginTop: 14 }}>Ready to publish</Text>
        <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
          {form.name || "Your vehicle"} will be submitted for Raidex admin approval. It won't be bookable until it's approved.
        </Text>
      </RaidexCard>
      <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: tokens.spacing.md }}>
        You can review or edit pricing later from the Listings tab once it's live.
      </Text>
    </View>
  );
}
