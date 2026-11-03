import { Pressable, StyleSheet, View } from "react-native";

import { pressedOpacity, radius, spacing, useStyles, useTheme, type Theme, type Tone } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import PlaceSticker, { type PlaceKind } from "./PlaceSticker.tsx";
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
  /** 장소 스티커. 있으면 왼쪽에 스티커를 두고 제안자 색은 스티커 모서리의 작은 점으로 보인다(순서 번호는 안 보임) */
  kind?: PlaceKind;
  /** 일정 순서 번호가 정해졌으면 표시 */
  order?: number;
  reactions: CandidateReaction[];
  /** 반응 이유를 펼쳐 보여 줄지 */
  expanded?: boolean;
  onPress?: () => void;
};

/** B2 후보 보드 한 줄: 장소 이름 + AI별 반응 라벨 */
export default function CandidateRow({ name, proposerColor, kind, order, reactions, expanded = false, onPress }: CandidateRowProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const content = (
    <>
      <View style={styles.top}>
        {kind === undefined ? (
          <View style={[styles.marker, { backgroundColor: proposerColor }]}>
            {order !== undefined && (
              <AppText variant="label" color={colors.onMember}>
                {order}
              </AppText>
            )}
          </View>
        ) : (
          <View style={styles.sticker}>
            <PlaceSticker kind={kind} size={32} />
            {/* 제안자 색 점만(11/3: 순서 번호는 빼기) */}
            <View style={[styles.dot, { backgroundColor: proposerColor, borderColor: colors.surfaceRaised }]} />
          </View>
        )}
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
            <AppText key={`reason-${i}`} variant="caption" tone="muted" style={kind === undefined ? styles.reason : styles.reasonSticker}>
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

const createStyles = (t: Theme) => StyleSheet.create({
  row: {
    backgroundColor: t.colors.surfaceRaised,
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
  reasonSticker: {
    paddingLeft: 32 + spacing.sm,
  },
  sticker: {
    width: 32,
    height: 32,
  },
  // 제안자 색 점: 지도 핀과 같은 색, 줄 바탕색 테두리로 스티커와 떼어 보인다.
  dot: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 14,
    height: 14,
    borderRadius: radius.full,
    borderWidth: 2,
  },
});
