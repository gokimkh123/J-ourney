import { ScrollView, StyleSheet, View } from "react-native";

import { radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar from "./Avatar.tsx";
import Banner from "./Banner.tsx";
import Button from "./Button.tsx";
import PlanCards, { type PlanCard } from "./PlanCards.tsx";
import SegmentedTabs from "./SegmentedTabs.tsx";

export type PlanChoiceStop = { itemId: string; number: number; title: string; sub: string; moveLabel?: string; color: string };
export type PlanChoicePerson = { memberId: string; name: string; color: string; done: boolean };

export type PlanChoiceProps = {
  cards: PlanCard[];
  selected: string | null;
  onSelect: (planId: string) => void;
  /** 몇 명이 골랐는지(얼굴과 "1/4명 선택 완료"). 무엇을 골랐는지는 보이지 않는다 */
  people: PlanChoicePerson[];
  dayTabs: { key: string; label: string }[];
  day: string;
  onDay: (key: string) => void;
  /** 서버가 보낸 안내(이동이 긴 날 등). 없으면 null */
  notice: string | null;
  stops: PlanChoiceStop[];
  onConfirm: () => void;
  sending: boolean;
  error: string | null;
};

/** 일정안 고르기(B3): 카드로 안을 고르고, 아래에서 고른 안의 날짜별 동선을 본다. 고르기 버튼은 아래에 붙는다. */
export default function PlanChoice({ cards, selected, onSelect, people, dayTabs, day, onDay, notice, stops, onConfirm, sending, error }: PlanChoiceProps) {
  const styles = useStyles(createStyles);
  const done = people.filter((p) => p.done).length;
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          어느 안으로 갈까요?
        </AppText>

        <PlanCards cards={cards} selected={selected} onSelect={onSelect} />

        {people.length > 0 && (
          <View style={styles.who} accessible accessibilityLabel={`${people.length}명 중 ${done}명 선택 완료`}>
            <View style={styles.faces}>
              {people.map((p, i) => (
                <View key={p.memberId} style={[i > 0 && styles.faceOverlap, !p.done && styles.faceWaiting]}>
                  <Avatar color={p.color} name={p.name} size="sm" />
                </View>
              ))}
            </View>
            <AppText variant="small" style={styles.whoText}>
              <AppText variant="smallStrong">
                {done}/{people.length}명
              </AppText>{" "}
              선택 완료
            </AppText>
          </View>
        )}

        {notice !== null && <Banner text={notice} />}

        {dayTabs.length > 1 && <SegmentedTabs options={dayTabs} value={day} onChange={onDay} accessibilityLabel="날짜 고르기" />}

        <View>
          {stops.map((stop, i) => (
            <View key={stop.itemId} style={styles.stop} accessible accessibilityLabel={`${stop.number}번 ${stop.title}, ${stop.sub}${stop.moveLabel ? `, 다음까지 ${stop.moveLabel}` : ""}`}>
              <View style={styles.rail}>
                <View style={[styles.num, { borderColor: stop.color }]}>
                  <AppText variant="label" tone="onAccent">
                    {stop.number}
                  </AppText>
                </View>
                {i < stops.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.stopBody}>
                <AppText variant="bodyStrong">{stop.title}</AppText>
                <AppText variant="small" tone="muted">
                  {stop.sub}
                </AppText>
                {stop.moveLabel !== undefined && (
                  <AppText variant="caption" tone="muted">
                    {stop.moveLabel}
                  </AppText>
                )}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {error !== null && (
          <AppText variant="small" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </AppText>
        )}
        <Button label="고르기" onPress={onConfirm} disabled={selected === null} loading={sending} block size="lg" />
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
    who: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.sm + spacing.xs,
      paddingVertical: spacing.sm,
    },
    faces: { flexDirection: "row" },
    faceOverlap: { marginLeft: -spacing.sm },
    // 아직 안 고른 사람은 흐리게. 숫자("1/4명")가 함께 있어 흐림만으로 구분하지 않는다.
    faceWaiting: { opacity: 0.35 },
    whoText: { flex: 1, color: t.colors.textBody },
    stop: { flexDirection: "row", gap: spacing.sm + spacing.xs },
    rail: { width: 28, alignItems: "center" },
    // 숫자는 흰 글자가 구성원 색 위에서 4.5:1이 안 나와서 어두운 원에 담고, 구성원 색은 테두리로 둔다.
    num: {
      width: 28,
      height: 28,
      borderRadius: radius.full,
      borderWidth: 3,
      backgroundColor: t.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    line: { width: 2, flex: 1, backgroundColor: t.colors.border, marginVertical: 2 },
    stopBody: { flex: 1, paddingBottom: spacing.sm + spacing.xs, minHeight: 52 },
    footer: { gap: spacing.xs, paddingTop: spacing.sm },
  });
