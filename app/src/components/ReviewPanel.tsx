import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { ReviewItemData } from "../lib/meeting/types.ts";
import { hitSize, pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";

export type ReviewPanelProps = {
  items: ReviewItemData[];
  /** 장소가 아닌 참고 메모(읽기만) */
  memos: string[];
  /** 안건별로 고른 것: true 넣기, false 빼기. 안 고른 안건은 키가 없다. */
  picks: Record<string, boolean>;
  onPick: (placeId: string, keep: boolean) => void;
  /** 오른쪽 위 "1/2" */
  countLabel: string;
  /** 아래 버튼 글자: "내 선택 보내기" 또는 "1개 더 골라 주세요" */
  sendLabel: string;
  canSend: boolean;
  sending: boolean;
  onSubmit: () => void;
  /** 보내기에 실패했을 때 알려 줄 문장 */
  error: string | null;
};

/** 사람 확인(5단계): AI들 의견이 갈린 장소를 넣을지 뺄지 안건마다 고른다. 시트 안에서 목록은 스크롤되고 보내기 버튼은 아래에 붙는다. */
export default function ReviewPanel({
  items,
  memos,
  picks,
  onPick,
  countLabel,
  sendLabel,
  canSend,
  sending,
  onSubmit,
  error,
}: ReviewPanelProps) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <AppText variant="title" accessibilityRole="header">
              이 장소들, 넣을까요?
            </AppText>
            <AppText variant="small" tone="muted">
              AI들의 의견이 갈린 곳이에요. 함께 가는 사람이 정해요.
            </AppText>
          </View>
          <AppText variant="numeric" accessibilityLabel={`${countLabel.replace("/", " 중 ")}개 골랐어요`}>
            {countLabel}
          </AppText>
        </View>

        {items.map((item, index) => {
          const pick = picks[item.placeId];
          return (
            <View key={item.placeId} style={styles.card} accessibilityLabel={`${index + 1}번 ${item.name}`}>
              <View style={styles.cardHead}>
                <View style={styles.badge}>
                  <AppText variant="label">{index + 1}</AppText>
                </View>
                <AppText variant="heading" style={styles.name}>
                  {item.name}
                </AppText>
              </View>
              <AppText variant="small" style={styles.body}>
                {item.text}
              </AppText>
              {item.consequence !== null && (
                <View style={styles.consequence}>
                  <AppText variant="small" style={styles.consequenceText}>
                    ⚠ {item.consequence}
                  </AppText>
                </View>
              )}
              <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={`${item.name} 넣을지 뺄지`}>
                <Choice label="넣기" checked={pick === true} onPress={() => onPick(item.placeId, true)} />
                <Choice label="빼기" checked={pick === false} onPress={() => onPick(item.placeId, false)} />
              </View>
            </View>
          );
        })}

        {memos.length > 0 && (
          <View style={styles.memo}>
            <AppText variant="caption" tone="muted">
              참고
            </AppText>
            {memos.map((memo, i) => (
              <AppText key={i} variant="small" style={styles.body}>
                {memo}
              </AppText>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {error !== null && (
          <AppText variant="small" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </AppText>
        )}
        <Button label={sendLabel} onPress={onSubmit} disabled={!canSend} loading={sending} block size="lg" />
      </View>
    </View>
  );
}

function Choice({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.choice, checked && styles.choiceOn, pressed && { opacity: pressedOpacity }]}
    >
      <AppText variant="button" tone={checked ? "onAccent" : "default"}>
        {checked ? `✓ ${label}` : label}
      </AppText>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, minHeight: 0 },
    scroll: { flex: 1 },
    content: { gap: spacing.sm + spacing.xs, paddingBottom: spacing.sm },
    head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    headText: { flex: 1, gap: spacing.xxs },
    card: {
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: radius.lg,
      padding: spacing.sm + spacing.xs,
      gap: spacing.xs,
      backgroundColor: t.colors.surface,
    },
    cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    badge: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: t.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { flex: 1, minWidth: 0 },
    body: { color: t.colors.textBody },
    consequence: {
      backgroundColor: t.colors.warningSurface,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm + spacing.xs,
    },
    consequenceText: { color: t.colors.warningText },
    choices: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    choice: {
      flex: 1,
      minHeight: hitSize,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: t.colors.iconFaint,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    choiceOn: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
    memo: { backgroundColor: t.colors.surfaceSunken, borderRadius: radius.md, padding: spacing.sm + spacing.xs, gap: spacing.xxs },
    footer: { gap: spacing.xs, paddingTop: spacing.sm },
  });
