import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type InfoRow = { label: string; value: string | ReactNode };

/** 이름표 | 값 목록: C2 장소 정보(주소·영업시간·메뉴·인기도·혼잡도) */
export default function InfoList({ rows }: { rows: InfoRow[] }) {
  return (
    <View style={styles.list}>
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <AppText variant="small" tone="muted" style={styles.label}>
            {r.label}
          </AppText>
          <View style={styles.value}>
            {typeof r.value === "string" ? <AppText variant="small">{r.value}</AppText> : r.value}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + spacing.xxs,
  },
  label: {
    width: 64,
  },
  value: {
    flex: 1,
    minWidth: 0,
  },
});
