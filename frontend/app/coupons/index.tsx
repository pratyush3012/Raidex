// RAIDEX_FRONTEND_COUPONS_SCREEN
// Search tags: coupons, promo codes, discounts, /coupons endpoint.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api/client";
import { useTheme, tokens } from "@/src/theme";
import { RaidexBadge, RaidexCard, RaidexEmptyState, RaidexErrorState, RaidexSkeleton } from "@/src/components/ui";

type Coupon = {
  code: string;
  description: string;
  type: "percent" | "flat";
  value: number;
  max_discount: number | null;
  min_amount: number | null;
  expires_at: string | null;
};

// Builds the discount terms straight from the API's own fields - never a
// hand-written/invented number - so "10% off, up to ₹500" or "₹100 off"
// always matches exactly what /coupons/validate would actually apply.
function discountTerms(item: Coupon): string {
  if (item.type === "percent") {
    return item.max_discount
      ? `${item.value}% off, up to ₹${item.max_discount.toLocaleString()}`
      : `${item.value}% off`;
  }
  return `₹${item.value.toLocaleString()} off`;
}

export default function CouponsScreen() {
  const c = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Coupon[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api<Coupon[]>("/coupons");
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Could not load coupons.");
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

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg }}>
          <Pressable testID="back-btn" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold, marginLeft: 8 }}>
            Coupons
          </Text>
        </View>
      </SafeAreaView>

      <FlatList
        data={items ?? []}
        keyExtractor={(it) => it.code}
        contentContainerStyle={{ padding: tokens.spacing.xl, paddingTop: 0, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        ItemSeparatorComponent={() => <View style={{ height: tokens.spacing.md }} />}
        ListEmptyComponent={
          items === null ? (
            <View style={{ gap: tokens.spacing.lg }} testID="coupons-loading-skeleton">
              <RaidexSkeleton height={110} radius={tokens.radius.lg} />
              <RaidexSkeleton height={110} radius={tokens.radius.lg} />
              <RaidexSkeleton height={110} radius={tokens.radius.lg} />
            </View>
          ) : error ? (
            <RaidexErrorState testID="coupons-error-state" message={error} onRetry={load} />
          ) : (
            <RaidexEmptyState
              testID="coupons-empty-state"
              icon="pricetag-outline"
              title="No coupons available right now"
              subtitle="Check back later for new offers and discounts."
            />
          )
        }
        renderItem={({ item }) => (
          <RaidexCard testID={`coupon-card-${item.code}`} variant="flat">
            <RaidexBadge label={item.code} icon="pricetag" tone="accent" />
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.black, fontSize: tokens.type.lg, marginTop: 10 }}>
              {discountTerms(item)}
            </Text>
            {item.description ? (
              <Text style={{ color: c.onSurface2, fontSize: 13, marginTop: 4 }}>{item.description}</Text>
            ) : null}
            <View style={{ marginTop: 8, gap: 3 }}>
              {item.min_amount ? (
                <Text style={{ color: c.onSurface3, fontSize: 12 }}>
                  Min. order ₹{item.min_amount.toLocaleString()}
                </Text>
              ) : null}
              {item.expires_at ? (
                <Text style={{ color: c.onSurface3, fontSize: 12 }}>
                  Expires {new Date(item.expires_at).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
          </RaidexCard>
        )}
      />
    </View>
  );
}
