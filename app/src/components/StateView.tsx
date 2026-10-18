import { ActivityIndicator, StyleSheet, View } from "react-native";

import { spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";

export type StateViewProps = {
  /** true면 제목 위에 도는 표시를 보여 준다. */
  loading?: boolean;
  title: string;
  text?: string;
  /** 오류일 때 제목을 빨간 글자로 */
  tone?: "default" | "danger";
  actionLabel?: string;
  onAction?: () => void;
  /** 버튼 아래 보조 버튼(예: "홈으로") */
  secondaryLabel?: string;
  onSecondary?: () => void;
};

/** 화면 가운데에 놓는 불러오는 중·오류·비어 있음 안내. 화면마다 따로 만들지 않고 이걸 쓴다. */
export default function StateView({
  loading = false,
  title,
  text,
  tone = "default",
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: StateViewProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole={tone === "danger" ? "alert" : undefined}>
      {loading && <ActivityIndicator color={colors.accent} />}
      <AppText variant="heading" tone={tone === "danger" ? "danger" : "default"} align="center">
        {title}
      </AppText>
      {text !== undefined && (
        <AppText variant="small" tone="muted" align="center">
          {text}
        </AppText>
      )}
      {actionLabel !== undefined && onAction !== undefined && (
        <View style={styles.actions}>
          <Button label={actionLabel} onPress={onAction} />
          {secondaryLabel !== undefined && onSecondary !== undefined && (
            <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" />
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      padding: spacing.lg,
      backgroundColor: t.colors.background,
    },
    actions: { marginTop: spacing.sm, alignItems: "center", gap: spacing.xs },
  });
