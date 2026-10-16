import { View } from "react-native";

import { backdrop, outline, pastel, radius, useTheme } from "../../theme/index.ts";
import type { AvatarChip } from "../Avatar.tsx";
import { CharacterSvg, FULL_ASPECT, VIEWBOX_FACE } from "./Bean.tsx";
import { selectProps } from "./props.ts";

export type AvatarArtProps = {
  /** 구성원 색(서버가 주는 진한 색). 몸통은 파스텔, 외곽선은 outline으로 바꿔 쓴다. */
  color: string;
  chips: AvatarChip[];
  variant: "face" | "full";
  /** face: 원의 지름, full: 그림 높이 */
  px: number;
  /** full에서 말하는 중이면 입을 벌린다. */
  open?: boolean;
};

/**
 * 캐릭터 그림이 실제로 그려지는 한 곳. 최종 그림(PNG 등)으로 바꿀 때는 이 파일 안쪽만 바꾼다.
 * 바깥(Avatar.tsx)은 테두리·접근성·크기만 맡는다.
 */
export default function AvatarArt({ color, chips, variant, px, open = false }: AvatarArtProps) {
  const { scheme } = useTheme();
  const body = pastel(color);
  const line = outline(color);
  const props = selectProps(chips);

  if (variant === "full") {
    return (
      <CharacterSvg width={Math.round(px * FULL_ASPECT)} height={px} body={body} line={line} props={props} open={open} />
    );
  }

  return (
    <View style={{ width: px, height: px, borderRadius: radius.full, overflow: "hidden", backgroundColor: backdrop(color, scheme) }}>
      <CharacterSvg width={px} height={px} viewBox={VIEWBOX_FACE} body={body} line={line} props={props} parts="head" />
    </View>
  );
}
