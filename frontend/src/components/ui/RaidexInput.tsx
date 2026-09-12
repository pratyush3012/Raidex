import React, { useState } from "react";
import { Text, TextInput, TextInputProps, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, tokens } from "@/src/theme";

export function RaidexInput({
  label,
  icon,
  error,
  testID,
  ...rest
}: TextInputProps & { label?: string; icon?: keyof typeof Ionicons.glyphMap; error?: string; testID?: string }) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ marginBottom: tokens.spacing.md }}>
      {label && (
        <Text style={{ color: c.onSurface2, fontSize: tokens.type.sm, fontWeight: tokens.weight.bold, marginBottom: 7 }}>
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderWidth: 1.5,
          borderRadius: tokens.radius.lg,
          paddingHorizontal: tokens.spacing.md + 2,
          minHeight: 54,
          backgroundColor: c.surface2,
          borderColor: error ? c.error : focused ? c.accent : c.border,
        }}
      >
        {icon && <Ionicons name={icon} size={18} color={focused ? c.accent : c.onSurface3} />}
        <TextInput
          testID={testID}
          placeholderTextColor={c.onSurface3}
          style={{ flex: 1, fontSize: tokens.type.lg, paddingVertical: 13, color: c.onSurface }}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          {...rest}
        />
      </View>
      {error ? <Text style={{ color: c.error, fontSize: tokens.type.sm, marginTop: 5, fontWeight: tokens.weight.medium }}>{error}</Text> : null}
    </View>
  );
}
