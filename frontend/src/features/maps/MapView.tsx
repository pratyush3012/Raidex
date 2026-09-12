import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";

import type { VehicleMapMarker } from "./types";

export type { VehicleMapMarker } from "./types";

type Props = {
  c: any;
  items: VehicleMapMarker[];
  centerLat: number;
  centerLng: number;
  onSelect?: (vehicleId: string) => void;
  selectedId?: string | null;
  height?: number;
};

/**
 * Real map rendering shared by the discovery screen (many vehicle pins) and
 * the vehicle detail screen (a single pickup-location pin) - MapLibre GL +
 * free OpenStreetMap raster tiles in a WebView, with a lightweight
 * grid-and-pins fallback for web / WebView failure. No paid maps API key.
 */
export function MapCanvas({ c, items, centerLat, centerLng, onSelect, selectedId, height = 260 }: Props) {
  const [mapFailed, setMapFailed] = useState(false);
  const html = useMemo(() => mapLibreHtml(items.slice(0, 60), centerLat, centerLng), [items, centerLat, centerLng]);

  if (Platform.OS === "web" || mapFailed) {
    return (
      <FallbackMap
        c={c}
        items={items}
        centerLat={centerLat}
        centerLng={centerLng}
        onSelect={onSelect}
        selectedId={selectedId}
        height={height}
      />
    );
  }

  return (
    <WebView
      testID="maplibre-webview"
      originWhitelist={["*"]}
      source={{ html }}
      style={[styles.mapCanvas, { height }]}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      onError={() => setMapFailed(true)}
      onHttpError={() => setMapFailed(true)}
      onMessage={(event) => {
        const vehicleId = event.nativeEvent.data;
        if (vehicleId === "__MAP_FAILED__") {
          setMapFailed(true);
          return;
        }
        if (vehicleId) onSelect?.(vehicleId);
      }}
    />
  );
}

function FallbackMap({ c, items, centerLat, centerLng, onSelect, selectedId, height = 260 }: Props) {
  return (
    <View style={[styles.mapCanvas, { height, backgroundColor: c.surface }]}>
      {Array.from({ length: 5 }).map((_, i) => <View key={`h${i}`} style={[styles.mapGridH, { top: `${(i + 1) * 16}%`, backgroundColor: c.border }]} />)}
      {Array.from({ length: 5 }).map((_, i) => <View key={`v${i}`} style={[styles.mapGridV, { left: `${(i + 1) * 16}%`, backgroundColor: c.border }]} />)}
      <View style={[styles.userDot, { backgroundColor: c.accent }]} />
      {items.slice(0, 18).map((item) => {
        const left = Math.max(8, Math.min(88, 50 + (item.longitude - centerLng) * 900));
        const top = Math.max(10, Math.min(82, 50 - (item.latitude - centerLat) * 1300));
        const active = item.vehicle_id === selectedId;
        return (
          <Pressable
            key={item.vehicle_id}
            testID={`map-pin-${item.vehicle_id}`}
            onPress={() => onSelect?.(item.vehicle_id)}
            style={[styles.marker, { left: `${left}%`, top: `${top}%`, backgroundColor: item.available === false ? c.surface3 : active ? c.accent : c.inverse }]}
          >
            <Ionicons name="location" size={14} color={c.onInverse} />
          </Pressable>
        );
      })}
    </View>
  );
}

function mapLibreHtml(items: VehicleMapMarker[], centerLat: number, centerLng: number) {
  const safeItems = JSON.stringify(items.map((item) => ({
    id: item.vehicle_id,
    price: item.price_per_day,
    available: item.available !== false,
    lat: Number(item.latitude),
    lng: Number(item.longitude),
  }))).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; overflow: hidden; background: #eef2f0; }
    .marker {
      border: 2px solid #fff;
      border-radius: 999px;
      box-shadow: 0 8px 20px rgba(0,0,0,.22);
      color: #fff;
      cursor: pointer;
      font: 800 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 6px 8px;
      white-space: nowrap;
    }
    .marker.available { background: #050505; }
    .marker.unavailable { background: #777; }
    .user-dot {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: #05C46B;
      border: 3px solid #fff;
      box-shadow: 0 0 0 9px rgba(5,196,107,.18);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    window.onerror = () => window.ReactNativeWebView?.postMessage("__MAP_FAILED__");
    setTimeout(() => {
      if (!window.maplibregl) window.ReactNativeWebView?.postMessage("__MAP_FAILED__");
    }, 3500);
    const vehicles = ${safeItems};
    const center = [${Number(centerLng).toFixed(6)}, ${Number(centerLat).toFixed(6)}];
    const map = new maplibregl.Map({
      container: "map",
      center,
      zoom: vehicles.length > 1 ? 11 : 15,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "OpenStreetMap"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      }
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    if (vehicles.length > 1) {
      const userDot = document.createElement("div");
      userDot.className = "user-dot";
      new maplibregl.Marker({ element: userDot }).setLngLat(center).addTo(map);
    }
    vehicles.forEach((vehicle) => {
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lng)) return;
      const el = document.createElement("button");
      el.className = "marker " + (vehicle.available ? "available" : "unavailable");
      el.textContent = "Rs " + Math.round(vehicle.price / 1000) + "k";
      el.onclick = () => window.ReactNativeWebView?.postMessage(vehicle.id);
      new maplibregl.Marker({ element: el }).setLngLat([vehicle.lng, vehicle.lat]).addTo(map);
    });
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  mapCanvas: { width: "100%", borderRadius: 16, overflow: "hidden" },
  mapGridH: { position: "absolute", left: 0, right: 0, height: 1 },
  mapGridV: { position: "absolute", top: 0, bottom: 0, width: 1 },
  userDot: { position: "absolute", left: "50%", top: "50%", width: 14, height: 14, borderRadius: 999, marginLeft: -7, marginTop: -7, borderWidth: 2, borderColor: "#fff" },
  marker: { position: "absolute", width: 28, height: 28, borderRadius: 999, alignItems: "center", justifyContent: "center", marginLeft: -14, marginTop: -14 },
});
