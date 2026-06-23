import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

type Tab = "earnings" | "listings" | "bookings" | "add";

export default function OwnerDashboard() {
  const c = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("earnings");
  const [earnings, setEarnings] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  const onboard = async () => {
    try { await api("/owner/onboard", { method: "POST" }); setOnboarded(true); load(); } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const e = await api<any>("/owner/earnings");
      setEarnings(e);
      setVehicles(await api<any[]>("/owner/vehicles"));
      setBookings(await api<any[]>("/owner/bookings"));
      setOnboarded(true);
    } catch (err: any) {
      if (err.message?.includes("owner role required")) setOnboarded(false);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!onboarded) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 20 }}>
            <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
            <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: "800", marginLeft: 8 }}>Become a host</Text>
          </View>
        </SafeAreaView>
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <LinearGradient colors={["#000", "#1a1a1a"]} style={{ padding: 24, borderRadius: 24 }}>
            <Ionicons name="business" size={48} color="#05C46B" />
            <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 16 }}>Earn ₹40,000+ per month</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 8 }}>List your idle car or bike. Raidex handles bookings, payments, KYC. You keep 85%.</Text>
          </LinearGradient>
          <View style={{ marginTop: 20, gap: 12 }}>
            {[
              { ic: "shield-checkmark", t: "KYC-verified renters only", s: "All renters verified with Aadhaar + DL + face match" },
              { ic: "navigate", t: "GPS-tracked trips", s: "Live location, geofence alerts, mileage logged automatically" },
              { ic: "camera", t: "AI damage inspection", s: "Mandatory before/after photos with AI scoring" },
              { ic: "card", t: "Weekly payouts", s: "Net earnings deposited to your account every Friday" },
            ].map((it) => (
              <View key={it.ic} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
                <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name={it.ic as any} size={20} color={c.onAccentBg} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "700" }}>{it.t}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{it.s}</Text>
                </View>
              </View>
            ))}
          </View>
          <Pressable testID="onboard-btn" onPress={onboard} style={[styles.cta, { backgroundColor: c.inverse, marginTop: 24 }]}>
            <Text style={{ color: c.onInverse, fontWeight: "800", fontSize: 16 }}>Activate host account</Text>
            <Ionicons name="arrow-forward" size={18} color={c.onInverse} />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 20 }}>
          <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: "800", marginLeft: 8 }}>Host Dashboard</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }} style={{ height: 56 }}>
          {(["earnings", "listings", "bookings", "add"] as Tab[]).map((t) => (
            <Pressable key={t} testID={`owner-tab-${t}`} onPress={() => setTab(t)} style={[styles.chip, { backgroundColor: tab === t ? c.inverse : c.surface2, borderColor: tab === t ? c.inverse : c.border }]}>
              <Text style={{ color: tab === t ? c.onInverse : c.onSurface, fontWeight: "700", textTransform: "capitalize" }}>{t === "add" ? "+ Vehicle" : t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {loading && <ActivityIndicator color={c.accent} />}

        {tab === "earnings" && earnings && (
          <View>
            <LinearGradient colors={["#05C46B", "#03A85A"]} style={{ padding: 24, borderRadius: 24 }}>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "800", letterSpacing: 2 }}>NET PAYABLE</Text>
              <Text testID="net-payable" style={{ color: "#fff", fontSize: 40, fontWeight: "800", marginTop: 6 }}>₹{earnings.net_payable.toLocaleString()}</Text>
              <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 4 }}>Gross ₹{earnings.gross.toLocaleString()} · Commission ₹{earnings.commission.toLocaleString()} (15%)</Text>
            </LinearGradient>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Kpi c={c} label="Vehicles" val={String(earnings.vehicles_count)} />
              <Kpi c={c} label="Active trips" val={String(earnings.active_trips)} />
              <Kpi c={c} label="Upcoming" val={String(earnings.future_bookings)} />
            </View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16, marginTop: 24, marginBottom: 12 }}>Booking breakdown</Text>
            {Object.entries(earnings.by_status || {}).map(([k, v]: any) => (
              <View key={k} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginBottom: 8 }]}>
                <Ionicons name="ellipse" size={10} color={k === "completed" ? c.accent : k === "active" ? c.warning : c.onSurface3} />
                <Text style={{ color: c.onSurface, fontWeight: "600", textTransform: "capitalize", flex: 1 }}>{k}</Text>
                <Text style={{ color: c.onSurface, fontWeight: "800" }}>{String(v)}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "listings" && (
          <View>
            {vehicles.length === 0 ? <EmptyState c={c} icon="car-outline" text="No vehicles yet — tap '+ Vehicle' to add one" /> :
              vehicles.map((v) => (
                <View key={v.vehicle_id} style={[styles.vRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Image source={v.hero_image || v.image} style={{ width: 70, height: 70, borderRadius: 10 }} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "800" }}>{v.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: v.verification_status === "approved" ? c.accentBg : c.surface3 }}>
                        <Text style={{ color: v.verification_status === "approved" ? c.onAccentBg : c.onSurface2, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>{v.verification_status}</Text>
                      </View>
                      <Text style={{ color: c.onSurface3, fontSize: 12 }}>· ₹{v.price_per_day}/day</Text>
                    </View>
                    <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 4 }}>{v.lifetime_km || 0} km lifetime · {v.trips || 0} trips</Text>
                  </View>
                </View>
              ))
            }
          </View>
        )}

        {tab === "bookings" && (
          <View>
            {bookings.length === 0 ? <EmptyState c={c} icon="calendar-outline" text="No bookings on your vehicles yet" /> :
              bookings.map((b) => (
                <View key={b.booking_id} style={[styles.vRow, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Image source={b.vehicle_snapshot?.image} style={{ width: 60, height: 60, borderRadius: 10 }} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "700" }}>{b.vehicle_snapshot?.name}</Text>
                    <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()}</Text>
                    <Text style={{ color: c.onSurface, fontWeight: "800", marginTop: 4 }}>₹{b.total_amount.toLocaleString()} · <Text style={{ color: c.accent, fontSize: 11 }}>{b.status.toUpperCase()}</Text></Text>
                  </View>
                </View>
              ))
            }
          </View>
        )}

        {tab === "add" && <AddVehicleForm c={c} onCreated={() => { setTab("listings"); load(); }} />}
      </ScrollView>
    </View>
  );
}

