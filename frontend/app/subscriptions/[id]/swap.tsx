import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexCard, RaidexPriceCard, RaidexModal, RaidexEmptyState, RaidexErrorState, RaidexVehicleCard } from "@/src/components/ui";

export default function VehicleSwapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [pickVehicle, setPickVehicle] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const flag = await api<{ flag: string; enabled: boolean }>("/features/vehicle_swap");
      setEnabled(!!flag.enabled);
      const s = await api<any>(`/subscriptions/${id}`);
      setSub(s);
      if (flag.enabled) {
        const all = await api<any[]>("/vehicles?available=true");
        setVehicles(all.filter((v) => v.vehicle_id !== s.vehicle_id));
      }
    } catch (e: any) {
      setError(e.message || "Could not load subscription");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onSwapped = (result: any) => {
    setPickVehicle(null);
    if (result.status === "completed") {
      Alert.alert("Vehicle swapped", "Your subscription now points to the new vehicle.", [
        { text: "OK", onPress: () => router.replace("/subscriptions" as any) },
      ]);
    } else {
      Alert.alert("Swap requested", "Your swap request needs admin approval before it takes effect. We'll notify you once it's reviewed.", [
        { text: "OK", onPress: () => router.replace("/subscriptions" as any) },
      ]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg }}>
          <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold, marginLeft: 8 }}>Swap vehicle</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.accent} size="large" />
        </View>
      ) : error || !sub ? (
        <RaidexErrorState title="Could not load subscription" message={error ?? undefined} onRetry={load} />
      ) : !enabled ? (
        <View testID="swap-coming-soon" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <RaidexEmptyState
            icon="swap-horizontal"
            title="Vehicle swap coming soon"
            subtitle="Swapping vehicles on an active subscription isn't live for your account yet."
          />
        </View>
      ) : sub.status !== "active" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <RaidexEmptyState
            icon="alert-circle-outline"
            title="Subscription must be active"
            subtitle={`This subscription is ${sub.status.replace("_", " ")}, so it isn't eligible for a vehicle swap.`}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: 100 }}>
          <RaidexCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Image source={sub.vehicle_snapshot?.image} style={{ width: 60, height: 60, borderRadius: tokens.radius.md }} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold }}>CURRENT VEHICLE</Text>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, marginTop: 2 }}>{sub.vehicle_snapshot?.name}</Text>
              </View>
            </View>
          </RaidexCard>

          <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16, marginTop: 20, marginBottom: 12 }}>Choose a new vehicle</Text>
          {vehicles.length === 0 ? (
            <RaidexEmptyState
              icon="car-outline"
              title="No vehicles available"
              subtitle="No other vehicles are currently available to swap into."
            />
          ) : (
            vehicles.map((v, i) => (
              <View key={v.vehicle_id} style={{ marginBottom: tokens.spacing.sm }}>
                <RaidexVehicleCard
                  testID={`swap-vehicle-${v.vehicle_id}`}
                  index={i}
                  vehicle={{
                    vehicle_id: v.vehicle_id,
                    name: v.name,
                    image: v.image,
                    location: v.location,
                    rating: v.rating ?? 0,
                    seats: v.seats,
                    transmission: v.transmission,
                    fuel_type: v.fuel_type,
                    price_per_day: v.price_per_day ?? 0,
                  }}
                  onPress={() => setPickVehicle(v)}
                  selected={pickVehicle?.vehicle_id === v.vehicle_id}
                  onToggleSelect={() => setPickVehicle(v)}
                  selectLabel={`Select for swap · ₹${v.price_per_month?.toLocaleString()}/month`}
                  selectTestID={`select-swap-${v.vehicle_id}`}
                />
              </View>
            ))
          )}
        </ScrollView>
      )}

      {pickVehicle && (
        <SwapQuoteModal c={c} sub={sub} vehicle={pickVehicle} onClose={() => setPickVehicle(null)} onSwapped={onSwapped} />
      )}
    </View>
  );
}

