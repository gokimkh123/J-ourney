import { StyleSheet, View } from "react-native";

import { radius, spacing, useStyles, useTheme, type Theme, type Tone } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { type AvatarChip } from "./Avatar.tsx";

export type AgentStatusRowProps = {
  name: string;
  color: string;
  chips?: AvatarChip[];
  /** 진행 문구(예: "광안리 쪽으로 가는 중", "후보 3곳 골랐어요") */
  text: string;
  /** 오른쪽 상태 라벨(예: "조사 중", "완료") */
  statusLabel: string;
  statusTone?: Tone;
  /** 지금 말하고 있는 AI면 아바타 테두리를 강조 */
  active?: boolean;
};

/** B2 아래쪽 시트의 AI 한 줄: 아바타 · 이름 · 진행 문구 · 상태 라벨 */
export default function AgentStatusRow({
  name,
  color,
  chips,
  text,
  statusLabel,
  statusTone = "accent",
  active = false,
}: AgentStatusRowProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${name} AI, ${text}, ${statusLabel}`}
    >
      <Avatar color={color} name={name} chips={chips} size="sm" active={active} separatorColor={colors.surfaceRaised} />
      <View style={styles.body}>
        <AppText variant="smallStrong" numberOfLines={1}>
          {name} AI
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {text}
        </AppText>
      </View>
      <AppText variant="label" tone={statusTone === "neutral" ? "muted" : statusTone} numberOfLines={1}>
        {statusLabel}
      </AppText>
    </View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + spacing.xxs,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.xs + spacing.xxs,
    paddingLeft: spacing.xs + spacing.xxs,
    paddingRight: spacing.sm + spacing.xs,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
});
