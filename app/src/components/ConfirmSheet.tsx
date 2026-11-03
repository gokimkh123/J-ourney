import { StyleSheet, View } from "react-native";

import { spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Banner from "./Banner.tsx";
import Button from "./Button.tsx";
import FormSheet from "./FormSheet.tsx";

export type ConfirmSheetProps = {
  visible: boolean;
  /** "'부산 1박 2일'을 없앨까요?" */
  title: string;
  message: string;
  /** "없애기", "나가기", "진행하기" */
  confirmLabel: string;
  cancelLabel?: string;
  /** 되돌릴 수 없는 동작이면 빨간 버튼 */
  danger?: boolean;
  /** 서버가 답할 때까지: 확인 버튼에 도는 표시, 닫기·취소는 막는다 */
  busy?: boolean;
  /** 실패하면 시트 안에 보여 줄 안내 */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 시스템 확인 창(Alert) 대신 쓰는 앱 모양 확인 시트(11/3). 아래에서 올라오고 [취소][확인] 두 버튼이 있다.
 * 보내는 동안은 시트를 열어 둔 채 확인 버튼만 돌고, 실패하면 안내를 시트 안에 띄운다.
 */
export default function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = "취소",
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const close = () => {
    if (!busy) onCancel();
  };
  return (
    <FormSheet visible={visible} title={title} onClose={close}>
      <View style={styles.body}>
        <AppText variant="body" color={colors.textBody}>
          {message}
        </AppText>
        {error !== null && <Banner tone="danger" text={error} />}
        <View style={styles.buttons}>
          <Button label={cancelLabel} variant="secondary" size="lg" onPress={close} disabled={busy} style={styles.button} />
          <Button label={confirmLabel} variant={danger ? "danger" : "primary"} size="lg" onPress={onConfirm} loading={busy} style={styles.button} />
        </View>
      </View>
    </FormSheet>
  );
}

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    body: { gap: spacing.md },
    buttons: { flexDirection: "row", gap: spacing.sm },
    button: { flex: 1, alignSelf: "stretch" },
  });
