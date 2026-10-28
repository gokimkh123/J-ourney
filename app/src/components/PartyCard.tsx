import { StyleSheet, View } from "react-native";

import { spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import { AvatarStack } from "./Avatar.tsx";
import Card from "./Card.tsx";
import StatusPill from "./StatusPill.tsx";

export type PartyCardProps = {
  /** 파티 이름. 아직 못 받았으면 null */
  title: string | null;
  inviteCode: string;
  members: { name: string; color: string }[];
  /** 한 줄 상태. 아직 못 받았으면 null */
  status: { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" } | null;
  onPress: () => void;
};

/** 내 파티 목록의 한 칸. 누르면 그 파티로 들어간다. */
export default function PartyCard({ title, inviteCode, members, status, onPress }: PartyCardProps) {
  const styles = useStyles(createStyles);
  return (
    <Card onPress={onPress} accessibilityLabel={`${title ?? "파티"}, ${status?.label ?? "정보를 불러오는 중"}, 초대 코드 ${inviteCode}`}>
      <View style={styles.top}>
        <AppText variant="heading" numberOfLines={1} style={styles.title}>
          {title ?? "불러오는 중"}
        </AppText>
        {status !== null && <StatusPill label={status.label} tone={status.tone} />}
      </View>
      <View style={styles.bottom}>
        {members.length > 0 ? <AvatarStack people={members} size="sm" /> : <View />}
        <AppText variant="caption" tone="muted">
          코드 {inviteCode}
        </AppText>
      </View>
    </Card>
  );
}

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    title: { flex: 1 },
    bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 },
  });
