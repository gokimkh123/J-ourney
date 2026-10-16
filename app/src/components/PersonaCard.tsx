import { StyleSheet, View } from "react-native";

import { sourceBadge, traitRatio } from "../lib/ui/format.ts";
import type { Persona } from "../lib/persona/types.ts";
import { lightColors, outline, pastel, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar from "./Avatar.tsx";
import Card from "./Card.tsx";
import Chip from "./Chip.tsx";
import ProgressBar from "./ProgressBar.tsx";
import StatusPill from "./StatusPill.tsx";

// 파스텔 위에 올리는 글자는 어느 모드에서든 어두워야 읽힌다.
const ON_PASTEL = lightColors.text;

function joinItems(items: { text: string; emoji: string }[]): string {
  return items.map((item) => `${item.emoji} ${item.text}`).join(" · ");
}

/** A3 캐릭터 카드. props는 이전과 같다(persona 하나). */
export default function PersonaCard({ persona }: { persona: Persona }) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const color = persona.color;
  const soft = pastel(color);
  const line = outline(color);
  const likes = joinItems(persona.likes);
  const dislikes = persona.dislikes.length > 0 ? joinItems(persona.dislikes) : "없음";

  return (
    <View style={styles.stack}>
      <View style={[styles.card, { borderColor: line }]}>
        <View style={styles.topRow}>
          <AppText variant="label" color={line}>
            J-ourney 여행 캐릭터
          </AppText>
          <View style={[styles.no, { backgroundColor: soft }]}>
            <AppText variant="label" color={ON_PASTEL}>
              NO. {persona.no}
            </AppText>
          </View>
        </View>

        <View style={styles.hero}>
          <Avatar color={color} chips={persona.chips} name={persona.nickname} size="xl" variant="full" />
          <View style={styles.names}>
            <AppText variant="title" align="center">
              {persona.nickname}
            </AppText>
            <View style={[styles.titlePill, { backgroundColor: soft }]}>
              <AppText variant="smallStrong" color={ON_PASTEL}>
                {persona.title}
              </AppText>
            </View>
          </View>
        </View>

        <View style={[styles.bubble, { borderColor: line }]}>
          <AppText variant="body" align="center">
            “{persona.catchphrase}”
          </AppText>
        </View>

        {persona.chips.length > 0 && (
          <View style={styles.chips}>
            {persona.chips.map((chip) => (
              <Chip key={chip.label} label={chip.label} emoji={chip.emoji} size="sm" />
            ))}
          </View>
        )}

        <View style={styles.lines}>
          <View style={styles.line}>
            <AppText variant="smallStrong" style={styles.lineLabel}>
              좋아요
            </AppText>
            <AppText variant="small" style={styles.lineValue}>
              {likes}
            </AppText>
          </View>
          <View style={styles.line}>
            <AppText variant="smallStrong" style={styles.lineLabel}>
              싫어요
            </AppText>
            <AppText variant="small" tone={persona.dislikes.length > 0 ? "default" : "muted"} style={styles.lineValue}>
              {dislikes}
            </AppText>
          </View>
        </View>

        <View style={styles.tmi}>
          <View style={styles.tmiTag}>
            <AppText variant="label" color={ON_PASTEL}>
              ???
            </AppText>
          </View>
          <AppText variant="small" color={colors.warningText} style={styles.lineValue}>
            {persona.tmi}
          </AppText>
        </View>
      </View>

      <View style={styles.source}>
        <StatusPill label={sourceBadge(persona.source)} tone={persona.source === "llm" ? "accent" : "neutral"} />
      </View>

      {persona.mustKeep.length > 0 && (
        <Card title="꼭 지킬 것">
          {persona.mustKeep.map((item, i) => (
            <AppText key={i} variant="small">
              • {item.label}
            </AppText>
          ))}
        </Card>
      )}

      {persona.wishes.length > 0 && (
        <Card title="그 밖의 바람">
          {persona.wishes.map((wish, i) => (
            <AppText key={i} variant="small">
              • {wish}
            </AppText>
          ))}
        </Card>
      )}

      <Card title="성향 자세히 보기">
        <View style={styles.traits}>
          {persona.traits.map((trait) => {
            const neutral = trait.level === "neutral";
            const label = neutral ? "상관없음" : trait.label;
            return (
              <View key={trait.key} style={styles.trait}>
                <View style={styles.traitHead}>
                  <AppText variant="small" tone="muted">
                    {trait.name}
                  </AppText>
                  <AppText variant="smallStrong" tone={neutral ? "muted" : "default"}>
                    {trait.emoji === "" ? "" : `${trait.emoji} `}
                    {label}
                  </AppText>
                </View>
                <ProgressBar
                  value={traitRatio(trait.score)}
                  color={neutral ? colors.border : color}
                  accessibilityLabel={`${trait.name} ${label}`}
                />
              </View>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  card: {
    alignItems: "stretch",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 2,
    borderRadius: radius.lg,
    backgroundColor: t.colors.surface,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  no: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm + spacing.xxs,
    borderRadius: radius.full,
  },
  hero: {
    alignItems: "center",
    gap: spacing.sm + spacing.xs,
    paddingTop: spacing.sm,
  },
  names: {
    alignItems: "center",
    gap: spacing.sm,
  },
  titlePill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md - spacing.xxs,
    borderRadius: radius.full,
  },
  bubble: {
    paddingVertical: spacing.sm + spacing.xxs,
    paddingHorizontal: spacing.md - spacing.xxs,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceRaised,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.xs + spacing.xxs,
  },
  lines: {
    gap: spacing.xs + spacing.xxs,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + spacing.xs,
  },
  lineLabel: {
    width: 44,
  },
  lineValue: {
    flex: 1,
  },
  tmi: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm + spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: t.colors.warningSurface,
  },
  tmiTag: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: t.colors.warning,
  },
  source: {
    alignItems: "center",
  },
  traits: {
    gap: spacing.sm + spacing.xs,
  },
  trait: {
    gap: spacing.xs + spacing.xxs,
  },
  traitHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.sm,
  },
});
