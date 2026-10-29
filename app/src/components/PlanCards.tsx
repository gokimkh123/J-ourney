import { Pressable, StyleSheet, View } from "react-native";

import { hitSize, pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type PlanCard = { planId: string; name: string; moveLabel: string; places: string[] };

export type PlanCardsProps = {
  cards: PlanCard[];
  /** 고른 카드의 planId. 없으면 null */
  selected: string | null;
  onSelect: (planId: string) => void;
};

/** 일정안 두 장을 나란히 두고 하나를 고른다. 이름은 서버가 지은 이름이고, 이름·대표 장소는 2줄까지 보인다. */
export default function PlanCards({ cards, selected, onSelect }: PlanCardsProps) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.cards} accessibilityRole="radiogroup" accessibilityLabel="일정안 고르기">
      {cards.map((card) => {
        const checked = card.planId === selected;
        return (
          <Pressable
            key={card.planId}
            onPress={() => onSelect(card.planId)}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            accessibilityLabel={`${card.name}, 이동 ${card.moveLabel}${card.places.length > 0 ? `, ${card.places.join(", ")}` : ""}`}
            style={({ pressed }) => [styles.card, checked && styles.cardOn, pressed && { opacity: pressedOpacity }]}
          >
            <View style={styles.cardHead}>
              <AppText variant="heading" numberOfLines={2} style={styles.cardName}>
                {card.name}
              </AppText>
              <View style={[styles.radio, checked && styles.radioOn]}>{checked && <View style={styles.radioDot} />}</View>
            </View>
            <AppText variant="small" tone="muted">
              이동 <AppText variant="smallStrong">{card.moveLabel}</AppText>
            </AppText>
            {card.places.length > 0 && (
              <AppText variant="small" numberOfLines={2} style={styles.places}>
                {card.places.join(" · ")}
              </AppText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
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
    cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
    cardName: { flex: 1, minWidth: 0 },
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
  });
