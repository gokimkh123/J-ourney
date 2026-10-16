import { StyleSheet, View } from "react-native";

import { spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type Stat = { value: string; label: string };

/** 숫자 2~4개를 나란히: B3 "걸린 시간 · 제안 · 수정" */
export default function StatGroup({ items }: { items: Stat[] }) {
  return (
    <View style={styles.row}>
      {items.map((s) => (
        <View key={s.label} style={styles.cell} accessible accessibilityLabel={`${s.label} ${s.value}`}>
          <AppText variant="statNumber" align="center">
            {s.value}
          </AppText>
          <AppText variant="caption" tone="muted" align="center">
            {s.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cell: {
    flex: 1,
    gap: spacing.xxs,
  },
});
