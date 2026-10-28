import { ScrollView, StyleSheet, View } from "react-native";

import { spacing, radius, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";
import ProgressBar from "./ProgressBar.tsx";

export type ReviewWaitingProps = {
  /** 오른쪽 위 "2/4" */
  countLabel: string;
  /** 화면 읽기용 "4명 중 2명 답했어요" */
  spokenCount: string;
  /** 0~1 */
  progress: number;
  people: { memberId: string; name: string; answered: boolean }[];
  /** 내가 고른 것(번호는 지도 핀과 같다) */
  mine: { number: number; name: string; keep: boolean }[];
  /** 방장에게만 넘긴다. 없으면 버튼이 안 보인다. */
  onProceed?: () => void;
  proceeding?: boolean;
  error: string | null;
};

/** 사람 확인을 보낸 뒤 다른 사람을 기다리는 화면. 방장에게만 "기다리지 않고 진행하기"가 보인다. */
export default function ReviewWaiting({ countLabel, spokenCount, progress, people, mine, onProceed, proceeding = false, error }: ReviewWaitingProps) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <AppText variant="title" accessibilityRole="header">
              다른 사람을 기다리고 있어요
            </AppText>
            <AppText variant="small" tone="muted">
              모두 답하면 AI가 바로 일정을 짜요.
            </AppText>
          </View>
          <AppText variant="numeric" accessibilityLabel={spokenCount}>
            {countLabel}
          </AppText>
        </View>
        <ProgressBar value={progress} accessibilityLabel={spokenCount} />
        <View style={styles.people} accessibilityLiveRegion="polite">
          {people.map((p) => (
            <AppText key={p.memberId} variant={p.answered ? "smallStrong" : "small"} tone={p.answered ? "default" : "muted"} accessibilityLabel={`${p.name} ${p.answered ? "답함" : "기다리는 중"}`}>
              {p.answered ? `✓ ${p.name}` : p.name}
            </AppText>
          ))}
        </View>
        {mine.length > 0 && (
          <View style={styles.mine}>
            <AppText variant="caption" tone="muted">
              내가 고른 것
            </AppText>
            {mine.map((m) => (
              <AppText key={m.number} variant="small" style={styles.mineText}>
                {m.number} {m.name} — {m.keep ? "넣기" : "빼기"}
              </AppText>
            ))}
          </View>
        )}
      </ScrollView>
      {(onProceed !== undefined || error !== null) && (
        <View style={styles.footer}>
          {error !== null && (
            <AppText variant="small" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          {onProceed !== undefined && <Button label="기다리지 않고 진행하기" variant="secondary" onPress={onProceed} loading={proceeding} block size="lg" />}
        </View>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, minHeight: 0 },
    scroll: { flex: 1 },
    content: { gap: spacing.sm + spacing.xs, paddingBottom: spacing.sm },
    head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    headText: { flex: 1, gap: spacing.xxs },
    people: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xs },
    mine: { backgroundColor: t.colors.surfaceSunken, borderRadius: radius.md, padding: spacing.sm + spacing.xs, gap: spacing.xxs },
    mineText: { color: t.colors.textBody },
    footer: { gap: spacing.xs, paddingTop: spacing.sm },
  });
