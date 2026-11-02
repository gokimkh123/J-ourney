import { StyleSheet, View } from "react-native";

import { radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { type AvatarChip } from "./Avatar.tsx";

const FACE = 28;
/** 말풍선 반대쪽에 비워 두는 폭(누가 말했는지 한눈에 갈리게) */
const OTHER_SIDE = 48;

export type ChatBubbleProps = {
  /** 이 폰 주인의 AI 말이면 오른쪽 */
  mine: boolean;
  text: string;
  /** 이어 말한 묶음의 첫 말에만(다른 AI만) */
  name?: string | null;
  /** 묶음의 마지막 말에만 얼굴. null이면 얼굴 자리만 비운다 */
  face?: { name: string; color: string; chips?: AvatarChip[] } | null;
};

/** 회의 대화 한 말(채팅 모양): 내 AI는 오른쪽 연한 메인 색, 다른 AI는 왼쪽 + 이름. 얼굴은 캐릭터 그림. */
export default function ChatBubble({ mine, text, name = null, face = null }: ChatBubbleProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const faceView =
    face === null ? (
      <View style={styles.faceSpace} />
    ) : (
      <Avatar color={face.color} name={face.name} chips={face.chips} diameter={FACE} separatorColor={colors.surface} />
    );
  return (
    <View
      style={[styles.row, mine ? styles.rowMine : styles.rowOther]}
      accessible
      accessibilityLabel={`${mine ? "내 AI" : (face?.name ?? name ?? "AI")}: ${text}`}
    >
      {!mine && faceView}
      <View style={[styles.stack, mine && styles.stackMine]}>
        {!mine && name !== null && (
          <AppText variant="caption" tone="muted" style={styles.name}>
            {name} AI
          </AppText>
        )}
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          <AppText variant="small" style={styles.text}>
            {text}
          </AppText>
        </View>
      </View>
      {mine && faceView}
    </View>
  );
}

/** 대화 사이 라운드 구분 알약("1라운드", "조사 중") */
export function ChatDivider({ label }: { label: string }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.divider} accessibilityRole="header">
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    rowMine: { justifyContent: "flex-end", paddingLeft: OTHER_SIDE },
    rowOther: { justifyContent: "flex-start", paddingRight: OTHER_SIDE },
    stack: { flexShrink: 1, minWidth: 0, gap: spacing.xxs, alignItems: "flex-start" },
    stackMine: { alignItems: "flex-end" },
    name: { paddingHorizontal: spacing.xs, color: t.colors.textBody },
    // 꼬리 쪽(얼굴 쪽 아래) 모서리만 작게
    bubble: { borderRadius: radius.lg + 2, paddingHorizontal: spacing.sm + spacing.xs, paddingVertical: spacing.sm, maxWidth: "100%" },
    bubbleMine: { backgroundColor: t.colors.accentSoft, borderBottomRightRadius: spacing.xs + spacing.xxs },
    bubbleOther: { backgroundColor: t.colors.surfaceRaised, borderBottomLeftRadius: spacing.xs + spacing.xxs },
    text: { color: t.colors.text },
    faceSpace: { width: FACE },
    divider: {
      alignSelf: "center",
      paddingHorizontal: spacing.sm + spacing.xxs,
      paddingVertical: spacing.xxs + 1,
      borderRadius: radius.full,
      backgroundColor: t.colors.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      marginVertical: spacing.xs,
    },
  });
