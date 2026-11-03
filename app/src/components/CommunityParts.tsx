import { Image } from "expo-image";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { CommunityPlace } from "../lib/community/community.ts";
import { memberColors, pastel, radius, useTheme } from "../theme/index.ts";

/** 묶음마다 사진 자리 색(사진이 없을 때) */
function photoTint(group: string): string {
  const i = group === "음식" ? 0 : group === "자연" ? 3 : group === "문화관광" ? 2 : 1;
  return pastel(memberColors[i]!);
}

/** 관광공사 사진 또는 자리 표시. 사진이 있으면 출처를 붙이는 건 부모가 맡는다. */
export function PlacePhoto({ place, width, height, rounded }: { place: CommunityPlace; width: number | "100%"; height: number; rounded: boolean }) {
  const { colors } = useTheme();
  const box = { width, height, borderRadius: rounded ? radius.lg : 0, overflow: "hidden" as const, backgroundColor: photoTint(place.group) };
  if (place.imageUrl !== null) {
    return <Image source={{ uri: place.imageUrl }} style={box} contentFit="cover" accessible accessibilityLabel={`${place.name} 사진`} />;
  }
  return (
    <View style={[box, { alignItems: "center", justifyContent: "center" }]} accessible={false}>
      <Svg width={28} height={28} viewBox="0 0 24 24" opacity={0.6}>
        <Rect x={3} y={5} width={18} height={14} rx={3} stroke={colors.textMuted} strokeWidth={1.8} fill="none" />
        <Circle cx={9} cy={10} r={1.6} stroke={colors.textMuted} strokeWidth={1.8} fill="none" />
        <Path d="M21 16l-5-5-8 8" stroke={colors.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

/** 별 하나(채움 비율 0~1은 쓰지 않고 채움/빈 별만) */
export function Star({ size, filled }: { size: number; filled: boolean }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
        fill={filled ? colors.star : "none"}
        stroke={filled ? colors.star : colors.iconFaint}
        strokeWidth={filled ? 0 : 1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

