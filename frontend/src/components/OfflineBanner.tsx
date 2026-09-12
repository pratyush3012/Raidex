import NetInfo from "@react-native-community/netinfo";
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/src/theme";
import { flushQueuedRequests } from "@/src/api/client";
import { captureError } from "@/src/observability/sentry";

export function OfflineBanner() {
  const c = useTheme();
  const [offline, setOffline] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      const isOffline = !(state.isConnected && state.isInternetReachable !== false);
      setOffline(isOffline);
      if (wasOffline.current && !isOffline) {
        // Just came back online - replay anything queued while offline.
        flushQueuedRequests().catch((error) => captureError(error, { source: "offline-flush" }));
      }
      wasOffline.current = isOffline;
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