function AddVehicleForm({ c, onCreated }: any) {
  const [form, setForm] = useState({
    type: "car", name: "", brand: "", model: "",
    image: "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85",
    price_per_hour: "200", price_per_day: "2000", price_per_week: "12000", price_per_month: "40000",
    deposit: "5000", transmission: "Auto", fuel_type: "Petrol", seats: "5",
    location: "Mumbai", description: "Well maintained and ready for your next trip.",
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!form.name || !form.brand) { Alert.alert("Missing", "Enter name and brand."); return; }
    setBusy(true);
    try {
      await api("/owner/vehicles", {
        method: "POST",
        body: {
          ...form,
          price_per_hour: parseFloat(form.price_per_hour), price_per_day: parseFloat(form.price_per_day),
          price_per_week: parseFloat(form.price_per_week), price_per_month: parseFloat(form.price_per_month),
          deposit: parseFloat(form.deposit), seats: parseInt(form.seats),
          features: ["AC", "Music System"],
        },
      });
      Alert.alert("Submitted", "Your listing is pending Raidex admin approval.");
      onCreated();
    } catch (e: any) { Alert.alert("Error", e.message); } finally { setBusy(false); }
  };
  return (
    <View>
      <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16, marginBottom: 12 }}>New vehicle</Text>
      <Text style={[styles.lbl, { color: c.onSurface2 }]}>Type</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        {["car", "bike"].map((t) => (
          <Pressable key={t} testID={`type-${t}`} onPress={() => setForm({ ...form, type: t })} style={[styles.chip, { backgroundColor: form.type === t ? c.inverse : c.surface2, borderColor: form.type === t ? c.inverse : c.border }]}>
            <Text style={{ color: form.type === t ? c.onInverse : c.onSurface, fontWeight: "700", textTransform: "capitalize" }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {[
        ["name", "Vehicle name", "Hyundai Creta Premium"],
        ["brand", "Brand", "Hyundai"],
        ["model", "Model", "Creta SX"],
        ["price_per_day", "Price per day (₹)", "2000"],
        ["price_per_month", "Price per month (₹)", "40000"],
        ["deposit", "Deposit (₹)", "5000"],
        ["seats", "Seats", "5"],
        ["location", "City / Location", "Mumbai"],
      ].map(([k, lbl, ph]) => (
        <View key={k} style={{ marginBottom: 12 }}>
          <Text style={[styles.lbl, { color: c.onSurface2 }]}>{lbl}</Text>
          <TextInput
            testID={`form-${k}`}
            value={(form as any)[k]}
            onChangeText={(t) => setForm({ ...form, [k]: t })}
            placeholder={ph as string}
            placeholderTextColor={c.onSurface3}
            keyboardType={k.startsWith("price") || k === "deposit" || k === "seats" ? "numeric" : "default"}
            style={[styles.input, { backgroundColor: c.surface2, borderColor: c.border, color: c.onSurface }]}
          />
        </View>
      ))}
      <Pressable testID="create-vehicle-btn" disabled={busy} onPress={submit} style={[styles.cta, { backgroundColor: c.inverse, marginTop: 12, opacity: busy ? 0.6 : 1 }]}>
        {busy ? <ActivityIndicator color={c.onInverse} /> : <Text style={{ color: c.onInverse, fontWeight: "800" }}>Submit for review</Text>}
      </Pressable>
    </View>
  );
}

function Kpi({ c, label, val }: any) {
  return (
    <View style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ color: c.onSurface3, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800", marginTop: 4 }}>{val}</Text>
    </View>
  );
}
function EmptyState({ c, icon, text }: any) {
  return (
    <View style={{ alignItems: "center", padding: 40 }}>
      <Ionicons name={icon} size={48} color={c.onSurface3} />
      <Text style={{ color: c.onSurface2, marginTop: 12 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  iconRound: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  vRow: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  lbl: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});
