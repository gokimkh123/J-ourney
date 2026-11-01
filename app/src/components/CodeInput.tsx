import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type CodeInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** 칸 수 */
  length: number;
  editable?: boolean;
  autoFocus?: boolean;
  accessibilityLabel: string;
};

/**
 * 한 글자씩 칸으로 보이는 코드 입력. 실제 입력은 칸 위에 겹친 투명한 입력칸 하나가 받는다
 * (칸마다 입력칸을 두면 지우기·붙여 넣기 때 칸 사이를 옮겨 다니는 처리가 필요하다).
 */
export default function CodeInput({ value, onChangeText, length, editable = true, autoFocus = false, accessibilityLabel }: CodeInputProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length }, (_, i) => value[i] ?? "");
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => input.current?.focus()} style={styles.row} accessible={false}>
      {cells.map((ch, i) => (
        <View key={i} style={[styles.cell, focused && i === active && { borderColor: colors.accent, borderWidth: 2 }]}>
          <AppText variant="title">{ch}</AppText>
        </View>
      ))}
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        maxLength={length}
        editable={editable}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        caretHidden
        selectionColor="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={accessibilityLabel}
        style={styles.hidden}
      />
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", gap: spacing.sm },
    cell: {
      flex: 1,
      minWidth: 0,
      height: 56,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
    },
    hidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, color: "transparent", opacity: 0.01 },
  });
