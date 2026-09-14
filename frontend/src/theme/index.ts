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
    gold: "#B8860B",
    goldBg: "#FBF1DC",
    info: "#3B82F6",
    infoBg: "#EAF2FE",
    onInfoBg: "#1D4ED8",
    success: "#05C46B",
    warning: "#F59E0B",
    error: "#EF4444",
    border: "#E4E4E7",
    borderStrong: "#A1A1AA",
    overlay: "rgba(0,0,0,0.45)",
    heroGradient: ["#111111", "#111111"] as [string, string],
    cardGradient: ["#FFFFFF", "#F4F4F5"] as [string, string],
    glow: "rgba(5,196,107,0.18)",
  },
  // "Premium dark" is RAIDEX's brand identity, not a system-driven fallback -
  // layered charcoal (never pure #000, which reads flat/basic on-screen and
  // swallows shadows) with an emerald primary accent and a warm gold secondary
  // accent reserved for rating/premium-tier moments, so the palette has two
  // distinct highlight colors instead of one accent doing all the work.
  dark: {
    surface: "#0A0A0E",
    surface2: "#16161D",
    surface3: "#202029",
    onSurface: "#F5F5F7",
    onSurface2: "#ABABB8",
    onSurface3: "#77778A",
    inverse: "#F5F5F7",
    onInverse: "#0A0A0E",
    accent: "#22D98B",
    accentBg: "#0F2E22",
    onAccentBg: "#5CEBAE",
    gold: "#F0B84C",
    goldBg: "#2E2410",
    info: "#5B9BF7",
    infoBg: "#132A4D",
    onInfoBg: "#8FBBFA",
    success: "#22D98B",
    warning: "#F0B84C",
    error: "#FF6B6B",
    border: "#242430",
    borderStrong: "#38384A",
    overlay: "rgba(0,0,0,0.78)",
    heroGradient: ["#0A0A0E", "#161622"] as [string, string],
    cardGradient: ["#181820", "#111116"] as [string, string],
    glow: "rgba(34,217,139,0.22)",
  },
};

export type Theme = typeof palette.light;

// RAIDEX ships as a single premium-dark experience by design (see palette.dark
// comment) rather than following the OS light/dark switch, so this ignores
// useColorScheme on purpose - kept as a param-free hook (not a plain export)
// so every call site still re-renders correctly and a per-user toggle can be
// wired in later without touching every screen.
export function useTheme(): Theme {
  useColorScheme();
  return palette.dark;
}
