import React, { useEffect } from "react";
import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// Owner/admin KPI tile - replaces the "Kpi"/metric-tile component that was
// independently redefined per screen. Animates a numeric value counting up
// on mount/change so dashboards feel alive rather than static-flip. The
// counter is a non-editable TextInput (the standard Reanimated pattern for
// an animated numeric display - plain Text has no settable native "text"
// prop Reanimated can drive without a re-render each frame).
export function RaidexMetricCard({
  label,
  value,
  icon,
  numeric,
  prefix = "",
  testID,
}: {
  label: string;
  value: string | number;
  icon?: keyof typeof Ionicons.glyphMap;
  /** When provided, animates counting up to this number; `value` is used as the display fallback otherwise. */
  numeric?: number;
  prefix?: string;
  testID?: string;
}) {
  const c = useTheme();
  const animated = useSharedValue(0);

  useEffect(() => {
    if (numeric != null) animated.value = withTiming(numeric, { duration: tokens.motion.slow });
  }, [numeric, animated]);

  const animatedProps = useAnimatedProps(() => {
    return { text: `${prefix}${Math.round(animated.value).toLocaleString()}` } as any;
  });

  return (
    <View testID={testID} style={{ flex: 1, padding: tokens.spacing.md, borderRadius: tokens.radius.lg, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
      {icon && <Ionicons name={icon} size={16} color={c.onSurface3} style={{ marginBottom: 4 }} />}
      <Text style={{ color: c.onSurface3, fontSize: 10, fontWeight: tokens.weight.bold, letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      {numeric != null ? (
        <AnimatedTextInput
          editable={false}
          underlineColorAndroid="transparent"
          animatedProps={animatedProps}
          defaultValue={`${prefix}${numeric.toLocaleString()}`}
          style={{ color: c.onSurface, fontSize: 22, fontWeight: tokens.weight.bold, marginTop: 4, padding: 0 }}
        />
      ) : (
        <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: tokens.weight.bold, marginTop: 4 }}>{value}</Text>
      )}
    </View>
  );
}
