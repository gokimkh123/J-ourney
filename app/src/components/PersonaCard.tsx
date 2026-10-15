import { StyleSheet, Text, View } from "react-native";

import { sourceBadge, traitRatio, withAlpha } from "../lib/ui/format.ts";
import { colors } from "../lib/theme.ts";
import type { Persona } from "../lib/persona/types.ts";

const WHITE = "#FFFFFF";
const YELLOW = "#FEF3C7";
const GRAY = "#D1D5DB";

function joinItems(items: { text: string; emoji: string }[]): string {
  return items.map((item) => `${item.emoji} ${item.text}`).join(" · ");
}

export default function PersonaCard({ persona }: { persona: Persona }) {
  const color = persona.color;
  const emoji = persona.chips.length > 0 ? persona.chips[0].emoji : "🍀";
  const likes = joinItems(persona.likes);
  const dislikes = persona.dislikes.length > 0 ? joinItems(persona.dislikes) : "없음";

  return (
    <View>
      <View style={[styles.card, { borderColor: color }]}>
        <View style={styles.topRow}>
          <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.15) }]}>
            <Text style={[styles.pillText, { color }]}>J-ourney 여행 캐릭터</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: color }]}>
            <Text style={[styles.pillText, { color: WHITE }]}>NO. {persona.no}</Text>
          </View>
        </View>

        <View style={[styles.circle, { backgroundColor: withAlpha(color, 0.15) }]}>
          <Text style={styles.circleEmoji}>{emoji}</Text>
        </View>

        <Text style={styles.nickname}>{persona.nickname}</Text>
        <View style={[styles.titlePill, { backgroundColor: color }]}>
          <Text style={[styles.pillText, { color: WHITE }]}>{persona.title}</Text>
        </View>

        <View style={[styles.bubble, { borderColor: color }]}>
          <Text style={styles.bubbleText}>“{persona.catchphrase}”</Text>
        </View>

        <View style={styles.chips}>
          {persona.chips.map((chip) => (
            <View key={chip.label} style={[styles.chip, { backgroundColor: withAlpha(color, 0.15) }]}>
              <Text style={styles.chipText}>
                {chip.emoji} {chip.label}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.line}>
          <Text style={styles.bold}>좋아요  </Text>
          {likes}
        </Text>
        <Text style={styles.line}>
          <Text style={styles.bold}>싫어요  </Text>
          {dislikes}
        </Text>

        <View style={styles.tmiBand}>
          <View style={styles.tmiTag}>
            <Text style={styles.tmiTagText}>???</Text>
          </View>
          <Text style={styles.tmiText}>{persona.tmi}</Text>
        </View>
      </View>

      <Text style={styles.source}>{sourceBadge(persona.source)}</Text>

      {persona.mustKeep.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>꼭 지킬 것</Text>
          {persona.mustKeep.map((item, i) => (
            <Text key={i} style={styles.listItem}>
              • {item.label}
            </Text>
          ))}
        </View>
      )}

      {persona.wishes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>그 밖의 바람</Text>
          {persona.wishes.map((wish, i) => (
            <Text key={i} style={styles.listItem}>
              • {wish}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>성향 자세히 보기</Text>
        {persona.traits.map((trait) => {
          const neutral = trait.level === "neutral";
          const width: `${number}%` = `${Math.round(traitRatio(trait.score) * 100)}%`;
          return (
            <View key={trait.key} style={styles.trait}>
              <Text style={styles.traitName}>
                {trait.name} · {trait.emoji === "" ? "" : `${trait.emoji} `}
                {neutral ? "상관없음" : trait.label}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width, backgroundColor: neutral ? GRAY : color }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    padding: 16,
    borderWidth: 3,
    borderRadius: 20,
    backgroundColor: WHITE,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignSelf: "stretch",
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  circle: {
    marginTop: 16,
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  circleEmoji: {
    fontSize: 64,
  },
  nickname: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: "bold",
    color: colors.text,
  },
  titlePill: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  bubble: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 14,
    alignSelf: "stretch",
  },
  bubbleText: {
    fontSize: 15,
    textAlign: "center",
    color: colors.text,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 12,
  },
  chip: {
    margin: 3,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 13,
    color: colors.text,
  },
  line: {
    marginTop: 8,
    alignSelf: "stretch",
    fontSize: 14,
    color: colors.text,
  },
  bold: {
    fontWeight: "bold",
  },
  tmiBand: {
    marginTop: 14,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    backgroundColor: YELLOW,
  },
  tmiTag: {
    marginRight: 8,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: colors.text,
  },
  tmiTagText: {
    fontSize: 12,
    fontWeight: "bold",
    color: WHITE,
  },
  tmiText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  source: {
    marginTop: 10,
    alignSelf: "center",
    fontSize: 13,
    color: colors.primary,
    fontWeight: "bold",
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    marginBottom: 6,
    fontSize: 16,
    fontWeight: "bold",
    color: colors.text,
  },
  listItem: {
    marginTop: 2,
    fontSize: 14,
    color: colors.text,
  },
  trait: {
    marginTop: 8,
  },
  traitName: {
    fontSize: 14,
    color: colors.text,
  },
  track: {
    marginTop: 4,
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: colors.background,
  },
  fill: {
    height: 10,
    borderRadius: 5,
  },
});
