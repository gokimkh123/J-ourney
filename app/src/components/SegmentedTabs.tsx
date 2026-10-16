import { Pressable, StyleSheet, View } from "react-native";

import { hitSize, pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type SegmentOption<K extends string> = { key: K; label: string };

export type SegmentedTabsProps<K extends string> = {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
};

/** 같은 화면 안에서 보기를 바꾸는 탭: C1 "1일차 / 2일차" */
export default function SegmentedTabs<K extends string>({ options, value, onChange, accessibilityLabel }: SegmentedTabsProps<K>) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.tab, selected && styles.selected, pressed && { opacity: pressedOpacity }]}
          >
            <AppText variant="label" tone={selected ? "default" : "muted"} numberOfLines={1}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    minHeight: hitSize - spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    paddingHorizontal: spacing.sm,
  },
  selected: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accentSoft,
  },
});
