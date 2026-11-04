import { View, type StyleProp, type ViewStyle } from "react-native";

import { memberColors, outline, pastel, useTheme } from "../theme/index.ts";
import { CharacterSvg, VIEWBOX_FULL } from "./character/Bean.tsx";
import { selectProps } from "./character/props.ts";

// 첫 화면(LoginScreen) 네 캐릭터 중 둘째: 활기형·탐험형이라 헤드폰을 쓰고 나침반을 든다. 가 볼 곳을 찾는 느낌.
const COLOR = memberColors[1]!;
const PROPS = selectProps([{ label: "활기형" }, { label: "탐험형" }]);
const [, , VIEW_W, VIEW_H] = VIEWBOX_FULL.split(" ").map(Number) as [number, number, number, number];

/**
 * 사진이나 그림이 없는 자리에 두는 범용 그림(11/4): 한 색 바탕(캐릭터가 서는 무대색) 가운데에 첫 화면 캐릭터 하나가 선다.
 * 장소 종류와 상관없이 같은 그림이라 어디에나 쓸 수 있다. 장식이라 화면 읽기에서는 건너뛴다.
 */
export default function PlaceholderArt({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const figureH = Math.round(Math.min(height * 0.72, 150));
  return (
    <View
      style={[{ height, backgroundColor: colors.mapLand, alignItems: "center", justifyContent: "flex-end", paddingBottom: Math.round(height * 0.06) }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <CharacterSvg width={Math.round((figureH * VIEW_W) / VIEW_H)} height={figureH} body={pastel(COLOR)} line={outline(COLOR)} props={PROPS} />
    </View>
  );
}
