import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme, tokens } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

const HERO = "https://images.unsplash.com/photo-1777329385816-4220415c266d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwxfHxUZXNsYSUyMGNhciUyMG1vZGVybiUyMGNpdHl8ZW58MHx8fHwxNzgxOTcxNjAxfDA&ixlib=rb-4.1.0&q=85";

export default function Landing() {
  const c = useTheme();
  const router = useRouter();
  const { user, login, register, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<"intro" | "login" | "signup">("intro");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router2 = router;

  useEffect(() => {
    if (user) router2.replace("/(tabs)");
  }, [user, router2]);

  if (user) return null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, name.trim() || email.split("@")[0]);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (e: any) {
      setError(e.message || "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "intro") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <Image source={HERO} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        <LinearGradient
          colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.95)"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={{ flex: 1, justifyContent: "space-between" }} edges={["top", "bottom"]}>
          <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.xl }}>
            <Text style={{ color: "#fff", fontSize: tokens.type.xl, fontWeight: "800", letterSpacing: 4 }} testID="brand-mark">RAIDEX</Text>
          </View>
          <View style={{ paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.xl }}>
            <Text style={{ color: "#fff", fontSize: tokens.type.hero, fontWeight: "800", lineHeight: 46 }}>Drive More.{"\n"}Own Less.</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: tokens.type.lg, marginTop: tokens.spacing.md, marginBottom: tokens.spacing.xl }}>
              Rent, subscribe, or buy cars and bikes. The asset-light mobility marketplace.
            </Text>
            <Pressable
              testID="get-started-btn"
              onPress={() => setMode("signup")}
              style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.9 : 1, backgroundColor: "#fff" }]}
            >
              <Text style={{ color: "#000", fontWeight: "700", fontSize: tokens.type.lg }}>Get Started</Text>
              <Ionicons name="arrow-forward" size={20} color="#000" />
            </Pressable>
            <Pressable testID="have-account-btn" onPress={() => setMode("login")} style={{ marginTop: tokens.spacing.lg, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: tokens.type.base }}>I already have an account</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: tokens.spacing.xl }} keyboardShouldPersistTaps="handled">
          <Pressable testID="back-btn" onPress={() => setMode("intro")} style={{ marginBottom: tokens.spacing.xl }}>
            <Ionicons name="chevron-back" size={28} color={c.onSurface} />
          </Pressable>
          <Text style={{ fontSize: tokens.type.xxxl, fontWeight: "800", color: c.onSurface }}>
            {mode === "login" ? "Welcome back" : "Create account"}
          </Text>
          <Text style={{ fontSize: tokens.type.base, color: c.onSurface2, marginTop: tokens.spacing.sm, marginBottom: tokens.spacing.xl }}>
            {mode === "login" ? "Sign in to continue your journey." : "Join RIDEX. Drive more, own less."}
          </Text>

          {mode === "signup" && (
            <View style={{ marginBottom: tokens.spacing.lg }}>
              <Text style={[styles.label, { color: c.onSurface2 }]}>Name</Text>
              <TextInput
                testID="name-input"
                value={name}
                onChangeText={setName}
                placeholder="John Doe"
                placeholderTextColor={c.onSurface3}
                style={[styles.input, { backgroundColor: c.surface2, color: c.onSurface, borderColor: c.border }]}
              />
            </View>
          )}

          <View style={{ marginBottom: tokens.spacing.lg }}>
            <Text style={[styles.label, { color: c.onSurface2 }]}>Email</Text>
            <TextInput
              testID="email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={c.onSurface3}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[styles.input, { backgroundColor: c.surface2, color: c.onSurface, borderColor: c.border }]}
            />
          </View>

          <View style={{ marginBottom: tokens.spacing.lg }}>
            <Text style={[styles.label, { color: c.onSurface2 }]}>Password</Text>
            <TextInput
              testID="password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={c.onSurface3}
              style={[styles.input, { backgroundColor: c.surface2, color: c.onSurface, borderColor: c.border }]}
            />
          </View>

          {error && (
            <Text testID="auth-error" style={{ color: c.error, marginBottom: tokens.spacing.md }}>{error}</Text>
          )}

          <Pressable
            testID="auth-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, { backgroundColor: c.inverse, opacity: pressed || busy ? 0.85 : 1 }]}
          >
            {busy ? <ActivityIndicator color={c.onInverse} /> : (
              <Text style={{ color: c.onInverse, fontWeight: "700", fontSize: tokens.type.lg }}>
                {mode === "login" ? "Sign In" : "Create Account"}
              </Text>
            )}
          </Pressable>

          <View style={{ flexDirection: "row", alignItems: "center", marginVertical: tokens.spacing.xl }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Text style={{ marginHorizontal: tokens.spacing.md, color: c.onSurface3 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>

          <Pressable
            testID="google-signin-btn"
            disabled={busy}
            onPress={googleSignIn}
            style={({ pressed }) => [styles.cta, { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.9 : 1 }]}
          >
            <Ionicons name="logo-google" size={20} color={c.onSurface} />
            <Text style={{ color: c.onSurface, fontWeight: "600", fontSize: tokens.type.base }}>Continue with Google</Text>
          </Pressable>

          <Pressable testID="toggle-mode-btn" onPress={() => setMode(mode === "login" ? "signup" : "login")} style={{ marginTop: tokens.spacing.xl, alignItems: "center" }}>
            <Text style={{ color: c.onSurface2 }}>
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <Text style={{ color: c.onSurface, fontWeight: "700" }}>{mode === "login" ? "Sign up" : "Sign in"}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16 },
});
