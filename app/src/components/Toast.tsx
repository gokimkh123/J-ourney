import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toastStore, type Toast } from "../lib/ui/toast.ts";
import { radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

/** 떠 있는 시간 */
const SHOW_MS = 2500;
// 탭바(64) 위에 띄운다. 탭바가 숨은 화면에서도 같은 높이라 아래 버튼을 가리지 않는다.
const ABOVE_TAB_BAR = 64 + spacing.md;

/**
 * 앱 맨 바깥(_layout)에 하나만 둔다. showToast()로 띄운 글을 화면 아래 알약으로 잠깐 보여 주고 화면 읽기에도 읽어 준다.
 * 손가락을 막지 않고(pointerEvents none), 새 글이 오면 그 글로 바꿔 다시 시간을 잰다.
 */
export default function ToastHost() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const toast = useSyncExternalStore(toastStore.subscribe, toastStore.get, toastStore.get);
  const [shown, setShown] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  // 다시 그려져도(붙었다 떨어져도) 이미 보여 준 알림은 다시 띄우지 않는다.
  const seen = useRef(toast?.id ?? 0);

  useEffect(() => {
    if (toast === null || toast.id <= seen.current) return;
    seen.current = toast.id;
    setShown(toast);
    AccessibilityInfo.announceForAccessibility(toast.text);
    const fade = (to: number, done?: () => void) => {
      if (reduceMotion) {
        opacity.setValue(to);
        done?.();
        return;
      }
      Animated.timing(opacity, { toValue: to, duration: to === 1 ? 160 : 220, useNativeDriver: true }).start(({ finished }) => {
        if (finished) done?.();
      });
    };
    fade(1);
    const timer = setTimeout(() => fade(0, () => setShown((now) => (now?.id === toast.id ? null : now))), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast, opacity, reduceMotion]);

  if (shown === null) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + ABOVE_TAB_BAR, opacity }]}>
      <View style={[styles.pill, { backgroundColor: colors.text }]}>
        <AppText variant="smallStrong" color={colors.background} align="center">
          {shown.text}
        </AppText>
      </View>
    </Animated.View>
  );
}

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    wrap: { position: "absolute", left: spacing.md, right: spacing.md, alignItems: "center" },
    pill: { maxWidth: 360, paddingVertical: spacing.sm + spacing.xxs, paddingHorizontal: spacing.md, borderRadius: radius.full },
  });
