import React from "react";
import { Text, View } from "react-native";
import { useTheme, tokens } from "@/src/theme";

// One centralized status → color mapping used everywhere a status badge
// appears (payouts, KYC, disputes, swaps, subscriptions, geofence events)
// instead of every screen inventing its own color ternary.
// "active" gets its own "info" tone (distinct from "positive") so a
// live-right-now trip/subscription reads differently from a merely confirmed
// (not yet started) one; "completed" is "neutral" rather than "positive" -
// green should mean "good and current," not "over and done."
const STATUS_TONE: Record<string, "positive" | "info" | "warning" | "negative" | "neutral"> = {
  paid: "positive", confirmed: "positive", approved: "positive",
  verified: "positive", eligible: "warning", fulfilled: "positive",
  active: "info",
  completed: "neutral",
  pending: "warning", processing: "warning", requested: "warning", submitted: "warning",
  pending_payment: "warning", pending_partner_fulfillment: "warning",
  failed: "negative", rejected: "negative", cancelled: "negative", disputed: "negative", expired: "negative",
};

export function RaidexStatusPill({ status, label }: { status: string; label?: string }) {
  const c = useTheme();
  const tone = STATUS_TONE[status.toLowerCase()] ?? "neutral";
  const colors = {
    positive: { bg: c.accentBg, fg: c.onAccentBg },
    info: { bg: c.infoBg, fg: c.onInfoBg },
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
