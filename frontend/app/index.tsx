import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme, tokens } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

const HERO = "https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1600&q=85";

type AuthMode = "intro" | "login" | "signup" | "phone";

export default function Landing() {
  const c = useTheme();
  const { login, register, loginWithGoogle, loginWithApple, requestPhoneOtp, verifyPhoneOtp } = useAuth();
  const [mode, setMode] = useState<AuthMode>("intro");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = useMemo(() => {
    if (mode === "login") return "Welcome back";
    if (mode === "signup") return "Create account";
    return "Verify phone";
  }, [mode]);

  const submit = async () => {
    setError(null);
    setSuccess(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) return setError("Enter a valid email address");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (mode === "signup" && name.trim().length < 2) return setError("Enter your name");
    setBusy(true);
    try {
      if (mode === "login") await login(cleanEmail, password);
      else await register(cleanEmail, password, name.trim());
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = async () => {
    setError(null);
    setSuccess(null);
    const cleanPhone = phone.replace(/[^\d+]/g, "");
    if (cleanPhone.length < 10) return setError("Enter a valid phone number");
    setBusy(true);
    try {
      const res = await requestPhoneOtp(cleanPhone);
      setChallengeId(res.challenge_id);
      setDevOtp(res.dev_otp || "");
      setSuccess(res.dev_otp ? `OTP sent. Dev OTP: ${res.dev_otp}` : "OTP sent to your phone");
    } catch (e: any) {
      setError(e.message || "Could not send OTP");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setError(null);
    setSuccess(null);
    if (!challengeId) return requestOtp();
    if (otp.trim().length < 4) return setError("Enter the OTP");
    setBusy(true);
    try {
      await verifyPhoneOtp(challengeId, phone.replace(/[^\d+]/g, ""), otp.trim(), name.trim() || undefined);
    } catch (e: any) {
      setError(e.message || "OTP verification failed");
    } finally {
      setBusy(false);
    }
  };

  const provider = async (kind: "google" | "apple") => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      if (kind === "google") await loginWithGoogle();
      else await loginWithApple();
    } catch (e: any) {
      setError(e.message || "Provider login is not ready");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "intro") {
    return (
      <View style={styles.heroRoot}>
        <Image source={HERO} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        <LinearGradient colors={["rgba(0,0,0,0.18)", "rgba(0,0,0,0.58)", "rgba(0,0,0,0.96)"]} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFillObject} />
        <SafeAreaView style={styles.heroSafe} edges={["top", "bottom"]}>
          <View style={styles.brandRow}>
            <View style={styles.brandBadge}><Text style={styles.brandBadgeText}>R</Text></View>
            <Text style={styles.brandText} testID="brand-mark">RAIDEX</Text>
          </View>

          <View style={styles.heroContent}>
            <View style={styles.liveStrip}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live cars and bikes around you</Text>
            </View>
            <Text style={styles.heroTitle}>Move smarter.{"\n"}Book faster.</Text>
            <Text style={styles.heroCopy}>Premium rentals with verified owners, transparent pricing, KYC safety, and instant booking.</Text>
            <View style={styles.heroStats}>
              <HeroStat value="2 min" label="avg pickup" />
              <HeroStat value="4.8" label="rider rating" />
              <HeroStat value="24/7" label="support" />
            </View>
            <Pressable testID="get-started-btn" onPress={() => setMode("signup")} style={({ pressed }) => [styles.primaryHeroBtn, { opacity: pressed ? 0.88 : 1 }]}>
              <Text style={styles.primaryHeroText}>Create account</Text>
              <Ionicons name="arrow-forward" size={20} color="#050505" />
            </Pressable>
            <View style={styles.heroActions}>
              <Pressable testID="have-account-btn" onPress={() => setMode("login")} style={styles.heroGhostBtn}>
                <Ionicons name="mail" size={16} color="#fff" />
                <Text style={styles.heroGhostText}>Email login</Text>
              </Pressable>
              <Pressable testID="phone-login-btn" onPress={() => setMode("phone")} style={styles.heroGhostBtn}>
                <Ionicons name="call" size={16} color="#fff" />
                <Text style={styles.heroGhostText}>Phone OTP</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <Pressable testID="back-btn" onPress={() => setMode("intro")} style={[styles.backButton, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <Ionicons name="chevron-back" size={24} color={c.onSurface} />
          </Pressable>

          <View style={[styles.authPanel, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <LinearGradient colors={["#050505", "#1F2937"]} style={styles.authTop}>
              <Text style={styles.authKicker}>RAIDEX ACCESS</Text>
              <Text style={styles.authTitle}>{title}</Text>
              <Text style={styles.authSubtitle}>
                {mode === "phone" ? "Fast OTP login for Indian riders and owners." : "Use email or continue with secure app-owned login options."}
              </Text>
            </LinearGradient>

            <View style={styles.authBody}>
              <View style={[styles.modeTabs, { backgroundColor: c.surface, borderColor: c.border }]}>
                <AuthTab c={c} active={mode === "login"} label="Email" icon="mail" onPress={() => setMode("login")} />
                <AuthTab c={c} active={mode === "phone"} label="Phone" icon="call" onPress={() => setMode("phone")} />
                <AuthTab c={c} active={mode === "signup"} label="Signup" icon="person-add" onPress={() => setMode("signup")} />
              </View>

              {mode !== "phone" ? (
                <>
                  {mode === "signup" && <Field c={c} label="Full name" value={name} onChangeText={setName} placeholder="Pratyush Sharma" icon="person" testID="name-input" />}
                  <Field c={c} label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" icon="mail" testID="email-input" keyboardType="email-address" autoCapitalize="none" />
                  <Field c={c} label="Password" value={password} onChangeText={setPassword} placeholder="Minimum 6 characters" icon="lock-closed" testID="password-input" secureTextEntry />
                  <Pressable testID="auth-submit-btn" disabled={busy} onPress={submit} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.inverse, opacity: pressed || busy ? 0.85 : 1 }]}>
                    {busy ? <ActivityIndicator color={c.onInverse} /> : <Text style={{ color: c.onInverse, fontWeight: "900", fontSize: 16 }}>{mode === "login" ? "Sign in" : "Create account"}</Text>}
                  </Pressable>
                </>
              ) : (
                <>
                  <Field c={c} label="Phone number" value={phone} onChangeText={setPhone} placeholder="+91 98765 43210" icon="call" testID="phone-input" keyboardType="phone-pad" />
                  {challengeId ? <Field c={c} label="OTP" value={otp} onChangeText={setOtp} placeholder={devOtp || "6 digit code"} icon="keypad" testID="otp-input" keyboardType="number-pad" /> : null}
                  <Pressable testID={challengeId ? "otp-verify-btn" : "otp-request-btn"} disabled={busy} onPress={challengeId ? verifyOtp : requestOtp} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.inverse, opacity: pressed || busy ? 0.85 : 1 }]}>
                    {busy ? <ActivityIndicator color={c.onInverse} /> : <Text style={{ color: c.onInverse, fontWeight: "900", fontSize: 16 }}>{challengeId ? "Verify OTP" : "Send OTP"}</Text>}
                  </Pressable>
                  {challengeId ? (
                    <Pressable onPress={requestOtp} style={styles.resendBtn}>
                      <Text style={{ color: c.onSurface2, fontWeight: "800" }}>Resend OTP</Text>
                    </Pressable>
                  ) : null}
                </>
              )}

              {error ? <Text testID="auth-error" style={[styles.message, { color: c.error }]}>{error}</Text> : null}
              {success ? <Text testID="auth-success" style={[styles.message, { color: c.accent }]}>{success}</Text> : null}

              <View style={styles.dividerRow}>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <Text style={{ color: c.onSurface3, fontWeight: "700" }}>or continue with</Text>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
              </View>

              <View style={styles.providerGrid}>
                <ProviderButton c={c} icon="logo-google" label="Google" testID="google-signin-btn" onPress={() => provider("google")} />
                <ProviderButton c={c} icon="logo-apple" label="Apple" testID="apple-signin-btn" onPress={() => provider("apple")} />
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function AuthTab({ c, active, label, icon, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={[styles.authTab, { backgroundColor: active ? c.inverse : "transparent" }]}>
      <Ionicons name={icon} size={14} color={active ? c.onInverse : c.onSurface2} />
      <Text style={{ color: active ? c.onInverse : c.onSurface2, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Field({ c, label, icon, ...props }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.onSurface2 }]}>{label}</Text>
      <View style={[styles.inputShell, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Ionicons name={icon} size={18} color={c.onSurface3} />
        <TextInput {...props} placeholderTextColor={c.onSurface3} style={[styles.input, { color: c.onSurface }]} />
      </View>
    </View>
  );
}

function ProviderButton({ c, icon, label, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.providerBtn, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.86 : 1 }]}>
      <Ionicons name={icon} size={20} color={c.onSurface} />
      <Text style={{ color: c.onSurface, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroRoot: { flex: 1, backgroundColor: "#000" },
  heroSafe: { flex: 1, justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 24, paddingTop: 24 },
  brandBadge: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  brandBadgeText: { color: "#050505", fontWeight: "900", fontSize: 18 },
  brandText: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: 4 },
  heroContent: { padding: 24, paddingBottom: 28 },
  liveStrip: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginBottom: 18 },
  liveDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: "#05C46B" },
  liveText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  heroTitle: { color: "#fff", fontSize: 44, lineHeight: 48, fontWeight: "900" },
  heroCopy: { color: "rgba(255,255,255,0.82)", fontSize: 16, lineHeight: 23, marginTop: 14 },
  heroStats: { flexDirection: "row", gap: 10, marginTop: 22 },
  heroStat: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 16, padding: 12 },
  heroStatValue: { color: "#fff", fontSize: 18, fontWeight: "900" },
  heroStatLabel: { color: "rgba(255,255,255,0.68)", fontSize: 11, fontWeight: "700", marginTop: 2 },
  primaryHeroBtn: { marginTop: 22, height: 58, borderRadius: 18, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryHeroText: { color: "#050505", fontWeight: "900", fontSize: 17 },
  heroActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  heroGhostBtn: { flex: 1, height: 48, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(255,255,255,0.1)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  heroGhostText: { color: "#fff", fontWeight: "800" },
  authScroll: { flexGrow: 1, padding: tokens.spacing.xl },
  backButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  authPanel: { borderRadius: 26, borderWidth: 1, overflow: "hidden" },
  authTop: { padding: 22 },
  authKicker: { color: "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  authTitle: { color: "#fff", fontSize: 31, fontWeight: "900", marginTop: 8 },
  authSubtitle: { color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 20, marginTop: 7 },
  authBody: { padding: 16 },
  modeTabs: { flexDirection: "row", borderWidth: 1, borderRadius: 16, padding: 4, marginBottom: 16 },
  authTab: { flex: 1, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  fieldWrap: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: "900", marginBottom: 7 },
  inputShell: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, minHeight: 54 },
  input: { flex: 1, fontSize: 16, paddingVertical: 13 },
  primaryBtn: { minHeight: 56, borderRadius: 17, alignItems: "center", justifyContent: "center", marginTop: 4 },
  resendBtn: { alignItems: "center", paddingVertical: 14 },
  message: { marginTop: 13, fontWeight: "800", lineHeight: 20 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 20 },
  divider: { flex: 1, height: 1 },
  providerGrid: { flexDirection: "row", gap: 10 },
  providerBtn: { flex: 1, height: 52, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
});
