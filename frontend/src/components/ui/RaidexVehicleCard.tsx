import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from "react-native-reanimated";
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
  testID?: string;
}) {
  const c = useTheme();
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = withDelay(Math.min(index, 6) * 40, withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) }));
  }, [appear, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 14 }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [
          { borderRadius: tokens.radius.lg, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, overflow: "hidden", opacity: pressed ? 0.96 : 1 },
          elevation.low,
        ]}
      >
        <View>
          <Image source={vehicle.image} style={{ width: "100%", height: 170 }} contentFit="cover" transition={200} />
          {vehicle.instant_book !== false && (
            <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: tokens.radius.sm }}>
              <Ionicons name="flash" size={10} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: tokens.weight.black }}>INSTANT</Text>
            </View>
          )}
          {onToggleWish && (
            <Pressable
              testID={testID ? `${testID}-wish` : undefined}
              onPress={(e) => { e.stopPropagation?.(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onToggleWish(); }}
              style={{ position: "absolute", top: 8, right: 8, width: 34, height: 34, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name={wished ? "heart" : "heart-outline"} size={18} color={wished ? "#EF4444" : "#fff"} />
            </Pressable>
          )}
        </View>

        <View style={{ padding: tokens.spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ color: c.onSurface, fontSize: tokens.type.lg, fontWeight: tokens.weight.bold }} numberOfLines={1}>{vehicle.name}</Text>
              <Text style={{ color: c.onSurface3, fontSize: tokens.type.sm, marginTop: 2 }}>{vehicle.location}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface, paddingHorizontal: 8, paddingVertical: 5, borderRadius: tokens.radius.sm }}>
              <Ionicons name="star" size={12} color="#F59E0B" />
              <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 12 }}>{vehicle.rating.toFixed(1)}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: tokens.spacing.sm }}>
            {vehicle.seats != null && <VehicleTag c={c} icon="people" text={String(vehicle.seats)} />}
            {vehicle.transmission && <VehicleTag c={c} icon="speedometer" text={vehicle.transmission} />}
            {vehicle.fuel_type && <VehicleTag c={c} icon="flash" text={vehicle.fuel_type} />}
            {vehicle.distance_km != null && <VehicleTag c={c} icon="location" text={`${vehicle.distance_km} km`} />}
            <VehicleTag c={c} icon="shield-checkmark" text={`${vehicle.trust_score ?? 92} trust`} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: tokens.spacing.md, paddingTop: tokens.spacing.md, borderTopWidth: 1, borderTopColor: c.border }}>
            <View>
              <Text style={{ color: c.onSurface3, fontSize: 11 }}>per day</Text>
              <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: tokens.weight.black }}>₹{vehicle.price_per_day.toLocaleString()}</Text>
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

function VehicleTag({ c, icon, text }: { c: any; icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: c.surface, paddingHorizontal: 7, paddingVertical: 4, borderRadius: tokens.radius.sm }}>
      <Ionicons name={icon} size={11} color={c.onSurface3} />
      <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: tokens.weight.medium }}>{text}</Text>
    </View>
  );
}
