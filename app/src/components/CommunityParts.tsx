import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";

import type { CommunityPlace } from "../lib/community/community.ts";
import { radius, useTheme } from "../theme/index.ts";
import PlaceholderArt from "./PlaceholderArt.tsx";

/**
 * 관광공사 사진, 없으면 범용 자리 그림(PlaceholderArt: 한 색 바탕 + 첫 화면 캐릭터, 11/4). 사진이 있으면 출처를 붙이는 건 부모가 맡는다.
 * 예전에는 묶음(음식·자연…)마다 다른 색에 사진 아이콘을 두었다.
 */
export function PlacePhoto({ place, width, height, rounded }: { place: CommunityPlace; width: number | "100%"; height: number; rounded: boolean }) {
  const { colors } = useTheme();
  const box = { width, height, borderRadius: rounded ? radius.lg : 0, overflow: "hidden" as const };
  if (place.imageUrl !== null) {
    // 사진을 받는 동안에도 자리 그림과 같은 한 색 바탕
    return <Image source={{ uri: place.imageUrl }} style={{ ...box, backgroundColor: colors.mapLand }} contentFit="cover" accessible accessibilityLabel={`${place.name} 사진`} />;
  }
  return <PlaceholderArt height={height} style={box} />;
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

