import { Pressable, StyleSheet, View } from "react-native";

import { colors, pressedOpacity, radius, spacing, type Tone } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar from "./Avatar.tsx";
import StatusPill from "./StatusPill.tsx";

export type ReactionKind = "like" | "warn" | "block";

export type CandidateReaction = {
  name: string;
  color: string;
  kind: ReactionKind;
  /** 왜 그렇게 반응했는지. 행을 펼치거나 눌렀을 때 화면이 보여 준다. */
  reason?: string;
};

const REACTION: Record<ReactionKind, { label: string; tone: Tone }> = {
  like: { label: "좋아요", tone: "success" },
  warn: { label: "조심", tone: "warning" },
  block: { label: "반대", tone: "danger" },
};

export type CandidateRowProps = {
  name: string;
  /** 처음 제안한 구성원 색(지도 핀과 같은 색) */
  proposerColor: string;
  /** 일정 순서 번호가 정해졌으면 표시 */
  order?: number;
  reactions: CandidateReaction[];
  /** 반응 이유를 펼쳐 보여 줄지 */
  expanded?: boolean;
  onPress?: () => void;
};

/** B2 후보 보드 한 줄: 장소 이름 + AI별 반응 라벨 */
export default function CandidateRow({ name, proposerColor, order, reactions, expanded = false, onPress }: CandidateRowProps) {
  const content = (
    <>
      <View style={styles.top}>
        <View style={[styles.marker, { backgroundColor: proposerColor }]}>
          {order !== undefined && (
            <AppText variant="label" tone="onColor">
              {order}
            </AppText>
          )}
        </View>
        <AppText variant="smallStrong" style={styles.name} numberOfLines={1}>
          {name}
        </AppText>
        <View style={styles.tags}>
          {reactions.map((r, i) => (
            <StatusPill
              key={`${r.name}-${i}`}
              label={`${r.name} ${REACTION[r.kind].label}`}
              tone={REACTION[r.kind].tone}
              leading={<Avatar color={r.color} name={r.name} size="xs" separatorColor={colors.surfaceSunken} />}
            />
          ))}
        </View>
      </View>
      {expanded &&
        reactions
          .filter((r) => r.reason !== undefined && r.reason !== "")
          .map((r, i) => (
            <AppText key={`reason-${i}`} variant="caption" tone="muted" style={styles.reason}>
              {r.name}: {r.reason}
            </AppText>
          ))}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + spacing.xxs,
    gap: spacing.xs,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.xs,
    flexShrink: 1,
  },
  reason: {
    paddingLeft: 20 + spacing.sm,
  },
});
