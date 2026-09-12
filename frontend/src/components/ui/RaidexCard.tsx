import React from "react";
import { View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme, tokens, elevation } from "@/src/theme";

export type RaidexCardVariant = "flat" | "elevated" | "dark";

export function RaidexCard({
  variant = "flat",
  padding = tokens.spacing.lg,
  style,
  children,
  testID,
}: {
  variant?: RaidexCardVariant;
  padding?: number;
  style?: ViewStyle;
  children: React.ReactNode;
  testID?: string;
}) {
  const c = useTheme();

  if (variant === "dark") {
    return (
      <LinearGradient
        testID={testID}
        colors={["#000000", "#1A1A1A"]}
        style={[{ borderRadius: tokens.radius.lg, padding }, style]}
      >
        {children}
      </LinearGradient>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        {
          borderRadius: tokens.radius.lg,
          padding,
          backgroundColor: c.surface2,
          borderWidth: variant === "flat" ? 1 : 0,
          borderColor: c.border,
        },
        variant === "elevated" ? elevation.medium : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}
