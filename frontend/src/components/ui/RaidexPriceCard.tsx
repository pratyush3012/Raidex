import React from "react";
import { Text, View } from "react-native";
import { useTheme, tokens } from "@/src/theme";

export type RaidexPriceLine = { label: string; value: string; muted?: boolean; strike?: boolean };

// A single, consistent price-breakdown shape used on checkout, booking
// summary, and subscription quote screens - so "base price + fees + total"
// always reads the same way everywhere, with no surprise line items.
export function RaidexPriceCard({
  lines,
  total,
  totalLabel = "Total payable",
  testID,
}: {
  lines: RaidexPriceLine[];
  total: string;
  totalLabel?: string;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderRadius: tokens.radius.lg, padding: tokens.spacing.lg }}>
      {lines.map((line, i) => (
        <View key={`${line.label}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
          <Text style={{ color: line.muted ? c.onSurface3 : c.onSurface2, fontSize: 13 }}>{line.label}</Text>
          <Text
            style={{
              color: line.muted ? c.onSurface3 : c.onSurface,
              fontSize: 13,
              fontWeight: tokens.weight.semibold,
              textDecorationLine: line.strike ? "line-through" : "none",
            }}
          >
            {line.value}
          </Text>
        </View>
      ))}
      <View style={{ height: 1, backgroundColor: c.border, marginVertical: 10 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: tokens.type.lg }}>{totalLabel}</Text>
        <Text style={{ color: c.onSurface, fontWeight: tokens.weight.black, fontSize: tokens.type.xl }}>{total}</Text>
      </View>
    </View>
  );
}
