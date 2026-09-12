import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTheme, tokens } from "@/src/theme";
import { RaidexButton } from "./RaidexButton";

// A generalized version of the "confirm/collect one field, then act" sheet
// pattern already used ad hoc across owner/admin/subscriptions screens
// (cancel-subscription reason, mark-payout-paid reference, etc). Kept
// deliberately simple - drag-to-dismiss richness lives in RaidexBottomSheet
// for screens that need it.
export function RaidexModal({
  visible,
  title,
  subtitle,
  onDismiss,
  primaryLabel,
  onPrimary,
  primaryBusy,
  primaryDisabled,
  primaryVariant = "primary",
  dismissLabel = "Cancel",
  children,
  testID,
  dismissTestID,
  primaryTestID,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onDismiss: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryBusy?: boolean;
  primaryDisabled?: boolean;
  primaryVariant?: "primary" | "destructive";
  dismissLabel?: string;
  children?: React.ReactNode;
  testID?: string;
  // Optional testIDs for the built-in footer buttons, so screens that need a
  // stable testID on "cancel"/"confirm" (e.g. for existing Maestro/Jest
  // flows) don't have to hand-roll their own footer just to get one.
  dismissTestID?: string;
  primaryTestID?: string;
}) {
  const c = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} testID={testID}>
      <View style={{ flex: 1, backgroundColor: c.overlay, justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onDismiss} />
        <View style={{ backgroundColor: c.surface, padding: tokens.spacing.xl, borderTopLeftRadius: tokens.radius.xl, borderTopRightRadius: tokens.radius.xl, maxHeight: "88%" }}>
          <View style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: c.border, alignSelf: "center", marginBottom: tokens.spacing.md }} />
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold }}>{title}</Text>
          {subtitle ? <Text style={{ color: c.onSurface3, marginTop: 6, lineHeight: 20 }}>{subtitle}</Text> : null}
          {children ? <View style={{ marginTop: tokens.spacing.lg }}>{children}</View> : null}
          <View style={{ flexDirection: "row", gap: tokens.spacing.sm, marginTop: tokens.spacing.xl }}>
            <View style={{ flex: 1 }}>
              <RaidexButton testID={dismissTestID} label={dismissLabel} onPress={onDismiss} variant="secondary" haptics={false} />
            </View>
            {primaryLabel && onPrimary ? (
              <View style={{ flex: 1 }}>
                <RaidexButton
                  testID={primaryTestID}
                  label={primaryLabel}
                  onPress={onPrimary}
                  loading={primaryBusy}
                  disabled={primaryDisabled}
                  variant={primaryVariant === "destructive" ? "destructive" : "primary"}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
