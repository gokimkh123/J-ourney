import { StyleSheet, View } from "react-native";

import { spacing, useTheme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { type AvatarChip } from "./Avatar.tsx";

export type SpeechRowProps = {
  name: string;
  color: string;
  chips?: AvatarChip[];
  text: string;
  /** 이름 옆 보조 글자(예: "2라운드", "18:02") */
  meta?: string;
  /** 놓인 바탕색(아바타 테두리용) */
  surface?: "surface" | "raised";
};

/** 누가 무슨 말을 했는지 한 덩어리: AI 발언(B2), 장소를 고른 이유(C2) */
export default function SpeechRow({ name, color, chips, text, meta, surface = "surface" }: SpeechRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Avatar
        color={color}
        name={name}
        chips={chips}
        size="sm"
        separatorColor={surface === "raised" ? colors.surfaceRaised : colors.surface}
      />
      <View style={styles.body}>
        <View style={styles.head}>
          <AppText variant="smallStrong">{name}</AppText>
          {meta !== undefined && (
            <AppText variant="caption" tone="muted">
              {meta}
            </AppText>
          )}
        </View>
        <AppText variant="small">{text}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
});
