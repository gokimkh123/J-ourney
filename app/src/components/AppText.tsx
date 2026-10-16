import { Text, type TextProps } from "react-native";

import { typography, useTheme, type ThemeColors, type TypographyVariant } from "../theme/index.ts";

export type TextTone =
  | "default"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "onAccent"
  | "onColor";

function toneColor(tone: TextTone, c: ThemeColors): string {
  switch (tone) {
    case "muted":
      return c.textMuted;
    case "accent":
      return c.accent;
    case "success":
      return c.success;
    case "warning":
      return c.warning;
    case "danger":
      return c.danger;
    case "onAccent":
      return c.onAccent;
    case "onColor":
      return c.textOnColor;
    default:
      return c.text;
  }
}

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
  /** 구성원 색처럼 데이터로 오는 색일 때만 쓴다. tone보다 우선. */
  color?: string;
  align?: "left" | "center" | "right";
};

/** 앱의 모든 글자. 크기·굵기는 variant, 색은 tone으로만 정한다. */
export default function AppText({
  variant = "body",
  tone = "default",
  color,
  align,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: color ?? toneColor(tone, colors) }, align && { textAlign: align }, style]}
    />
  );
}
