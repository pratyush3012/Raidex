import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";

import { useTheme, tokens } from "@/src/theme";
import { RaidexButton, RaidexCard, RaidexInput } from "@/src/components/ui";
import {
  PlaceResult, SEED_AREAS, saveLocation, searchPlace,
} from "@/src/utils/location";

// Real location capture, end to end:
//  1) GPS via expo-location (foreground permission, then getCurrentPositionAsync)
//     - explained up front, never cold-requested. Falls back honestly to
//       manual entry on denial/failure rather than faking a position, mirroring
//       the real-GPS/honest-fallback convention in app/trip/[booking_id].tsx.
//  2) Manual entry as a first-class alternative, not just a fallback:
//     - a quick-pick list of the real Mumbai areas Raidex vehicles exist in
//       today (from backend seed data - see src/utils/location.ts), zero
//       network dependency.
//     - free-text search via Nominatim (OpenStreetMap, no API key) for
//       anywhere else.
export default function LocationScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(14);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) });
  }, [opacity, translateY]);
  const entrance = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));

  const finish = async (loc: { lat: number; lng: number; label: string; source: "gps" | "seed_area" | "search" }) => {
    setSavingLabel(loc.label);
    await saveLocation(loc);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const useMyLocation = async () => {
    setGpsError(null);
    setGpsBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setGpsError("Location permission was not granted. Pick an area below instead.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      // Best-effort human-readable label via the device's own geocoder. This
      // is a real lookup, not a guess - if it fails or isn't supported
      // (e.g. web), we fall back to the real coordinates as the label rather
      // than inventing a place name.
      let label = `Current location (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      try {
        const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const p = places?.[0];
        const named = [p?.district || p?.subregion || p?.city, p?.region].filter(Boolean).join(", ");
        if (named) label = named;
      } catch {
        // Reverse geocoding unsupported/unavailable here - coordinate label above stands.
      }
      await finish({ lat, lng, label, source: "gps" });
    } catch {
      setGpsError("Could not get your GPS location. Pick an area below instead.");
    } finally {
      setGpsBusy(false);
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const found = await searchPlace(query);
      if (found.length === 0) setSearchError("No matches. Try a different search, or pick an area below.");
      setResults(found);
    } catch {
      setSearchError("Search is unavailable right now. Pick an area below instead.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <Animated.View style={[{ flex: 1 }, entrance]}>
          <View style={[styles.headerRow, { paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md }]}>
            <Pressable
              testID="location-back-btn"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
              style={[styles.backCircle, { backgroundColor: c.surface2, borderColor: c.border }]}
            >
              <Ionicons name="close" size={20} color={c.onSurface} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={[styles.iconWrap, { backgroundColor: c.accentBg }]}>
              <Ionicons name="location" size={26} color={c.onAccentBg} />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 24, fontWeight: "900", marginTop: 16 }}>Find vehicles near you</Text>
            <Text style={{ color: c.onSurface2, fontSize: 14, marginTop: 8, lineHeight: 20 }}>
              Raidex uses your location to show real distances and let you filter or sort vehicles by how close they
              actually are. We only use it for this - never shared, never sold.
            </Text>

            <View style={{ marginTop: 24 }}>
              <RaidexButton
                testID="use-current-location-btn"
                label={gpsBusy ? "Getting your location..." : "Use my current location"}
                icon="navigate"
                onPress={useMyLocation}
                loading={gpsBusy}
                disabled={!!savingLabel}
              />
              {gpsError && (
                <Text style={{ color: c.error, fontSize: 12.5, marginTop: 10, lineHeight: 17 }}>{gpsError}</Text>
              )}
            </View>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
              <Text style={{ color: c.onSurface3, fontSize: 12, fontWeight: "800" }}>OR CHOOSE MANUALLY</Text>
              <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
            </View>

            <RaidexInput
              testID="location-search-input"
              label="Search for an area"
              icon="search"
              placeholder="e.g. Colaba, Mumbai"
              value={query}
              onChangeText={(t) => { setQuery(t); setSearchError(null); }}
              returnKeyType="search"
              onSubmitEditing={runSearch}
              editable={!savingLabel}
            />
            <RaidexButton
              testID="location-search-btn"
              label={searching ? "Searching..." : "Search"}
              variant="secondary"
              size="md"
              onPress={runSearch}
              loading={searching}
              disabled={!query.trim() || !!savingLabel}
            />
            {searchError && (
              <Text style={{ color: c.onSurface3, fontSize: 12.5, marginTop: 10, lineHeight: 17 }}>{searchError}</Text>
            )}

            {results.length > 0 && (
              <View style={{ marginTop: 16, gap: 10 }}>
                {results.map((r, i) => (
                  <PlaceRow
                    key={`${r.lat}-${r.lng}-${i}`}
                    c={c}
                    label={r.label}
                    disabled={!!savingLabel}
                    onPress={() => finish({ lat: r.lat, lng: r.lng, label: r.label, source: "search" })}
                  />
                ))}
              </View>
            )}

            <Text style={{ color: c.onSurface2, fontSize: 12.5, fontWeight: "800", marginTop: 28, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
              Areas with vehicles today
            </Text>
            <View style={{ gap: 10 }}>
              {SEED_AREAS.map((area) => (
                <PlaceRow
                  key={area.label}
                  c={c}
                  label={area.label}
                  disabled={!!savingLabel}
                  onPress={() => finish({ lat: area.lat, lng: area.lng, label: area.label, source: "seed_area" })}
                />
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function PlaceRow({ c, label, onPress, disabled }: { c: any; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable testID={`location-option-${label}`} onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
      <RaidexCard style={styles.placeCard}>
        <Ionicons name="location-outline" size={18} color={c.onSurface3} />
        <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 14, flex: 1 }} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={c.onSurface3} />
      </RaidexCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backCircle: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 8 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 22 },
  dividerLine: { flex: 1, height: 1 },
  placeCard: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
});
