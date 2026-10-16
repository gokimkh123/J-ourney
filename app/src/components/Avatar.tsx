import { StyleSheet, View } from "react-native";

import { radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import AvatarArt from "./character/AvatarArt.tsx";
import { FULL_ASPECT } from "./character/Bean.tsx";

export type AvatarChip = { label: string; emoji: string };

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

/** 'face' 원의 지름 */
const FACE_PX: Record<AvatarSize, number> = { xs: 20, sm: 28, md: 36, lg: 56, xl: 120 };
/** 'full' 전신의 높이 (지도 위 sm≈50, 캐릭터 카드 xl≈140) */
const FULL_PX: Record<AvatarSize, number> = { xs: 32, sm: 50, md: 64, lg: 96, xl: 140 };

/** 말하는 중인 전신 캐릭터는 이만큼 커진다. */
const ACTIVE_SCALE = 1.25;

export type AvatarProps = {
  /** 구성원 색(서버가 주는 진한 색). 그림에서는 파스텔로 바뀐다. */
  color: string;
  /** 성향 칩(강한 순서). 자리마다 가장 강한 칩 하나가 소품이 된다. */
  chips?: AvatarChip[];
  size?: AvatarSize;
  /** 읽어 주기용 이름 */
  name?: string;
  /** face: 테두리 강조 / full: 1.25배로 커지고 입을 벌림(말하는 중) */
  active?: boolean;
  /** face: 얼굴만 둥글게(목록·시트·투표) / full: 전신(지도 위·말할 때·캐릭터 카드) */
  variant?: "face" | "full";
  /** full에서 size 대신 쓰는 그림 높이 */
  height?: number;
  /** face를 겹쳐 놓을 때 사이를 가르는 테두리 색(놓인 바탕색). 기본은 패널 색. */
  separatorColor?: string;
};

/** 전신 아바타의 차지하는 크기. 지도처럼 위치를 계산하는 곳에서 쓴다. */
export function fullAvatarSize(size: AvatarSize = "sm", height?: number): { width: number; height: number } {
  const h = height ?? FULL_PX[size];
  return { width: Math.round(h * FULL_ASPECT), height: h };
}

/** 카드·지도·시트·투표 화면은 모두 이 컴포넌트만 부른다. */
export default function Avatar({
  color,
  chips = [],
  size = "md",
  name,
  active = false,
  variant = "face",
  height,
  separatorColor,
}: AvatarProps) {
  const { colors } = useTheme();

  if (variant === "full") {
    const box = fullAvatarSize(size, height);
    return (
      <View
        accessible={name !== undefined}
        accessibilityLabel={name}
        style={{
          width: box.width,
          height: box.height,
          // 커져도 발이 제자리에 있도록 아래 가운데를 기준으로 키운다.
          transform: active ? [{ scale: ACTIVE_SCALE }] : undefined,
          transformOrigin: "50% 100%",
        }}
      >
        <AvatarArt color={color} chips={chips} variant="full" px={box.height} open={active} />
      </View>
    );
  }

  const px = FACE_PX[size];
  const ring = size === "xs" || size === "sm" ? 2 : 3;
  return (
    <View
      accessible={name !== undefined}
      accessibilityLabel={name}
      style={{
        // 크기를 정해 두어 세로 배치에서 늘어나지 않고, 부모의 정렬(가운데 등)을 그대로 따른다.
        width: px + ring * 2,
        height: px + ring * 2,
        padding: ring,
        borderRadius: radius.full,
        backgroundColor: active ? colors.accent : (separatorColor ?? colors.surface),
      }}
    >
      <AvatarArt color={color} chips={chips} variant="face" px={px} />
    </View>
  );
}

export type AvatarStackProps = {
  people: { color: string; name: string; chips?: AvatarChip[] }[];
  size?: Extract<AvatarSize, "xs" | "sm" | "md">;
  /** 이 수를 넘으면 "+n"으로 줄인다. */
  max?: number;
  separatorColor?: string;
};

/** 겹쳐 놓은 얼굴 아바타 묶음. "이 장소는 누구를 위한 곳인지" 같은 곳에 쓴다. */
export function AvatarStack({ people, size = "sm", max = 4, separatorColor }: AvatarStackProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const ring = separatorColor ?? colors.surface;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const px = FACE_PX[size];
  return (
    <View style={styles.stack} accessible accessibilityLabel={people.map((p) => p.name).join(", ")}>
      {shown.map((p, i) => (
        <View key={`${p.name}-${i}`} style={i > 0 ? { marginLeft: -px * 0.3 } : undefined}>
          <Avatar color={p.color} name={p.name} chips={p.chips} size={size} separatorColor={ring} />
        </View>
      ))}
      {rest > 0 && (
        <View style={[styles.more, { marginLeft: -px * 0.3, borderColor: ring, height: px + 4, minWidth: px + 4 }]}>
          <AppText variant="label" tone="muted">
            +{rest}
          </AppText>
        </View>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    stack: {
      flexDirection: "row",
      alignItems: "center",
    },
    more: {
      borderRadius: radius.full,
      borderWidth: 2,
      backgroundColor: t.colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xs,
    },
  });
