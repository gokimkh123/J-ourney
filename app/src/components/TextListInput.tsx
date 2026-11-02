import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { hitSize, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type InlineFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  /** 오른쪽 ✕를 누를 때(칸 지우기). 없으면 ✕를 그리지 않는다 */
  onClear?: () => void;
  accessibilityLabel: string;
  autoFocus?: boolean;
};

/** 한 줄 입력칸. 오른쪽에 ✕(지우기). 가고 싶은 곳·기타·예약한 숙소에 쓴다. */
export function InlineField({ value, onChangeText, placeholder, maxLength, onClear, accessibilityLabel, autoFocus }: InlineFieldProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        maxLength={maxLength}
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="done"
        style={styles.input}
      />
      {onClear !== undefined && (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityLabel} 지우기`}
          style={({ pressed }) => [styles.clear, pressed && { opacity: pressedOpacity }]}
        >
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M4 4l8 8M12 4l-8 8" stroke={colors.textMuted} strokeWidth={1.8} strokeLinecap="round" fill="none" />
          </Svg>
        </Pressable>
      )}
    </View>
  );
}

export type TextListInputProps = {
  values: string[];
  onChange: (values: string[]) => void;
  /** 칸 수 상한. 차면 추가 버튼이 사라진다 */
  max: number;
  maxLength: number;
  placeholder?: string;
  /** 추가 버튼 글자(예: "장소 추가") */
  addLabel: string;
  /** 칸마다 읽어 줄 이름(예: "가고 싶은 곳") */
  itemLabel: string;
  /** 비어 있을 때 칸 하나를 먼저 보여 줄지(가고 싶은 곳). false면 추가 버튼만 보인다(예약한 장소) */
  startWithField?: boolean;
};

/** 한 줄 입력칸을 하나씩 추가하는 목록(가고 싶은 곳·예약한 장소). 칸마다 ✕로 지운다. */
export default function TextListInput({ values, onChange, max, maxLength, placeholder, addLabel, itemLabel, startWithField = true }: TextListInputProps) {
  const styles = useStyles(createStyles);
  const rows = values.length === 0 && startWithField ? [""] : values;
  const set = (i: number, text: string) => onChange(rows.map((v, j) => (j === i ? text : v)));
  // 칸이 하나뿐이면(처음 칸) 지우면 빈 칸으로 남긴다.
  const remove = (i: number) => onChange(rows.length === 1 && startWithField ? [] : rows.filter((_, j) => j !== i));
  return (
    <View style={styles.list}>
      {rows.map((value, i) => (
        <InlineField
          key={i}
          value={value}
          onChangeText={(text) => set(i, text)}
          placeholder={placeholder}
          maxLength={maxLength}
          onClear={value !== "" || rows.length > 1 || !startWithField ? () => remove(i) : undefined}
          accessibilityLabel={`${itemLabel} ${i + 1}`}
          // 추가 버튼으로 새로 연 칸에만 커서를 둔다(처음부터 보이는 첫 칸은 아님).
          autoFocus={value === "" && i === rows.length - 1 && (i > 0 || !startWithField)}
        />
      ))}
      {rows.length < max && (
        <Pressable
          onPress={() => onChange([...rows, ""])}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          style={({ pressed }) => [styles.add, pressed && { opacity: pressedOpacity }]}
        >
          <AppText variant="bodyStrong" tone="accent">
            {`+ ${addLabel}`}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    list: { gap: spacing.sm },
    field: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      paddingLeft: spacing.sm + spacing.xs,
    },
    input: { flex: 1, minHeight: 46, fontSize: 15, color: t.colors.text, paddingVertical: spacing.sm },
    clear: { width: hitSize, height: hitSize, alignItems: "center", justifyContent: "center" },
    add: {
      minHeight: 48,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: t.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
  });
