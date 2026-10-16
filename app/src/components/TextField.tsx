import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { hitSize, radius, spacing, typography, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type TextFieldProps = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  label: string;
  /** 입력칸 아래 안내(예: "1박 2일 · 최대 7일까지") */
  hint?: string;
  /** 있으면 hint 대신 빨간 글자로 보이고 테두리도 빨갛게 바뀐다. */
  error?: string | null;
};

export default function TextField({ label, hint, error, editable = true, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const hasError = error !== undefined && error !== null && error !== "";
  const borderColor = hasError ? colors.danger : focused ? colors.accent : colors.border;

  return (
    <View style={styles.wrap}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      <TextInput
        {...rest}
        editable={editable}
        accessibilityLabel={label}
        accessibilityHint={hasError ? error : hint}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { borderColor }, !editable && styles.disabled]}
      />
      {hasError ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : hint !== undefined ? (
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  wrap: {
    gap: spacing.xs + spacing.xxs,
  },
  input: {
    ...typography.body,
    color: t.colors.text,
    minHeight: hitSize,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: t.colors.surfaceRaised,
  },
  disabled: {
    color: t.colors.textMuted,
  },
});
