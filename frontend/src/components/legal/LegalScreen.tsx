// RAIDEX_LEGAL_SCREEN_SHELL
// Shared layout + typography primitives for the three static legal documents
// (Terms of Service, Privacy Policy, Refund Policy) so all three read as one
// consistent, calm long-form document rather than three separately-styled
// screens. Reuses this app's existing theme tokens only - no new colors.
import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";

export function LegalScreen({
  title,
  lastUpdated,
  children,
  testID,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }} testID={testID}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg, gap: 12 }}>
          <Pressable testID="legal-back-btn" onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.lg, fontWeight: tokens.weight.bold, flexShrink: 1 }}>
            {title}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: tokens.spacing.xxxl }}>
        <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm, marginBottom: tokens.spacing.xl }}>
          Last updated {lastUpdated}
        </Text>
        {children}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: c.surface2, borderTopWidth: 1, borderTopColor: c.border }}>
        <View style={{ paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface3, fontSize: 11, lineHeight: 15, textAlign: "center" }}>
            This is a draft policy pending legal review — not yet a final, binding document.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ marginBottom: tokens.spacing.xl }}>
      <Text style={{ color: c.onSurface, fontSize: tokens.type.lg, fontWeight: tokens.weight.bold, marginBottom: tokens.spacing.sm }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function LegalParagraph({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Text style={{ color: c.onSurface2, fontSize: tokens.type.base, lineHeight: 21, marginBottom: tokens.spacing.sm }}>
      {children}
    </Text>
  );
}

export function LegalBullet({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 6, paddingLeft: 2 }}>
      <Text style={{ color: c.onSurface3, fontSize: tokens.type.base, lineHeight: 21 }}>{"•"}</Text>
      <Text style={{ color: c.onSurface2, fontSize: tokens.type.base, lineHeight: 21, flex: 1 }}>{children}</Text>
    </View>
  );
}

export function LegalSubheading({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Text style={{ color: c.onSurface, fontSize: tokens.type.base, fontWeight: tokens.weight.semibold, marginTop: tokens.spacing.xs, marginBottom: tokens.spacing.xs }}>
      {children}
    </Text>
  );
}