function SwapQuoteModal({ c, sub, vehicle, onClose, onSwapped }: any) {
  const [quote, setQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = await api<any>(`/subscriptions/${sub.subscription_id}/swap/quote?new_vehicle_id=${vehicle.vehicle_id}`);
        if (!cancelled) setQuote(q);
      } catch (e: any) {
        if (!cancelled) Alert.alert("Error", e.message);
      } finally {
        if (!cancelled) setLoadingQuote(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sub.subscription_id, vehicle.vehicle_id]);

  const confirmSwap = async () => {
    setBusy(true);
    // Kick off the "old vehicle -> swap -> new vehicle" transition immediately
    // on tap so the crossfade plays while the request is in flight, not after -
    // the signature moment shouldn't wait on the network.
    setConfirmed(true);
    try {
      const result = await api<any>(`/subscriptions/${sub.subscription_id}/swap`, {
        method: "POST",
        body: { new_vehicle_id: vehicle.vehicle_id },
      });
      // Give the crossfade + icon beat time to read before handing off to the
      // result alert (~ 2x the crossfade duration).
      setTimeout(() => onSwapped(result), 900);
    } catch (e: any) {
      setConfirmed(false);
      Alert.alert("Error", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RaidexModal
      visible
      onDismiss={onClose}
      title={confirmed ? "Swapping your vehicle" : `Swap to ${vehicle.name}`}
      dismissLabel={confirmed ? "Close" : "Cancel"}
      primaryLabel={confirmed ? undefined : "Confirm swap"}
      onPrimary={confirmed ? undefined : confirmSwap}
      primaryBusy={busy}
      primaryDisabled={busy || !quote}
      primaryTestID="confirm-swap-btn"
      dismissTestID="close-swap-modal-btn"
      testID="swap-modal"
    >
      {confirmed ? (
        <SwapTransition c={c} from={sub.vehicle_snapshot} to={vehicle} />
      ) : (
        <>
          {loadingQuote ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: 4 }} />
          ) : quote ? (
            <RaidexPriceCard
              testID="swap-fee-total"
              totalLabel="Swap fee"
              total={`₹${quote.fee_amount.toLocaleString()}`}
              lines={[
                { label: "Included in your plan", value: quote.included_swap ? "Yes" : "No" },
                { label: "Price difference", value: `₹${quote.price_diff.toLocaleString()}` },
              ]}
            />
          ) : null}
          {quote?.fee_amount === 0 && (
            <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 8 }}>This swap is free — no charge will be made.</Text>
          )}
        </>
      )}
    </RaidexModal>
  );
}

// The named "signature moment": the current vehicle card crossfades into the
// newly-selected one, with a brief swap-horizontal icon beat in between,
// instead of just cutting straight to a result alert.
function SwapTransition({ c, from, to }: { c: any; from: any; to: any }) {
  const fromOpacity = useSharedValue(1);
  const toOpacity = useSharedValue(0);
  const iconScale = useSharedValue(0.6);
  const iconOpacity = useSharedValue(0);

  useEffect(() => {
    fromOpacity.value = withTiming(0, { duration: 400, easing: Easing.inOut(Easing.cubic) });
    toOpacity.value = withDelay(150, withTiming(1, { duration: 400, easing: Easing.inOut(Easing.cubic) }));
    iconOpacity.value = withSequence(
      withTiming(1, { duration: 180 }),
      withDelay(250, withTiming(0, { duration: 220 }))
    );
    iconScale.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.back(1.8)) }),
      withDelay(250, withTiming(0.6, { duration: 220 }))
    );
  }, [fromOpacity, toOpacity, iconOpacity, iconScale]);

  const fromStyle = useAnimatedStyle(() => ({ opacity: fromOpacity.value }));
  const toStyle = useAnimatedStyle(() => ({ opacity: toOpacity.value }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: iconOpacity.value, transform: [{ scale: iconScale.value }] }));

  return (
    <View>
      <View style={{ height: 96, justifyContent: "center" }}>
        <Animated.View style={[styles.transitionRow, fromStyle]}>
          <VehicleRow c={c} label="FROM" vehicle={from} />
        </Animated.View>
        <Animated.View style={[styles.transitionRow, { position: "absolute", top: 0, left: 0, right: 0 }, toStyle]}>
          <VehicleRow c={c} label="TO" vehicle={to} />
        </Animated.View>
      </View>
      <Animated.View style={[{ alignItems: "center", marginTop: 4 }, iconStyle]}>
        <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="swap-horizontal" size={22} color={c.onAccentBg} />
        </View>
      </Animated.View>
      <Text style={{ color: c.onSurface3, fontSize: 12, textAlign: "center", marginTop: 12 }}>
        Updating your subscription…
      </Text>
    </View>
  );
}

function VehicleRow({ c, label, vehicle }: { c: any; label: string; vehicle: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Image source={vehicle?.image} style={{ width: 60, height: 60, borderRadius: tokens.radius.md }} contentFit="cover" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold }}>{label}</Text>
        <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, marginTop: 2 }}>{vehicle?.name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  transitionRow: { justifyContent: "center" },
});
