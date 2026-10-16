import { Text, type TextProps } from "react-native";

import { colors, typography, type TypographyVariant } from "../theme/index.ts";

export type TextTone =
  | "default"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "onAccent"
  | "onColor";

const TONE: Record<TextTone, string> = {
  default: colors.text,
  muted: colors.textMuted,
  accent: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  onAccent: colors.onAccent,
  onColor: colors.textOnColor,
};

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
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: color ?? TONE[tone] }, align && { textAlign: align }, style]}
    />
  );
}
