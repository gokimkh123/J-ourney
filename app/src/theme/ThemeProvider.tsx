import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { darkColors, lightColors, makeToneColors, type ThemeColors, type ToneColors } from "./colors.ts";
import { makeElevation, type Elevation } from "./layout.ts";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeScheme = "light" | "dark";

export type Theme = {
  scheme: ThemeScheme;
  colors: ThemeColors;
  toneColors: ToneColors;
  elevation: Elevation;
};

function buildTheme(scheme: ThemeScheme): Theme {
  const colors = scheme === "dark" ? darkColors : lightColors;
  return { scheme, colors, toneColors: makeToneColors(colors), elevation: makeElevation(scheme) };
}

const THEMES: Record<ThemeScheme, Theme> = { light: buildTheme("light"), dark: buildTheme("dark") };

const ThemeContext = createContext<Theme | null>(null);

/** 모드와 휴대폰 설정으로 실제 scheme을 정한다. 모드 저장·설정 화면은 화면 쪽 일. */
export function resolveScheme(mode: ThemeMode, system: string | null | undefined): ThemeScheme {
  if (mode === "light" || mode === "dark") return mode;
  return system === "dark" ? "dark" : "light";
}

export function ThemeProvider({ mode = "system", children }: { mode?: ThemeMode; children: ReactNode }) {
  const system = useColorScheme();
  const value = useMemo(() => THEMES[resolveScheme(mode, system)], [mode, system]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** 지금 모드의 색. Provider가 없으면 휴대폰 설정을 따른다. */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  const system = useColorScheme();
  return ctx ?? THEMES[resolveScheme("system", system)];
}

/**
 * 모드에 따라 달라지는 스타일을 만든다. factory는 모듈 맨 아래에 한 번만 정의해 둔다:
 *   const createStyles = (t: Theme) => StyleSheet.create({ ... });
 *   const styles = useStyles(createStyles);
 */
export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
