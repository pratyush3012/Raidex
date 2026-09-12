import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";
import { RaidexButton } from "./RaidexButton";

export function RaidexEmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View testID={testID} style={{ alignItems: "center", padding: tokens.spacing.xxl }}>
      <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center", marginBottom: tokens.spacing.md }}>
        <Ionicons name={icon} size={30} color={c.onSurface3} />
      </View>
      <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg, textAlign: "center" }}>{title}</Text>
      {subtitle ? (
        <Text style={{ color: c.onSurface3, fontSize: tokens.type.base, textAlign: "center", marginTop: 6, lineHeight: 20 }}>{subtitle}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: tokens.spacing.lg, alignItems: "center" }}>
          <RaidexButton label={actionLabel} onPress={onAction} variant="secondary" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}
