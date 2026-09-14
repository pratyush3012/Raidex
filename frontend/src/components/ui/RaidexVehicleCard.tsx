import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, Easing,
} from "react-native-reanimated";
import { useTheme, tokens, elevation } from "@/src/theme";

export type RaidexVehicleCardData = {
  vehicle_id: string;
  name: string;
  image: string;
  location: string;
  rating: number;
  seats?: number;
  transmission?: string;
  fuel_type?: string;
  distance_km?: number;
  trust_score?: number;
  instant_book?: boolean;
  price_per_day: number;
};

// A results list decides "BEST VALUE" / "TOP RATED" from real data it can see
// across the whole set (cheapest, highest-rated) - the card itself never
// invents a badge, it only renders one it's told about.
export type RaidexVehicleCardBadge = "best_value" | "top_rated";
const BADGE_COPY: Record<RaidexVehicleCardBadge, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  best_value: { label: "BEST VALUE", icon: "pricetag" },
  top_rated: { label: "TOP RATED", icon: "sparkles" },
};

export function RaidexVehicleCard({
  vehicle,
  onPress,
  index = 0,
  wished,
  onToggleWish,
  selected,
  onToggleSelect,
  selectLabel = "Compare",
  selectTestID,
  badge,
  testID,
}: {
  vehicle: RaidexVehicleCardData;
  onPress: () => void;
  index?: number;
  wished?: boolean;
  onToggleWish?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  selectLabel?: string;
  // Overrides the default `${testID}-select` testID on the select toggle -
  // needed by callers (e.g. vehicle swap) that must keep a pre-existing,
  // differently-shaped testID on that control.
  selectTestID?: string;
  badge?: RaidexVehicleCardBadge;
  testID?: string;
}) {
  const c = useTheme();
  const appear = useSharedValue(0);
  const press = useSharedValue(1);
  const heartPop = useSharedValue(1);

  useEffect(() => {
    appear.value = withDelay(Math.min(index, 6) * 40, withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) }));
  }, [appear, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 14 }, { scale: press.value }],
  }));
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartPop.value }] }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onPressIn={() => { press.value = withTiming(0.985, { duration: tokens.motion.quick }); }}
        onPressOut={() => { press.value = withTiming(1, { duration: tokens.motion.quick }); }}
        style={[
          { borderRadius: tokens.radius.lg, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
          elevation.low,
        ]}
      >
        <View>
          <Image source={vehicle.image} style={{ width: "100%", height: 176 }} contentFit="cover" transition={250} />
          <LinearGradient
            colors={["rgba(10,10,14,0.5)", "rgba(10,10,14,0)", "rgba(10,10,14,0)", "rgba(10,10,14,0.65)"]}
            locations={[0, 0.22, 0.6, 1]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />

          <View style={{ position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between" }}>
            {badge ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.accent, paddingHorizontal: 9, paddingVertical: 5, borderRadius: tokens.radius.sm }}>
                <Ionicons name={BADGE_COPY[badge].icon} size={10} color={c.onInverse} />
                <Text style={{ color: c.onInverse, fontSize: 10, fontWeight: tokens.weight.black }}>{BADGE_COPY[badge].label}</Text>
              </View>
            ) : vehicle.instant_book !== false ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: tokens.radius.sm }}>
                <Ionicons name="flash" size={10} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: tokens.weight.black }}>INSTANT</Text>
              </View>
            ) : <View />}

            {onToggleWish && (
              <Animated.View style={heartStyle}>
                <Pressable
                  testID={testID ? `${testID}-wish` : undefined}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    heartPop.value = withSequence(withTiming(1.3, { duration: 110 }), withTiming(1, { duration: 160 }));
                    onToggleWish();
                  }}
                  style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name={wished ? "heart" : "heart-outline"} size={17} color={wished ? "#EF4444" : "#fff"} />
                </Pressable>
              </Animated.View>
            )}
          </View>

          <View style={{ position: "absolute", left: 12, bottom: 10, right: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ color: "#fff", fontSize: tokens.type.lg, fontWeight: tokens.weight.bold }} numberOfLines={1}>{vehicle.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                <Ionicons name="location" size={11} color="rgba(255,255,255,0.75)" />
                <Text style={{ color: "rgba(255,255,255,0.82)", fontSize: 11.5, fontWeight: "600" }} numberOfLines={1}>{vehicle.location}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 5, borderRadius: tokens.radius.sm }}>
              <Ionicons name="star" size={12} color={c.gold} />
              <Text style={{ color: "#fff", fontWeight: tokens.weight.bold, fontSize: 12 }}>{vehicle.rating.toFixed(1)}</Text>
            </View>
          </View>
        </View>

        <View style={{ padding: tokens.spacing.lg }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {vehicle.seats != null && <VehicleTag c={c} icon="people" text={String(vehicle.seats)} />}
            {vehicle.transmission && <VehicleTag c={c} icon="speedometer" text={vehicle.transmission} />}
            {vehicle.fuel_type && <VehicleTag c={c} icon="flash" text={vehicle.fuel_type} />}
            {vehicle.distance_km != null && <VehicleTag c={c} icon="navigate" text={`${vehicle.distance_km} km`} />}
            <VehicleTag c={c} icon="shield-checkmark" text={`${vehicle.trust_score ?? 92} trust`} tone="accent" />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: tokens.spacing.md, paddingTop: tokens.spacing.md, borderTopWidth: 1, borderTopColor: c.border }}>
            <View>
              <Text style={{ color: c.onSurface3, fontSize: 11 }}>per day</Text>
              <Text style={{ color: c.onSurface, fontSize: 21, fontWeight: tokens.weight.black }}>₹{vehicle.price_per_day.toLocaleString()}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.inverse, paddingHorizontal: 14, paddingVertical: 10, borderRadius: tokens.radius.md }}>
              <Text style={{ color: c.onInverse, fontWeight: tokens.weight.bold }}>View</Text>
              <Ionicons name="arrow-forward" size={14} color={c.onInverse} />
            </View>
          </View>

          {onToggleSelect && (
            <Pressable
              testID={selectTestID ?? (testID ? `${testID}-select` : undefined)}
              onPress={(e) => { e.stopPropagation?.(); onToggleSelect(); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: tokens.spacing.md, alignSelf: "flex-start" }}
            >
              <Ionicons name={selected ? "checkbox" : "square-outline"} size={16} color={selected ? c.accent : c.onSurface3} />
              <Text style={{ color: c.onSurface2, fontWeight: tokens.weight.semibold, fontSize: 12 }}>{selectLabel}</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function VehicleTag({ c, icon, text, tone }: { c: any; icon: keyof typeof Ionicons.glyphMap; text: string; tone?: "accent" }) {
  const accent = tone === "accent";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: accent ? c.accentBg : c.surface, paddingHorizontal: 7, paddingVertical: 4, borderRadius: tokens.radius.sm }}>
      <Ionicons name={icon} size={11} color={accent ? c.onAccentBg : c.onSurface3} />
      <Text style={{ color: accent ? c.onAccentBg : c.onSurface2, fontSize: 11, fontWeight: tokens.weight.medium }}>{text}</Text>
    </View>
  );
}
