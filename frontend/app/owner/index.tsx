import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import {
  RaidexButton,
  RaidexCard,
  RaidexChip,
  RaidexStatusPill,
  RaidexMetricCard,
  RaidexEmptyState,
} from "@/src/components/ui";

type Tab = "earnings" | "listings" | "bookings" | "add";

// Ordered payout lifecycle (mirrors backend PAYOUT_STATUSES). Only
// "eligible"/"paid"/"failed" are produced by the current flows, but the
// track itself supports the full ordering so it stays correct if
// "pending"/"processing" payouts appear later.
const PAYOUT_STEPS = ["pending", "eligible", "processing", "paid"] as const;
const PAYOUT_TERMINAL_NEGATIVE = ["failed", "cancelled", "disputed"];

export default function OwnerDashboard() {
  const c = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("earnings");
  const [earnings, setEarnings] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [extensionEarnings, setExtensionEarnings] = useState<any>(null);
  const [lateFeeEarnings, setLateFeeEarnings] = useState<any>(null);
  const [milestoneThresholds, setMilestoneThresholds] = useState<number[]>([]);
  const [serviceBenefits, setServiceBenefits] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  const onboard = async () => {
    try { await api("/owner/onboard", { method: "POST" }); setOnboarded(true); load(); } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const e = await api<any>("/owner/earnings");
      setEarnings(e);
      setVehicles(await api<any[]>("/owner/vehicles"));
      setBookings(await api<any[]>("/owner/bookings"));
      setPayouts(await api<any[]>("/owner/payouts"));
      const [milestoneCfg, benefits, extEarnings, lateEarnings] = await Promise.all([
        api<{ thresholds_km: number[] }>("/service-milestones/config").catch(() => ({ thresholds_km: [] })),
        api<any[]>("/owner/service-benefits").catch(() => []),
        api<any>("/owner/extension-earnings").catch(() => null),
        api<any>("/owner/late-fee-earnings").catch(() => null),
      ]);
      setMilestoneThresholds(milestoneCfg.thresholds_km || []);
      setServiceBenefits(benefits);
      setExtensionEarnings(extEarnings);
      setLateFeeEarnings(lateEarnings);
      setOnboarded(true);
    } catch (err: any) {
      if (err.message?.includes("owner role required")) setOnboarded(false);
    } finally { setLoading(false); }
  }, []);

  // useFocusEffect (not a plain useEffect) so returning from the add-vehicle
  // wizard (a separate route now) refreshes vehicles/earnings the same way
  // the old inline form's onCreated callback used to.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!onboarded) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 20 }}>
            <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
            <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: tokens.weight.bold, marginLeft: 8 }}>Become a host</Text>
          </View>
        </SafeAreaView>
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <RaidexCard variant="dark" padding={tokens.spacing.xl}>
            <Ionicons name="business" size={48} color="#05C46B" />
            <Text style={{ color: "#fff", fontSize: tokens.type.xxxl, fontWeight: tokens.weight.black, marginTop: 16 }}>Earn ₹40,000+ per month</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 8 }}>List your idle car or bike. Raidex handles bookings, payments, and KYC — you keep your net earnings after platform commission.</Text>
          </RaidexCard>
          <View style={{ marginTop: 20, gap: 12 }}>
            {[
              { ic: "shield-checkmark", t: "KYC-verified renters only", s: "All renters verified with Aadhaar + DL + face match" },
              { ic: "navigate", t: "GPS-tracked trips", s: "Live location, geofence alerts, mileage logged automatically" },
              { ic: "camera", t: "AI damage inspection", s: "Mandatory before/after photos with AI scoring" },
              { ic: "card", t: "Transparent payouts", s: "Net earnings, commission, and payout status tracked after every trip" },
            ].map((it) => (
              <View key={it.ic} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
                <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name={it.ic as any} size={20} color={c.onAccentBg} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{it.t}</Text>
                  <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{it.s}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={{ marginTop: 24 }}>
            <RaidexButton testID="onboard-btn" label="Activate host account" onPress={onboard} icon="arrow-forward" />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 20 }}>
          <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <Text style={{ color: c.onSurface, fontSize: 20, fontWeight: tokens.weight.bold, marginLeft: 8 }}>Host Dashboard</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }} style={{ height: 56 }}>
          {(["earnings", "listings", "bookings", "add"] as Tab[]).map((t) => (
            <RaidexChip
              key={t}
              testID={`owner-tab-${t}`}
              label={t === "add" ? "+ Vehicle" : t.charAt(0).toUpperCase() + t.slice(1)}
              active={tab === t}
              onPress={() => setTab(t)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {loading && <ActivityIndicator color={c.accent} />}

        {tab === "earnings" && earnings && (
          <View>
            <RaidexCard variant="dark" padding={tokens.spacing.xl} testID="earnings-hero">
              <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: tokens.weight.black, letterSpacing: 2 }}>NET PAYABLE</Text>
              <Text testID="net-payable" style={{ color: "#fff", fontSize: tokens.type.hero, fontWeight: tokens.weight.black, marginTop: 6 }}>
                ₹{earnings.net_payable.toLocaleString()}
              </Text>

              <View style={{ marginTop: tokens.spacing.lg, gap: 8 }}>
                <FlowRow label="Gross earnings" value={`₹${earnings.gross.toLocaleString()}`} />
                <FlowRow
                  label={`RAIDEX commission${earnings.gross > 0 ? ` (${Math.round((earnings.commission / earnings.gross) * 100)}%)` : ""}`}
                  value={`− ₹${earnings.commission.toLocaleString()}`}
                  negative
                />
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.15)", marginVertical: 2 }} />
                <FlowRow label="Net payable" value={`₹${earnings.net_payable.toLocaleString()}`} strong />
              </View>
            </RaidexCard>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <RaidexMetricCard testID="kpi-vehicles" label="Vehicles" value={String(earnings.vehicles_count)} numeric={earnings.vehicles_count} icon="car" />
              <RaidexMetricCard testID="kpi-active-trips" label="Active trips" value={String(earnings.active_trips)} numeric={earnings.active_trips} icon="navigate" />
              <RaidexMetricCard testID="kpi-upcoming" label="Upcoming" value={String(earnings.future_bookings)} numeric={earnings.future_bookings} icon="calendar" />
            </View>

            {(extensionEarnings || lateFeeEarnings) && (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <RaidexMetricCard
                  testID="kpi-extension-earnings"
                  label="Extension earnings"
                  value={`₹${(extensionEarnings?.total_earned ?? 0).toLocaleString()}`}
                  numeric={extensionEarnings?.total_earned ?? 0}
                  prefix="₹"
                  icon="time"
                />
                <RaidexMetricCard
                  testID="kpi-late-fee-earnings"
                  label="Late fee earnings"
                  value={`₹${(lateFeeEarnings?.total_earned ?? 0).toLocaleString()}`}
                  numeric={lateFeeEarnings?.total_earned ?? 0}
                  prefix="₹"
                  icon="alert-circle"
                />
              </View>
            )}

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16, marginTop: 24, marginBottom: 12 }}>Booking breakdown</Text>
            {Object.entries(earnings.by_status || {}).map(([k, v]: any) => (
              <View key={k} style={[styles.row, { backgroundColor: c.surface2, borderColor: c.border, marginBottom: 8, justifyContent: "space-between" }]}>
                <RaidexStatusPill status={k} />
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.black }}>{String(v)}</Text>
              </View>
            ))}

            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16, marginTop: 24, marginBottom: 12 }}>Payouts</Text>
            {payouts.length === 0 ? (
              <RaidexEmptyState
                testID="payouts-empty"
                icon="cash-outline"
                title="No payouts yet"
                subtitle="Payouts are created automatically when a trip completes."
              />
            ) : (
              payouts.map((p, i) => <PayoutRow key={p.payout_id} p={p} index={i} />)
            )}

            {extensionEarnings?.items?.length > 0 && (
              <View>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16, marginTop: 24, marginBottom: 12 }}>Recent extension earnings</Text>
                {extensionEarnings.items.slice(0, 5).map((item: any, i: number) => (
                  <ExtensionRow key={item.extension_id} item={item} index={i} />
                ))}
              </View>
            )}

            {lateFeeEarnings?.items?.length > 0 && (
              <View>
                <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 16, marginTop: 24, marginBottom: 12 }}>Recent late fee earnings</Text>
                {lateFeeEarnings.items.slice(0, 5).map((item: any, i: number) => (
                  <LateFeeRow key={item.late_fee_id} item={item} index={i} />
                ))}
              </View>
            )}
          </View>
        )}

        {tab === "listings" && (
          <View>
            {vehicles.length === 0 ? (
              <RaidexEmptyState
                testID="vehicles-empty"
                icon="car-outline"
                title="No vehicles yet"
                subtitle="Add your first car or bike to start earning."
                actionLabel="+ Add vehicle"
                onAction={() => router.push("/owner/add-vehicle")}
              />
            ) : (
              vehicles.map((v, i) => (
                <Reveal key={v.vehicle_id} index={i}>
                  <RaidexCard variant="flat" style={{ marginBottom: tokens.spacing.sm }}>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <Image source={v.hero_image || v.image} style={{ width: 70, height: 70, borderRadius: tokens.radius.md }} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold }}>{v.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <RaidexStatusPill status={v.verification_status} />
                          <Text style={{ color: c.onSurface3, fontSize: 12 }}>· ₹{v.price_per_day}/day</Text>
                        </View>
                        <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 6 }}>{v.lifetime_km || 0} km lifetime · {v.trips || 0} trips</Text>
                      </View>
                    </View>
                    {milestoneThresholds.length > 0 && (
                      <ServiceMilestoneProgress
                        lifetimeKm={v.lifetime_km || 0}
                        thresholds={milestoneThresholds}
                        benefits={serviceBenefits.filter((b) => b.vehicle_id === v.vehicle_id)}
                      />
                    )}
                  </RaidexCard>
                </Reveal>
              ))
            )}
          </View>
        )}

        {tab === "bookings" && (
          <View>
            {bookings.length === 0 ? (
              <RaidexEmptyState testID="bookings-empty" icon="calendar-outline" title="No bookings yet" subtitle="Bookings on your vehicles will show up here." />
            ) : (
              bookings.map((b, i) => (
                <Reveal key={b.booking_id} index={i}>
                  <RaidexCard variant="flat" style={{ marginBottom: tokens.spacing.sm }}>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <Image source={b.vehicle_snapshot?.image} style={{ width: 60, height: 60, borderRadius: tokens.radius.md }} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{b.vehicle_snapshot?.name}</Text>
                        <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 2 }}>{new Date(b.start_date).toLocaleDateString()} → {new Date(b.end_date).toLocaleDateString()}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                          <Text style={{ color: c.onSurface, fontWeight: tokens.weight.black }}>₹{b.total_amount.toLocaleString()}</Text>
                          <RaidexStatusPill status={b.status} />
                        </View>
                      </View>
                    </View>
                  </RaidexCard>
                </Reveal>
              ))
            )}
          </View>
        )}

        {tab === "add" && <AddVehicleCta onStart={() => router.push("/owner/add-vehicle")} />}
      </ScrollView>
    </View>
  );
}

