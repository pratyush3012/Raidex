import { useColorScheme } from "react-native";

export const tokens = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  type: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32, hero: 40 },
};

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
