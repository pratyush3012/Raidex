import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";
import { RaidexButton } from "./RaidexButton";

// An in-context, dismissable "could not load / could not complete" state -
// calmer than an OS-level Alert, used for full-screen load failures. Never
// pass a raw exception string here; the backend already returns safe
// messages, but callers should still prefer a short human sentence.
export function RaidexErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  testID,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.spacing.xxl }}>
      <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: c.error + "1A", alignItems: "center", justifyContent: "center", marginBottom: tokens.spacing.lg }}>
        <Ionicons name="cloud-offline-outline" size={32} color={c.error} />
      </View>
      <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: tokens.weight.bold, textAlign: "center" }}>{title}</Text>
      {message ? (
        <Text style={{ color: c.onSurface3, textAlign: "center", marginTop: 8, lineHeight: 20 }}>{message}</Text>
      ) : null}
      {onRetry ? (
        <View style={{ marginTop: tokens.spacing.xl }}>
          <RaidexButton label="Retry" onPress={onRetry} variant="primary" fullWidth={false} icon="refresh" />
        </View>
      ) : null}
    </View>
  );
}
