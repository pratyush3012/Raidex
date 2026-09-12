import React from "react";
import { ActivityIndicator, Pressable, Text, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";

export type RaidexButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type RaidexButtonSize = "md" | "lg";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function RaidexButton({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  iconPosition = "trailing",
  loading = false,
  disabled = false,
  fullWidth = true,
  haptics = true,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: RaidexButtonVariant;
  size?: RaidexButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: "leading" | "trailing";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  haptics?: boolean;
  testID?: string;
  style?: ViewStyle;
}) {
  const c = useTheme();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const colors = {
    primary: { bg: c.inverse, fg: c.onInverse, border: c.inverse },
    secondary: { bg: c.surface2, fg: c.onSurface, border: c.border },
    ghost: { bg: "transparent", fg: c.onSurface, border: "transparent" },
    destructive: { bg: c.error, fg: "#fff", border: c.error },
  }[variant];

  const height = size === "lg" ? 56 : 46;

  return (
    <AnimatedPressable
      testID={testID}
      disabled={isDisabled}
      onPressIn={() => { scale.value = withTiming(0.97, { duration: tokens.motion.quick }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: tokens.motion.quick }); }}
      onPress={() => {
        if (haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={[
        {
          height,
          minWidth: fullWidth ? undefined : 120,
          width: fullWidth ? "100%" : undefined,
          borderRadius: tokens.radius.lg,
          backgroundColor: colors.bg,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: isDisabled ? 0.5 : 1,
        },
        animatedStyle,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <>
          {icon && iconPosition === "leading" && <Ionicons name={icon} size={18} color={colors.fg} />}
          <Text style={{ color: colors.fg, fontWeight: tokens.weight.bold, fontSize: size === "lg" ? 16 : 14 }}>{label}</Text>
          {icon && iconPosition === "trailing" && <Ionicons name={icon} size={18} color={colors.fg} />}
        </>
      )}
    </AnimatedPressable>
  );
}
