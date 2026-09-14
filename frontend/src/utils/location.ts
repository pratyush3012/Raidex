import { storage } from "@/src/utils/storage";

// RAIDEX_USER_LOCATION
// Persists the rider's chosen/detected location so `GET /vehicles` can be
// called with real lat/lng (see backend/server.py list_vehicles) instead of
// the app fabricating a "near you" distance from nothing. Uses this app's
// existing storage wrapper (src/utils/storage) rather than talking to
// AsyncStorage directly - it's plain per-key primitives (lat/lng/label/
// source), which is exactly what that wrapper is built for, and never
// throws on read/write failure.

const KEY_LAT = "raidex_location_lat";
const KEY_LNG = "raidex_location_lng";
const KEY_LABEL = "raidex_location_label";
const KEY_SOURCE = "raidex_location_source";

export type LocationSource = "gps" | "seed_area" | "search";

export type SavedLocation = {
  lat: number;
  lng: number;
  label: string;
  source: LocationSource;
};

export async function getSavedLocation(): Promise<SavedLocation | null> {
  const lat = await storage.getItem<number>(KEY_LAT, NaN);
  const lng = await storage.getItem<number>(KEY_LNG, NaN);
  const label = await storage.getItem<string>(KEY_LABEL, "");
  const source = await storage.getItem<string>(KEY_SOURCE, "");
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || !label) return null;
  return { lat, lng, label, source: (source || "gps") as LocationSource };
}

export async function saveLocation(loc: SavedLocation): Promise<void> {
  await storage.setItem(KEY_LAT, loc.lat);
  await storage.setItem(KEY_LNG, loc.lng);
  await storage.setItem(KEY_LABEL, loc.label);
  await storage.setItem(KEY_SOURCE, loc.source);
}

export async function clearSavedLocation(): Promise<void> {
  await storage.removeItem(KEY_LAT);
  await storage.removeItem(KEY_LNG);
  await storage.removeItem(KEY_LABEL);
  await storage.removeItem(KEY_SOURCE);
}

// Real areas Raidex vehicles actually exist in today, taken directly from
// backend/server.py's SEED_VEHICLES (location + latitude/longitude fields) —
// not invented. Kept as a small, honestly-labeled quick-pick list so location
// selection works instantly with zero network dependency, alongside the
// Nominatim free-text search below for anywhere else.
export const SEED_AREAS: { label: string; lat: number; lng: number }[] = [
  { label: "Bandra West, Mumbai", lat: 19.0596, lng: 72.8295 },
  { label: "Juhu, Mumbai", lat: 19.1075, lng: 72.8263 },
  { label: "Andheri East, Mumbai", lat: 19.1136, lng: 72.8697 },
  { label: "Powai, Mumbai", lat: 19.1176, lng: 72.9060 },
  { label: "Lower Parel, Mumbai", lat: 18.9978, lng: 72.8266 },
];

export type PlaceResult = { label: string; lat: number; lng: number };

/**
 * Free-text place search via Nominatim (OpenStreetMap's public search API) —
 * no API key, matching the free-OSM approach this app already uses for map
 * tiles (src/features/maps/MapView.tsx). Used as an alternative to the
 * curated SEED_AREAS list above for a location outside today's seeded areas.
 * Network-dependent by nature; callers should treat a thrown error as
 * "search unavailable right now", never invent a result.
 */
export async function searchPlace(query: string): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(trimmed)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const json = (await res.json()) as any[];
    return json
      .map((item) => ({
        label: item.display_name as string,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } finally {
    clearTimeout(timeout);
  }
}
