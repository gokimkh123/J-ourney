import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, disabledOpacity, hitSize, pressedOpacity, radius, spacing } from "../theme/index.ts";
import AppText, { type TextTone } from "./AppText.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 앞에 붙는 이모지·기호 한 글자 */
  icon?: string;
  disabled?: boolean;
  /** true면 눌리지 않고 글자 대신 도는 표시를 보여 준다. 너비는 그대로. */
  loading?: boolean;
  /** 부모 너비를 다 채운다(시트 아래 주요 버튼). */
  block?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

const VARIANT: Record<ButtonVariant, { bg: string; border: string; text: TextTone; spinner: string }> = {
  primary: { bg: colors.accent, border: colors.accent, text: "onAccent", spinner: colors.onAccent },
  secondary: { bg: colors.surfaceRaised, border: colors.border, text: "default", spinner: colors.text },
  ghost: { bg: "transparent", border: "transparent", text: "accent", spinner: colors.accent },
};

const SIZE: Record<ButtonSize, { height: number; padH: number; radius: number }> = {
  sm: { height: 36, padH: spacing.md, radius: radius.md },
  md: { height: hitSize, padH: spacing.lg, radius: radius.lg },
  lg: { height: 56, padH: spacing.lg, radius: radius.lg },
};

export default function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  disabled = false,
  loading = false,
  block = false,
  accessibilityHint,
  style,
}: ButtonProps) {
  const v = VARIANT[variant];
  const s = SIZE[size];
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={size === "sm" ? spacing.xs : undefined}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: s.height,
          paddingHorizontal: s.padH,
          borderRadius: s.radius,
          backgroundColor: v.bg,
          borderColor: v.border,
        },
        block && styles.block,
        pressed && !inactive && { opacity: pressedOpacity },
        disabled && { opacity: disabledOpacity },
        style,
      ]}
    >
      {/* 로딩 중에도 글자 자리를 지켜서 버튼 너비가 흔들리지 않게 한다. */}
      <View style={[styles.content, loading && styles.hidden]}>
        {icon !== undefined && (
          <AppText variant={size === "sm" ? "label" : "button"} tone={v.text}>
            {icon}
          </AppText>
        )}
        <AppText variant={size === "sm" ? "label" : "button"} tone={v.text} numberOfLines={1}>
          {label}
        </AppText>
      </View>
      {loading && <ActivityIndicator style={StyleSheet.absoluteFill} color={v.spinner} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  block: {
    alignSelf: "stretch",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  hidden: {
    opacity: 0,
  },
});
