import { useColorScheme } from "react-native";

export const tokens = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, xl: 28, pill: 999 },
  type: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32, hero: 40 },
  // Named weight scale so "strong label" / "hero number" etc. mean the same
  // thing everywhere instead of each screen picking its own "700"/"800"/"900".
  weight: {
    regular: "500" as const,
    medium: "600" as const,
    semibold: "700" as const,
    bold: "800" as const,
    black: "900" as const,
  },
  // Motion: one small set of durations/easings so every animated moment in
  // the app moves at a consistent, deliberate speed instead of ad hoc values.
  motion: {
    quick: 140, // press feedback, chip toggles
    base: 220, // card/list entrance, sheet content swap
    slow: 380, // screen-level reveals, celebratory moments
    springSnappy: { damping: 18, stiffness: 220, mass: 0.7 },
    springSoft: { damping: 20, stiffness: 140, mass: 0.9 },
  },
};

// Elevation presets (React Native shadow props + Android elevation). Subtle
// by design - RAIDEX's depth language is "one soft shadow step," not stacked
// drop-shadows everywhere.
export const elevation = {
  none: {},
  low: {
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  medium: {
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  high: {
    shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
} as const;

export const palette = {
  light: {
    surface: "#FFFFFF",
    surface2: "#F4F4F5",
    surface3: "#E4E4E7",
    onSurface: "#111111",
    onSurface2: "#3F3F46",
    onSurface3: "#52525B",
    inverse: "#111111",
    onInverse: "#FFFFFF",
    accent: "#05C46B",
    accentBg: "#E8F8F0",
    onAccentBg: "#037A42",
    success: "#05C46B",
    warning: "#F59E0B",
    error: "#EF4444",
    border: "#E4E4E7",
    borderStrong: "#A1A1AA",
    overlay: "rgba(0,0,0,0.45)",
  },
  dark: {
    surface: "#000000",
    surface2: "#18181B",
    surface3: "#27272A",
    onSurface: "#FFFFFF",
    onSurface2: "#A1A1AA",
    onSurface3: "#D4D4D8",
    inverse: "#FFFFFF",
    onInverse: "#111111",
    accent: "#05C46B",
    accentBg: "#03331C",
    onAccentBg: "#34D399",
    success: "#05C46B",
    warning: "#FBBF24",
    error: "#F87171",
    border: "#27272A",
    borderStrong: "#52525B",
    overlay: "rgba(0,0,0,0.7)",
  },
};

export type Theme = typeof palette.light;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === "dark" ? palette.dark : palette.light;
}
