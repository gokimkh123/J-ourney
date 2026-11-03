import { useFocusEffect } from "expo-router";
import { useCallback, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { easing } from "../theme/index.ts";

/** 탭을 열 때의 첫 밝기. 0이 아니어서 밝아지기가 늦게 시작해도 화면이 비어 보이지 않는다(11/3: 투명에서 시작해 내 캐릭터가 비어 보임). */
const START_OPACITY = 0.35;
const FADE_MS = 180;
const fadeEasing = Easing.bezier(easing.standard[0], easing.standard[1], easing.standard[2], easing.standard[3]);

/**
 * 탭을 열면 화면이 살짝 흐렸다가 밝아진다(11/3 결정: 탭 페이드). 탭 내비게이터의 애니메이션은 끄고(켜면 안 보이는 탭이
 * 폰 화면에 붙은 채로 남아 끊김) 여기서 직접 한다. 떠날 때 미리 흐리게 돌려 두어(그때는 이미 떼어져 안 보임) 다시 열 때 번쩍이지 않는다.
 * fill이면 화면 전체를 채운다(내용). 위쪽 줄은 fill 없이 감싼다. 동작 줄이기를 켠 사람은 바로 보인다.
 */
export default function TabFade({ fill = false, children }: { fill?: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const opacity = useSharedValue(reduce ? 1 : START_OPACITY);

  useFocusEffect(
    useCallback(() => {
      if (reduce) {
        opacity.value = 1;
        return;
      }
      opacity.value = withTiming(1, { duration: FADE_MS, easing: fadeEasing });
      return () => {
        cancelAnimation(opacity);
        opacity.value = START_OPACITY;
      };
    }, [reduce, opacity]),
  );

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[fill && styles.fill, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
