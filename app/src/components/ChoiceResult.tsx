import { ScrollView, StyleSheet, View } from "react-native";

import { radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";

export type ChoiceResultProps = {
  /** 제목 위 작은 글("정했어요" 또는 같은 수일 때의 까닭) */
  head: string;
  title: string;
  rows: { name: string; votes: number; win: boolean }[];
  /** 같은 수라 방장이 고른 안으로 정해졌으면 정해진 줄에 "방장" */
  hostPick: boolean;
  onNext: () => void;
};

/**
 * A·B가 정해진 화면(B3). 표 수 막대에는 글자를 넣지 않는다(3:1이면 짧은 칸이 좁아 이름이 안 들어간다).
 * 이름은 아래 줄에 한 줄로 줄여 보이고 제목은 줄바꿈해서 다 보인다.
 */
export default function ChoiceResult({ head, title, rows, hostPick, onNext }: ChoiceResultProps) {
  const styles = useStyles(createStyles);
  const total = rows.reduce((sum, r) => sum + r.votes, 0);
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <AppText variant="small" tone="muted">
            {head}
          </AppText>
          <AppText variant="display" accessibilityRole="header">
            {title}
          </AppText>
        </View>
        {total > 0 && (
          <View style={styles.bar} importantForAccessibility="no-hide-descendants">
            {rows.map((r) => (r.votes > 0 ? <View key={r.name} style={[styles.part, { flex: r.votes }, r.win && styles.partWin]} /> : null))}
          </View>
        )}
        <View>
          {rows.map((r) => (
            <View key={r.name} style={styles.row} accessible accessibilityLabel={`${r.name} ${r.votes}표${r.win ? ", 정해짐" : ""}`}>
              <AppText variant={r.win ? "smallStrong" : "small"} numberOfLines={1} style={[styles.rowName, !r.win && styles.rowNameOther]}>
                {r.name}
              </AppText>
              <AppText variant="smallStrong">
                {r.votes}표{r.win && hostPick ? " · 방장" : ""}
              </AppText>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="일정 보고 고치기" onPress={onNext} block size="lg" />
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // 시트 본문은 높이가 정해져 있지 않아서 flex: 1이면 폰(Yoga)에서 높이 0으로 접힌다. 남는 만큼만 차지하며 줄어들게 한다.
    root: { flexShrink: 1, minHeight: 0 },
    scroll: { flexShrink: 1 },
    content: { gap: spacing.sm + spacing.xs, paddingBottom: spacing.sm },
    titleBlock: { gap: spacing.xxs },
    bar: { flexDirection: "row", height: 8, gap: 2, borderRadius: radius.full, overflow: "hidden" },
    part: { backgroundColor: t.colors.border },
    partWin: { backgroundColor: t.colors.accent },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
    rowName: { flex: 1, minWidth: 0 },
    rowNameOther: { color: t.colors.textBody },
    footer: { paddingTop: spacing.sm },
  });