// Shared entrance-stagger wrapper - same Reanimated technique as
// RaidexVehicleCard (index-based delay + fade/rise), reused here for
// payout/vehicle/booking rows so lists never just pop onto the screen.
function Reveal({ index = 0, children }: { index?: number; children: React.ReactNode }) {
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = withDelay(Math.min(index, 6) * 40, withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) }));
  }, [appear, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 14 }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

// One row of the "Gross − commission = Net" flow inside the dark earnings
// hero card - keeps the financial hierarchy readable as a simple sequence
// instead of three disconnected numbers (per brief: prefer clean hierarchy
// over a chart).
function FlowRow({ label, value, negative, strong }: { label: string; value: string; negative?: boolean; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: strong ? "#fff" : "rgba(255,255,255,0.7)", fontSize: strong ? 15 : 13, fontWeight: strong ? tokens.weight.bold : tokens.weight.medium }}>
        {label}
      </Text>
      <Text style={{ color: negative ? "#FCA5A5" : "#fff", fontSize: strong ? 16 : 13, fontWeight: strong ? tokens.weight.black : tokens.weight.semibold }}>
        {value}
      </Text>
    </View>
  );
}

function PayoutRow({ p, index }: { p: any; index: number }) {
  const c = useTheme();
  return (
    <Reveal index={index}>
      <RaidexCard variant="flat" style={{ marginBottom: tokens.spacing.sm }} testID={`payout-row-${p.payout_id}`}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>₹{p.net_amount.toLocaleString()} net</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
              {p.booking_id ? `Booking ${p.booking_id}` : `Subscription ${p.subscription_id}`} · Gross ₹{p.gross_amount.toLocaleString()} · Commission ₹{p.commission_amount.toLocaleString()}
              {p.commission_rate != null ? ` (${Math.round(p.commission_rate * 100)}%)` : ""}
            </Text>
          </View>
          <RaidexStatusPill status={p.status} />
        </View>
        <PayoutStatusTrack status={p.status} />
      </RaidexCard>
    </Reveal>
  );
}

