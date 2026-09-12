import React, { useEffect } from "react";
import { View, ViewStyle } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";

export function RaidexSkeleton({ width = "100%", height = 16, radius = tokens.radius.sm, style }: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const c = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ width: width as any, height, borderRadius: radius, backgroundColor: c.surface3 }, animatedStyle, style]}
    />
  );
}

// A ready-made skeleton for the vehicle-card grid, so discovery/home never
// shows a blank surface + spinner on first load.
export function RaidexVehicleCardSkeleton() {
  const c = useTheme();
  return (
    <View style={{ borderRadius: tokens.radius.lg, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, overflow: "hidden", marginBottom: tokens.spacing.md }}>
      <RaidexSkeleton height={160} radius={0} />
      <View style={{ padding: tokens.spacing.md, gap: 8 }}>
        <RaidexSkeleton width="70%" height={16} />
        <RaidexSkeleton width="40%" height={12} />
        <RaidexSkeleton width="50%" height={20} />
      </View>
    </View>
  );
}
