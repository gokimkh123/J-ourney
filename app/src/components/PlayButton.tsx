import { Pressable, StyleSheet } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { hitSize, pressedOpacity, useStyles, useTheme, type Theme } from "../theme/index.ts";

export type PlayButtonProps = {
  /** true면 재생 중(누르면 일시정지 모양을 보여 준다) */
  playing: boolean;
  onPress: () => void;
};

/** 시트 제목 줄에 놓는 동그란 일시정지/계속 버튼. 터치 영역은 48dp. */
export default function PlayButton({ playing, onPress }: PlayButtonProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const label = playing ? "일시정지" : "계속";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, pressed && { opacity: pressedOpacity }]}
    >
      <Svg width={20} height={20} viewBox="0 0 20 20" fill={colors.onAccent}>
        {playing ? (
          <>
            <Rect x={4} y={3} width={4} height={14} rx={1.2} />
            <Rect x={12} y={3} width={4} height={14} rx={1.2} />
          </>
        ) : (
          <Path d="M6 3.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 6 3.2z" transform="translate(-1.5 0)" />
        )}
      </Svg>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    button: {
      width: hitSize,
      height: hitSize,
      borderRadius: hitSize / 2,
      backgroundColor: t.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
  });
