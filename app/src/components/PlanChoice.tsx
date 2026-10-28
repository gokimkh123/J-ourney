import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { hitSize, pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Banner from "./Banner.tsx";
import Button from "./Button.tsx";
import SegmentedTabs from "./SegmentedTabs.tsx";

export type PlanChoiceCard = { label: string; moveLabel: string; places: string[] };
export type PlanChoiceStop = { itemId: string; number: number; title: string; sub: string; moveLabel?: string; color: string };

export type PlanChoiceProps = {
  cards: PlanChoiceCard[];
  selected: string;
  onSelect: (label: string) => void;
  dayTabs: { key: string; label: string }[];
  day: string;
  onDay: (key: string) => void;
  /** 서버가 보낸 안내(이동이 긴 날 등). 없으면 null */
  notice: string | null;
  stops: PlanChoiceStop[];
  confirmLabel: string;
  onConfirm: () => void;
};

/** 일정안 고르기: 카드(이동 시간·대표 장소)로 안을 고르고, 아래에서 고른 안의 날짜별 동선을 본다. 정하기 버튼은 아래에 붙는다. */
export default function PlanChoice({ cards, selected, onSelect, dayTabs, day, onDay, notice, stops, confirmLabel, onConfirm }: PlanChoiceProps) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          어느 안으로 갈까요?
        </AppText>

        <View style={styles.cards} accessibilityRole="radiogroup" accessibilityLabel="일정안 고르기">
          {cards.map((card) => {
            const checked = card.label === selected;
            return (
              <Pressable
                key={card.label}
                onPress={() => onSelect(card.label)}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                accessibilityLabel={`${card.label}안, 이동 ${card.moveLabel}${card.places.length > 0 ? `, ${card.places.join(", ")}` : ""}`}
                style={({ pressed }) => [styles.card, checked && styles.cardOn, pressed && { opacity: pressedOpacity }]}
              >
                <View style={styles.cardHead}>
                  <AppText variant="heading" style={styles.cardName}>
                    {card.label}안
                  </AppText>
                  <View style={[styles.radio, checked && styles.radioOn]}>{checked && <View style={styles.radioDot} />}</View>
                </View>
                <AppText variant="small" tone="muted">
                  이동 <AppText variant="smallStrong">{card.moveLabel}</AppText>
                </AppText>
                {card.places.length > 0 && (
                  <AppText variant="small" style={styles.places}>
                    {card.places.join(" · ")}
                  </AppText>
                )}
              </Pressable>
            );
          })}
        </View>

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
        <Button label={confirmLabel} onPress={onConfirm} block size="lg" />
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
    cards: { flexDirection: "row", gap: spacing.sm },
    card: {
      flex: 1,
      minHeight: hitSize,
      borderWidth: 1.5,
      borderColor: t.colors.border,
      borderRadius: radius.lg,
      padding: spacing.sm + spacing.xs,
      gap: spacing.xxs,
      backgroundColor: t.colors.surface,
    },
    cardOn: { borderColor: t.colors.accent },
    cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardName: { fontSize: 20, lineHeight: 26 },
    radio: {
      width: 22,
      height: 22,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: t.colors.textMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: t.colors.accent },
    radioDot: { width: 12, height: 12, borderRadius: radius.full, backgroundColor: t.colors.accent },
    places: { color: t.colors.textBody, marginTop: spacing.xxs },
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
    footer: { paddingTop: spacing.sm },
  });
