import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type FormSheetProps = {
  visible: boolean;
  title: string;
  /** 바깥(어두운 곳)을 누르거나 폰의 뒤로 가기를 누를 때. 보내는 중이면 부모가 막는다. */
  onClose: () => void;
  children: ReactNode;
};

/** 화면 아래에서 올라오는 입력 시트(코드로 참여, 새 파티). 위 모서리가 둥글고 뒤는 어둡게 가린다. */
export default function FormSheet({ visible, title, onClose, children }: FormSheetProps) {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <AppText variant="title" accessibilityRole="header">
              {title}
            </AppText>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.colors.scrim },
    sheet: {
      maxHeight: "90%",
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.border, alignSelf: "center", marginBottom: spacing.sm },
    content: { gap: spacing.md },
  });
