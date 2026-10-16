import { StyleSheet, View } from "react-native";

import { spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar from "./Avatar.tsx";

export type ConcessionRowProps = {
  name: string;
  color: string;
  /** 양보한 것 */
  gave: string;
  /** 대신 얻은 것 */
  got: string;
};

/** B3 "서로 양보한 것" 한 줄: 양보(취소선) → 얻음(굵게). 조사 붙임 문제를 피하려고 이름표로 나눈다. */
export default function ConcessionRow({ name, color, gave, got }: ConcessionRowProps) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${name}: ${gave} 양보, ${got} 얻음`}>
      <Avatar color={color} name={name} size="sm" />
      <View style={styles.body}>
        <View style={styles.line}>
          <AppText variant="caption" tone="muted" style={styles.tag}>
            양보
          </AppText>
          <AppText variant="small" tone="muted" style={[styles.flex, styles.gave]}>
            {gave}
          </AppText>
        </View>
        <View style={styles.line}>
          <AppText variant="caption" tone="accent" style={styles.tag}>
            얻음
          </AppText>
          <AppText variant="smallStrong" style={styles.flex}>
            {got}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  line: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  tag: {
    width: 28,
  },
  flex: {
    flex: 1,
  },
  gave: {
    textDecorationLine: "line-through",
  },
});
