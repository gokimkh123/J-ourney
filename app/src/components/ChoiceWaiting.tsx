import { ScrollView, StyleSheet, View } from "react-native";

import { spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar from "./Avatar.tsx";
import Button from "./Button.tsx";
import PlanCards, { type PlanCard } from "./PlanCards.tsx";

export type ChoiceWaitingPerson = { memberId: string; name: string; color: string; done: boolean; me: boolean };

export type ChoiceWaitingProps = {
  cards: PlanCard[];
  /** 내가 고른 안. 다른 카드를 누르면 바로 다시 고른다 */
  mine: string | null;
  onChange: (planId: string) => void;
  /** 누가 골랐는지만(무엇을 골랐는지는 정해질 때까지 숨김) */
  people: ChoiceWaitingPerson[];
  /** 방장에게만 넘긴다. 없으면 버튼이 안 보인다 */
  onDecide?: () => void;
  sending: boolean;
  error: string | null;
};

/** 내가 고른 뒤 다른 사람을 기다리는 화면(B3). 방장에게만 "지금 정하기"가 보인다. */
export default function ChoiceWaiting({ cards, mine, onChange, people, onDecide, sending, error }: ChoiceWaitingProps) {
  const styles = useStyles(createStyles);
  const done = people.filter((p) => p.done).length;
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          선택 완료
        </AppText>
        <PlanCards cards={cards} selected={mine} onSelect={onChange} />
        <View accessibilityLiveRegion="polite">
          {people.map((p) => (
            <View key={p.memberId} style={styles.person} accessible accessibilityLabel={`${p.name} ${p.done ? "선택 완료" : "선택 중"}`}>
              <Avatar color={p.color} name={p.name} size="sm" />
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                {p.me ? `${p.name} (나)` : p.name}
              </AppText>
              <AppText variant={p.done ? "smallStrong" : "small"} tone={p.done ? "default" : "muted"}>
                {p.done ? "✓ 선택 완료" : "선택 중"}
              </AppText>
            </View>
          ))}
        </View>
      </ScrollView>
      {(onDecide !== undefined || error !== null) && (
        <View style={styles.footer}>
          {error !== null && (
            <AppText variant="small" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          {onDecide !== undefined && <Button label={`지금 정하기 (${done}/${people.length}명)`} onPress={onDecide} loading={sending} block size="lg" />}
        </View>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // 시트 본문은 높이가 정해져 있지 않아서 flex: 1이면 폰(Yoga)에서 높이 0으로 접힌다. 남는 만큼만 차지하며 줄어들게 한다.
    root: { flexShrink: 1, minHeight: 0 },
    scroll: { flexShrink: 1 },
    content: { gap: spacing.sm + spacing.xs, paddingBottom: spacing.sm },
    person: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    name: { flex: 1, minWidth: 0 },
    footer: { gap: spacing.xs, paddingTop: spacing.sm },
  });
