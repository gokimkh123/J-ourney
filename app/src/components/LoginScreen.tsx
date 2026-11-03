import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { memberColors, outline, pastel, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Banner from "./Banner.tsx";
import Wordmark from "./Wordmark.tsx";
import { CharacterSvg } from "./character/Bean.tsx";
import { selectProps } from "./character/props.ts";

export type LoginScreenProps = {
  /** 카카오로 시작하기. 실패 문장을 돌려주면 버튼 위에 보이고, null이면 아무것도 안 보인다(성공·취소). */
  onKakao: () => Promise<string | null>;
  /** 네이버·Google: 지금은 로그인 없이 다음 화면으로 */
  onSkip: () => void;
};

// 캔버스 '로그인' 판 크기(390×844 기준)
const SHEET_H = 288;
const FIG_W = 76;
const FIG_H = 99;
const FIG_GAP = 10;
/** 캐릭터가 흰 판 뒤로 숨는 높이(얼굴만 내민다) */
const PEEK = 37;
const KAKAO_YELLOW = "#FEE500";
const KAKAO_LABEL = "rgba(0,0,0,0.85)";
const NAVER_GREEN = "#03C75A";
// 같이 가는 네 명: 시연 친구들과 같은 성향 칩으로 소품을 단다.
const CAST = [
  { color: memberColors[0]!, chips: ["계획형", "부지런형"] },
  { color: memberColors[1]!, chips: ["활기형", "탐험형"] },
  { color: memberColors[2]!, chips: ["계획형", "절약형"] },
  { color: memberColors[3]!, chips: ["느긋형", "한적형", "늦잠형"] },
].map((c) => ({ color: c.color, props: selectProps(c.chips.map((label) => ({ label }))) }));
const CAST_W = CAST.length * FIG_W + (CAST.length - 1) * FIG_GAP;
/** 말풍선 꼬리가 가리키는 사람(두 번째, 지은) */
const SPEAKER = 1;
const TAIL_X = 40;

/** 로그인 화면: 메인 색 바탕에 앱 이름, 흰 판 위로 얼굴을 내민 네 명, 카카오 큰 버튼과 네이버·Google 동그란 버튼. */
export default function LoginScreen({ onKakao, onSkip }: LoginScreenProps) {
  const styles = useStyles(createStyles);
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kakao = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await onKakao());
    } finally {
      setBusy(false);
    }
  };

  const speakerX = SPEAKER * (FIG_W + FIG_GAP) + FIG_W / 2;
  const googleDark = scheme === "dark";

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <Wordmark width={250} color={colors.onHero} />
      </View>

      <View style={styles.castRow} accessible accessibilityRole="image" accessibilityLabel="캐릭터 네 명이 흰 판 위로 얼굴을 내밀고 있어요">
        <View style={{ width: CAST_W, height: FIG_H }}>
          <View style={[styles.bubble, { left: speakerX - TAIL_X - 6 }]}>
            <AppText variant="bodyStrong" color={colors.text}>
              같이 회의하러 가요!
            </AppText>
            <View style={[styles.tail, { left: TAIL_X }]} />
          </View>
          <View style={styles.cast}>
            {CAST.map((c, i) => (
              <CharacterSvg key={i} width={FIG_W} height={FIG_H} body={pastel(c.color)} line={outline(c.color)} props={c.props} />
            ))}
          </View>
        </View>
      </View>

      <View style={[styles.sheet, { minHeight: SHEET_H + insets.bottom, paddingBottom: spacing.xl + insets.bottom }]}>
        {error !== null && <Banner tone="danger" text={error} />}
        <Pressable
          onPress={() => void kakao()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="카카오로 시작하기"
          accessibilityState={{ busy, disabled: busy }}
          style={({ pressed }) => [styles.kakao, pressed && { opacity: pressedOpacity }]}
        >
          <View style={styles.kakaoLogo}>
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.88 5.32 4.71 6.73l-1.2 4.38c-.1.38.33.68.66.46l5.2-3.45c.21.02.42.03.63.03 5.52 0 10-3.58 10-8S17.52 3 12 3z" fill="#000000" />
            </Svg>
          </View>
          {busy ? <ActivityIndicator color={KAKAO_LABEL} /> : <AppText variant="button" color={KAKAO_LABEL}>카카오로 시작하기</AppText>}
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.line} />
          <AppText variant="caption" tone="muted">
            다른 계정으로
          </AppText>
          <View style={styles.line} />
        </View>

        <View style={styles.rounds}>
          <Pressable
            onPress={onSkip}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="네이버로 시작하기"
            style={({ pressed }) => [styles.round, { backgroundColor: NAVER_GREEN }, pressed && { opacity: pressedOpacity }]}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d="M16.27 12.84 7.38 0H0v24h7.73V11.16L16.62 24H24V0h-7.73z" fill="#FFFFFF" />
            </Svg>
          </Pressable>
          <Pressable
            onPress={onSkip}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Google로 시작하기"
            style={({ pressed }) => [
              styles.round,
              { backgroundColor: googleDark ? "#131314" : "#FFFFFF", borderWidth: 1, borderColor: googleDark ? "#8E918F" : "#747775" },
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <Svg width={22} height={22} viewBox="0 0 48 48">
              <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </Svg>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.hero },
    top: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: spacing.xl },
    castRow: { alignItems: "center", marginBottom: -PEEK, paddingTop: 64 },
    cast: { flexDirection: "row", gap: FIG_GAP },
    bubble: {
      position: "absolute",
      bottom: FIG_H + 24,
      backgroundColor: t.colors.surface,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      boxShadow: t.elevation.float,
    },
    tail: { position: "absolute", bottom: -5, width: 12, height: 12, backgroundColor: t.colors.surface, transform: [{ rotate: "45deg" }] },
    sheet: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.xl,
      paddingHorizontal: spacing.md,
      gap: spacing.md,
      justifyContent: "flex-end",
      alignItems: "center",
    },
    kakao: {
      alignSelf: "stretch",
      minHeight: 56,
      borderRadius: 14,
      backgroundColor: KAKAO_YELLOW,
      alignItems: "center",
      justifyContent: "center",
    },
    kakaoLogo: { position: "absolute", left: 20, top: 18 },
    divider: { flexDirection: "row", alignItems: "center", gap: spacing.sm + spacing.xs, alignSelf: "stretch" },
    line: { flex: 1, height: 1, backgroundColor: t.colors.border },
    rounds: { flexDirection: "row", gap: spacing.md },
    round: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  });
