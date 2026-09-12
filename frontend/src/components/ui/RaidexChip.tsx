import React from "react";
import { Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";

export function RaidexChip({
  label,
  icon,
  active = false,
  onPress,
  testID,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 36,
        paddingHorizontal: tokens.spacing.md,
        borderRadius: tokens.radius.pill,
        borderWidth: 1,
        backgroundColor: active ? c.inverse : c.surface2,
        borderColor: active ? c.inverse : c.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon && <Ionicons name={icon} size={14} color={active ? c.onInverse : c.onSurface} />}
      <Text style={{ color: active ? c.onInverse : c.onSurface, fontWeight: tokens.weight.bold, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
