import { StyleSheet, View } from "react-native";

import { colors, spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar from "./Avatar.tsx";
import ProgressBar from "./ProgressBar.tsx";

export type SatisfactionRowProps = {
  name: string;
  color: string;
  /** 0~10 */
  score: number;
  /** 이 점수 미만이면 숫자를 경고색으로(회의 규칙 aiMinSatisfaction) */
  threshold?: number;
};

/** B3 구성원 만족도 한 줄: 아바타 · 이름 · 막대 · 점수 */
export default function SatisfactionRow({ name, color, score, threshold }: SatisfactionRowProps) {
  const below = threshold !== undefined && score < threshold;
  return (
    <View style={styles.row} accessible accessibilityLabel={`${name} 만족도 ${score}점${below ? ", 기준 미달" : ""}`}>
      <Avatar color={color} name={name} size="sm" />
      <AppText variant="small" style={styles.name} numberOfLines={1}>
        {name}
      </AppText>
      <View style={styles.bar}>
        <ProgressBar value={score / 10} color={color} />
      </View>
      <AppText variant="numeric" tone={below ? "warning" : "default"} align="right" style={styles.score}>
        {score}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    width: 44,
    color: colors.text,
  },
  bar: {
    flex: 1,
  },
  score: {
    width: 22,
  },
});
