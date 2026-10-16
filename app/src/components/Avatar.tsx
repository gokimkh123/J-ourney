import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type AvatarChip = { label: string; emoji: string };

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const PX: Record<AvatarSize, number> = { xs: 20, sm: 28, md: 36, lg: 56, xl: 120 };

export type AvatarProps = {
  /** 구성원 색 */
  color: string;
  /** 성향 칩. 지금은 큰 크기에서 첫 칩 이모지만 쓰고, 캐릭터 그림이 나오면 소품을 고르는 데 쓴다. */
  chips?: AvatarChip[];
  size?: AvatarSize;
  /** 임시 아바타의 글자(첫 글자만 쓴다)와 읽어 주기용 이름 */
  name?: string;
  /** 지도 위에서 "지금 말하는 중" 등 강조 테두리 */
  active?: boolean;
  /** 겹쳐 놓을 때 사이를 가르는 테두리 색(놓인 바탕색). 기본은 패널 색. */
  separatorColor?: string;
};

/**
 * 캐릭터 그림이 들어갈 자리. 그림 교체는 이 함수 안쪽만 바꾼다.
 * 제안 자산: 투명 배경 정사각형 PNG 512x512 → expo-image의 <Image source=... style={{width: px, height: px}} />
 */
function AvatarArt({ color, chips, px, name }: { color: string; chips: AvatarChip[]; px: number; name?: string }) {
  const initial = name !== undefined && name.length > 0 ? Array.from(name)[0] : "?";
  const showBadge = px >= PX.lg && chips.length > 0;
  return (
    <View style={[styles.circle, { width: px, height: px, backgroundColor: color }]}>
      <AppText
        tone="onColor"
        style={{ fontSize: Math.round(px * 0.42), lineHeight: Math.round(px * 0.5), fontWeight: "700" }}
      >
        {initial}
      </AppText>
      {showBadge && (
        <View
          style={[
            styles.badge,
            { width: px * 0.36, height: px * 0.36, right: -px * 0.02, bottom: -px * 0.02 },
          ]}
        >
          <AppText style={{ fontSize: Math.round(px * 0.2), lineHeight: Math.round(px * 0.26) }}>{chips[0].emoji}</AppText>
        </View>
      )}
    </View>
  );
}

/** 카드·지도·시트·투표 화면은 모두 이 컴포넌트만 부른다. */
export default function Avatar({
  color,
  chips = [],
  size = "md",
  name,
  active = false,
  separatorColor = colors.surface,
}: AvatarProps) {
  const px = PX[size];
  const ring = size === "xs" || size === "sm" ? 2 : 3;
  return (
    <View
      accessible={name !== undefined}
      accessibilityLabel={name}
      style={[
        {
          // 크기를 정해 두어 세로 배치에서 늘어나지 않고, 부모의 정렬(가운데 등)을 그대로 따른다.
          width: px + ring * 2,
          height: px + ring * 2,
          padding: ring,
          borderRadius: radius.full,
          backgroundColor: active ? colors.accent : separatorColor,
        },
      ]}
    >
      <AvatarArt color={color} chips={chips} px={px} name={name} />
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

/** 겹쳐 놓은 아바타 묶음. "이 장소는 누구를 위한 곳인지" 같은 곳에 쓴다. */
export function AvatarStack({ people, size = "sm", max = 4, separatorColor = colors.surface }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const px = PX[size];
  return (
    <View
      style={styles.stack}
      accessible
      accessibilityLabel={people.map((p) => p.name).join(", ")}
    >
      {shown.map((p, i) => (
        <View key={`${p.name}-${i}`} style={i > 0 ? { marginLeft: -px * 0.3 } : undefined}>
          <Avatar color={p.color} name={p.name} chips={p.chips} size={size} separatorColor={separatorColor} />
        </View>
      ))}
      {rest > 0 && (
        <View style={[styles.more, { marginLeft: -px * 0.3, borderColor: separatorColor, height: px + 4, minWidth: px + 4 }]}>
          <AppText variant="label" tone="muted">
            +{rest}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stack: {
    flexDirection: "row",
    alignItems: "center",
  },
  more: {
    borderRadius: radius.full,
    borderWidth: 2,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
});
