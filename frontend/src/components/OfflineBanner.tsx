import NetInfo from "@react-native-community/netinfo";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/src/theme";

export function OfflineBanner() {
  const c = useTheme();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
  }, []);

  if (!offline) return null;
  return (
    <View style={{ backgroundColor: c.warning, paddingVertical: 8, paddingHorizontal: 16 }}>
      <Text style={{ color: "#111", fontWeight: "800", textAlign: "center", fontSize: 12 }}>
        Offline mode: showing cached Raidex data where available.
      </Text>
    </View>
  );
}