// A single paid booking-extension payout (see BookingService.extend_booking /
// GET /owner/extension-earnings) - same flat-card row shape as PayoutRow so
// the earnings tab's list rows stay visually consistent everywhere.
function ExtensionRow({ item, index }: { item: any; index: number }) {
  const c = useTheme();
  return (
    <Reveal index={index}>
      <RaidexCard variant="flat" style={{ marginBottom: tokens.spacing.sm }} testID={`extension-row-${item.extension_id}`}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>₹{item.host_extension_payout.toLocaleString()} earned</Text>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
              Booking {item.booking_id} · {item.extension_hours}h extension · {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </View>
          <RaidexStatusPill status="paid" />
        </View>
      </RaidexCard>
    </Reveal>
  );
}

// A single late-return fee share (see server.end_trip / GET
// /owner/late-fee-earnings). payment_status reflects whether the fee was
// actually collected from the customer's wallet ("paid") or is still
// outstanding ("due") - never shown as earned unless it truly was.
function LateFeeRow({ item, index }: { item: any; index: number }) {
  const c = useTheme();
  return (
    <Reveal index={index}>
      <RaidexCard variant="flat" style={{ marginBottom: tokens.spacing.sm }} testID={`late-fee-row-${item.late_fee_id}`}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>
              ₹{item.host_share.toLocaleString()} {item.payment_status === "paid" ? "earned" : "due"}
            </Text>
            <Text style={{ color: c.onSurface3, fontSize: 11, marginTop: 2 }}>
              Booking {item.booking_id} · {item.billable_hours}h late · {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </View>
          <RaidexStatusPill status={item.payment_status} />
        </View>
      </RaidexCard>
    </Reveal>
  );
}

// Compact "Pending → Eligible → Processing → Paid" progress track so a
// payout's stage is visually obvious at a glance, not just a status word.
// A terminal negative status (failed/cancelled/disputed) replaces the track
// entirely rather than pretending it's still progressing.
function PayoutStatusTrack({ status }: { status: string }) {
  const c = useTheme();
  if (PAYOUT_TERMINAL_NEGATIVE.includes(status)) return null;

  const idx = Math.max(0, PAYOUT_STEPS.indexOf(status as any));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 12 }}>
      {PAYOUT_STEPS.map((step, i) => (
        <React.Fragment key={step}>
          <View style={{ alignItems: "center", width: 54 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i <= idx ? c.accent : c.surface3 }} />
            <Text
              numberOfLines={1}
              style={{ fontSize: 9, color: i <= idx ? c.onSurface2 : c.onSurface3, marginTop: 4, fontWeight: tokens.weight.semibold, textTransform: "capitalize" }}
            >
              {step}
            </Text>
          </View>
          {i < PAYOUT_STEPS.length - 1 && (
            <View style={{ flex: 1, height: 2, marginTop: 3, marginHorizontal: -2, backgroundColor: i < idx ? c.accent : c.surface3 }} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

// Signature RAIDEX differentiator: current platform mileage -> next service
// milestone -> any benefits already earned for this specific vehicle. Real
// data only - thresholds from GET /service-milestones/config, benefits from
// GET /owner/service-benefits, lifetime_km already on the vehicle record.
function ServiceMilestoneProgress({ lifetimeKm, thresholds, benefits }: { lifetimeKm: number; thresholds: number[]; benefits: any[] }) {
  const c = useTheme();
  const sorted = [...thresholds].sort((a, b) => a - b);
  const nextThreshold = sorted.find((t) => t > lifetimeKm);
  const prevThreshold = [...sorted].reverse().find((t) => t <= lifetimeKm) ?? 0;
  const pct = nextThreshold
    ? Math.min(100, Math.max(0, ((lifetimeKm - prevThreshold) / (nextThreshold - prevThreshold)) * 100))
    : 100;
  const width = useSharedValue(0);
  useEffect(() => { width.value = withTiming(pct, { duration: tokens.motion.slow }); }, [pct, width]);
  const barStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  return (
    <View style={{ marginTop: tokens.spacing.md, paddingTop: tokens.spacing.md, borderTopWidth: 1, borderTopColor: c.border }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: c.onSurface2, fontSize: 11, fontWeight: tokens.weight.bold, letterSpacing: 0.5 }}>SERVICE MILESTONE</Text>
        <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.medium }}>
          {nextThreshold ? `${lifetimeKm.toLocaleString()} / ${nextThreshold.toLocaleString()} km` : `${lifetimeKm.toLocaleString()} km`}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 999, backgroundColor: c.surface3, marginTop: 8, overflow: "hidden" }}>
        <Animated.View style={[{ height: "100%", backgroundColor: c.accent, borderRadius: 999 }, barStyle]} />
      </View>
      {benefits.length > 0 && (
        <View style={{ marginTop: tokens.spacing.sm, gap: 6 }}>
          {benefits.map((b) => (
            <View key={b.benefit_id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: c.onSurface2, fontSize: 12 }}>{b.milestone_km.toLocaleString()} km benefit</Text>
              <RaidexStatusPill status={b.status} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// The "Add vehicle" tab now only launches the staged wizard at
// app/owner/add-vehicle.tsx - the actual form + POST /owner/vehicles submit
// logic lives there exclusively so there's a single implementation of it,
// not two parallel copies.
function AddVehicleCta({ onStart }: { onStart: () => void }) {
  const c = useTheme();
  return (
    <View>
      <RaidexCard variant="dark" padding={tokens.spacing.xl} testID="add-vehicle-cta">
        <Ionicons name="add-circle" size={40} color="#22D98B" />
        <Text style={{ color: "#fff", fontSize: tokens.type.xxl, fontWeight: tokens.weight.black, marginTop: 14 }}>List a new vehicle</Text>
        <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
          A short guided flow — type, specs, photos, pricing, deposit, pickup location and rules — ending with a preview before it's submitted for approval.
        </Text>
      </RaidexCard>
      <View style={{ marginTop: 20 }}>
        <RaidexButton testID="start-add-vehicle-btn" label="List a new vehicle" icon="arrow-forward" onPress={onStart} />
      </View>
      <Text style={{ color: c.onSurface3, fontSize: 12, marginTop: 12, textAlign: "center" }}>
        New listings are reviewed by the Raidex team before they go live.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  iconRound: { width: 36, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
