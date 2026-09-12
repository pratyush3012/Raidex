import React, { forwardRef, useCallback, useMemo } from "react";
import { View } from "react-native";
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet";
import { useTheme, tokens } from "@/src/theme";

// A real drag-to-dismiss sheet (vehicle filters, swap vehicle picker, plan
// duration picker) - as distinct from RaidexModal's simpler confirm-and-act
// pattern. Controlled via a ref exactly like the underlying `BottomSheet`.
export const RaidexBottomSheet = forwardRef<
  BottomSheet,
  { snapPoints?: (string | number)[]; onClose?: () => void; children: React.ReactNode }
>(function RaidexBottomSheet({ snapPoints, onClose, children }, ref) {
  const c = useTheme();
  const points = useMemo(() => snapPoints ?? ["50%", "85%"], [snapPoints]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} />,
    []
  );

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={points}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: c.surface, borderRadius: tokens.radius.xl }}
      handleIndicatorStyle={{ backgroundColor: c.border, width: 40 }}
    >
      <BottomSheetView style={{ flex: 1, paddingHorizontal: tokens.spacing.xl }}>
        <View style={{ flex: 1 }}>{children}</View>
      </BottomSheetView>
    </BottomSheet>
  );
});
