import { Pressable, StyleSheet, View } from "react-native";

import { pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import PartyStage, { type PartyStageMember } from "./PartyStage.tsx";
import StatusPill from "./StatusPill.tsx";

export type PartyCardProps = {
  /** 파티 이름. 아직 못 받았으면 null */
  title: string | null;
  inviteCode: string;
  /** 같이 가는 사람. 성향 검사를 안 한 사람은 무대에 점선 빈자리로 선다. */
  members: PartyStageMember[];
  /** 한 줄 상태. 아직 못 받았으면 null */
  status: { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" } | null;
  onPress: () => void;
};

/** 내 파티 목록의 한 칸: 위에는 같이 가는 사람들이 선 무대, 아래에는 이름과 상태. 누르면 그 파티로 들어간다. */
export default function PartyCard({ title, inviteCode, members, status, onPress }: PartyCardProps) {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title ?? "파티"}, ${status?.label ?? "정보를 불러오는 중"}, ${members.length}명, 초대 코드 ${inviteCode}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: pressedOpacity }]}
    >
      <PartyStage members={members} height={100} figure={73} />
      <View style={styles.meta}>
        <AppText variant="heading" numberOfLines={1} style={styles.title}>
          {title ?? "불러오는 중"}
        </AppText>
        {status !== null && <StatusPill label={status.label} tone={status.tone} />}
      </View>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      overflow: "hidden",
    },
    meta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm + spacing.xs,
      paddingBottom: 14,
    },
    title: { flex: 1 },
  });
