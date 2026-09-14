import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { getWishlist, removeWishlist } from "@/src/features/wishlist/api/wishlist";
import { tokens, useTheme } from "@/src/theme";
import {
  RaidexEmptyState, RaidexErrorState, RaidexSkeleton, RaidexStatusPill, RaidexVehicleCard,
} from "@/src/components/ui";
import type { RaidexVehicleCardData } from "@/src/components/ui";

type WishlistSnapshot = { name: string; image: string; location: string; price_per_day: number; rating: number };
type WishlistEntry = { user_id: string; vehicle_id: string; vehicle_snapshot: WishlistSnapshot; created_at: string };

type FavoriteItem = {
  vehicle_id: string;
  snapshot: WishlistSnapshot;
  // Full, live vehicle record when it still exists and is bookable - `null`
  // means the listing is gone (deleted) or the owner has taken it offline,
  // and we only ever learn that by actually asking the backend, never by
  // guessing from the saved snapshot alone.
  vehicle: RaidexVehicleCardData | null;
  available: boolean;
};

export default function FavoritesScreen() {
  const c = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<FavoriteItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const wishlist = await getWishlist() as WishlistEntry[];
      const hydrated = await Promise.all(
        wishlist.map(async (entry): Promise<FavoriteItem> => {
          try {
            const vehicle = await api<RaidexVehicleCardData & { available?: boolean }>(`/vehicles/${entry.vehicle_id}`);
            return {
              vehicle_id: entry.vehicle_id,
              snapshot: entry.vehicle_snapshot,
              vehicle,
              available: vehicle.available !== false,
            };
          } catch {
            // Vehicle lookup failed (most likely a 404 - delisted/removed) -
            // still show the saved card using the snapshot Raidex captured
            // when it was wishlisted, but marked plainly as no longer available.
            return { vehicle_id: entry.vehicle_id, snapshot: entry.vehicle_snapshot, vehicle: null, available: false };
          }
        })
      );
      setItems(hydrated);
    } catch (e: any) {
      setError(e.message || "Could not load your saved vehicles.");
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const removeFavorite = async (vehicleId: string) => {
    setItems((cur) => (cur ? cur.filter((it) => it.vehicle_id !== vehicleId) : cur));
    try {
      await removeWishlist(vehicleId);
    } catch (e: any) {
      Alert.alert("Favorites", e.message || "Could not remove this vehicle from favorites.");
      load();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md }}>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xxxl, fontWeight: tokens.weight.bold }}>Favorites</Text>
        </View>
      </SafeAreaView>

      <FlatList
        data={items ?? []}
        keyExtractor={(it) => it.vehicle_id}
        contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        ItemSeparatorComponent={() => <View style={{ height: tokens.spacing.lg }} />}
        ListEmptyComponent={
          items === null ? (
            <View style={{ gap: tokens.spacing.lg }} testID="favorites-loading-skeleton">
              <RaidexSkeleton height={280} radius={tokens.radius.lg} />
              <RaidexSkeleton height={280} radius={tokens.radius.lg} />
            </View>
          ) : error ? (
            <RaidexErrorState message={error} onRetry={load} testID="favorites-error-state" />
          ) : (
            <RaidexEmptyState
              icon="heart-outline"
              title="Save vehicles you love"
              subtitle="Tap the heart on any vehicle to save it here for quick access later."
              actionLabel="Explore vehicles"
              onAction={() => router.push("/(tabs)" as any)}
              testID="favorites-empty-state"
            />
          )
        }
        renderItem={({ item, index }) =>
          item.available && item.vehicle ? (
            <RaidexVehicleCard
              testID={`favorite-card-${item.vehicle_id}`}
              index={index}
              vehicle={item.vehicle}
              onPress={() => router.push(`/vehicle/${item.vehicle_id}`)}
              wished
              onToggleWish={() => removeFavorite(item.vehicle_id)}
            />
          ) : (
            <View testID={`favorite-card-unavailable-${item.vehicle_id}`} style={styles.unavailableWrap}>
              <RaidexStatusPill status="unlisted" label="No longer listed" />
              <View style={{ opacity: 0.55 }}>
                <RaidexVehicleCard
                  index={index}
                  vehicle={{
                    vehicle_id: item.vehicle_id,
                    name: item.snapshot.name,
                    image: item.snapshot.image,
                    location: item.snapshot.location,
                    rating: item.snapshot.rating,
                    price_per_day: item.snapshot.price_per_day,
                    instant_book: false,
                  }}
                  onPress={() => Alert.alert("No longer available", "This vehicle isn't listed on Raidex anymore.")}
                  wished
                  onToggleWish={() => removeFavorite(item.vehicle_id)}
                />
              </View>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  unavailableWrap: { gap: tokens.spacing.sm },
});
