import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";

// A small accent/neutral label - "NEW", "INSTANT BOOK", a category tag - as
// distinct from RaidexStatusPill, which always maps a lifecycle status to a
// semantic (positive/warning/negative) color.
export function RaidexBadge({
  label,
  icon,
  tone = "accent",
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: "accent" | "neutral" | "inverse";
}) {
  const c = useTheme();
  const colors = {
    accent: { bg: c.accentBg, fg: c.onAccentBg },
    neutral: { bg: c.surface3, fg: c.onSurface2 },
    inverse: { bg: c.inverse, fg: c.onInverse },
  }[tone];

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: tokens.radius.sm, backgroundColor: colors.bg, alignSelf: "flex-start" }}>
      {icon && <Ionicons name={icon} size={11} color={colors.fg} />}
      <Text style={{ color: colors.fg, fontSize: 10, fontWeight: tokens.weight.black, letterSpacing: 0.4 }}>{label}</Text>
    </View>
  );
}
