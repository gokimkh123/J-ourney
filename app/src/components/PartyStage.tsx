import { StyleSheet, View } from "react-native";

import Svg, { Ellipse } from "react-native-svg";

import { useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import type { AvatarChip } from "./Avatar.tsx";
import AvatarArt from "./character/AvatarArt.tsx";

export type PartyStageMember = {
  name: string;
  color: string;
  /** 성향 검사를 마쳐 캐릭터가 있으면 true. 아니면 점선 빈자리("?")로 선다. */
  ready: boolean;
  /** 캐릭터 소품을 정할 성향 칩(없으면 소품 없이 선다) */
  chips?: AvatarChip[];
};

export type PartyStageProps = {
  members: PartyStageMember[];
  /** 끝에 내 자리(점선 "나")를 하나 더 둔다. 초대 코드로 참여하기 전 미리 보기용 */
  meSeat?: boolean;
  /** 무대 높이 */
  height: number;
  /** 캐릭터 그림 높이 */
  figure: number;
  /** true면 가운데, false면 왼쪽부터 세운다. */
  centered?: boolean;
};

/** 연노랑 무대 위에 같이 가는 사람들이 서 있는 그림. 그림이라 읽어 주기는 부모가 맡는다. */
export default function PartyStage({ members, meSeat = false, height, figure, centered = false }: PartyStageProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const seatW = Math.round(figure * 0.68);
  const seatH = Math.round(figure * 0.9);
  // 빈자리는 캐릭터처럼 위가 둥근 모양(위 모서리 = 폭의 절반)
  const seatSize = { width: seatW, height: seatH, borderTopLeftRadius: seatW / 2, borderTopRightRadius: seatW / 2 };
  return (
    <View style={[styles.stage, { height }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* 바닥 타원: 무대보다 넓고 아래로 넘쳐서 위쪽 둥근 선만 보인다. 늘여 그려도 타원이라 너비를 몰라도 된다. */}
      <Svg style={styles.fill} width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <Ellipse cx={50} cy={height + 10} rx={62} ry={60} fill={colors.stageFloor} />
      </Svg>
      <View style={[styles.cast, centered ? styles.castCentered : styles.castLeft]}>
        {members.map((m, i) =>
          m.ready ? (
            <AvatarArt key={`${m.name}-${i}`} color={m.color} chips={m.chips ?? []} variant="full" px={figure} />
          ) : (
            <View key={`${m.name}-${i}`} style={[styles.seat, seatSize]}>
              <AppText variant="heading" tone="muted">
                ?
              </AppText>
            </View>
          ),
        )}
        {meSeat && (
          <View style={[styles.seat, styles.meSeat, seatSize]}>
            <AppText variant="smallStrong">나</AppText>
          </View>
        )}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    stage: { overflow: "hidden", backgroundColor: t.colors.mapLand },
    fill: { position: "absolute", top: 0, left: 0 },
    cast: { position: "absolute", bottom: 10, flexDirection: "row", alignItems: "flex-end", gap: 6 },
    castLeft: { left: 20 },
    castCentered: { left: 0, right: 0, justifyContent: "center", gap: 10 },
    seat: {
      marginBottom: 4,
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: t.colors.iconFaint,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    meSeat: { borderColor: t.colors.accent, backgroundColor: t.colors.surface },
  });
