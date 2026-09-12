import React from "react";
import { Text, View } from "react-native";
import { useTheme, tokens } from "@/src/theme";

// One centralized status → color mapping used everywhere a status badge
// appears (payouts, KYC, disputes, swaps, subscriptions, geofence events)
// instead of every screen inventing its own color ternary.
const STATUS_TONE: Record<string, "positive" | "warning" | "negative" | "neutral"> = {
  paid: "positive", completed: "positive", confirmed: "positive", approved: "positive",
  verified: "positive", active: "positive", eligible: "warning", fulfilled: "positive",
  pending: "warning", processing: "warning", requested: "warning", submitted: "warning",
  pending_payment: "warning", pending_partner_fulfillment: "warning",
  failed: "negative", rejected: "negative", cancelled: "negative", disputed: "negative", expired: "negative",
};

export function RaidexStatusPill({ status, label }: { status: string; label?: string }) {
  const c = useTheme();
  const tone = STATUS_TONE[status.toLowerCase()] ?? "neutral";
  const colors = {
    positive: { bg: c.accentBg, fg: c.onAccentBg },
    warning: { bg: c.warning + "26", fg: c.warning },
    negative: { bg: c.error + "22", fg: c.error },
    neutral: { bg: c.surface3, fg: c.onSurface2 },
  }[tone];

  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: tokens.radius.sm, backgroundColor: colors.bg, alignSelf: "flex-start" }}>
      <Text style={{ color: colors.fg, fontSize: 10, fontWeight: tokens.weight.black, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {label ?? status.replace(/_/g, " ")}
      </Text>
    </View>
  );
}
