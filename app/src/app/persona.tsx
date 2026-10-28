import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Href } from "expo-router";

import { AppText, Avatar, Button, Card, Chip, PartyActions, PersonaCard, ProgressBar, StateView } from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import { ApiError } from "../lib/api/errors.ts";
import { profileChips, profileTraits } from "../lib/persona/profile.ts";
import { useProfile } from "../lib/persona/profileStore.ts";
import type { Persona } from "../lib/persona/types.ts";
import { session } from "../lib/session/index.ts";
import { useSession } from "../lib/session/useSession.ts";
import { memberColors, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import { describeError, traitRatio } from "../lib/ui/format.ts";

const QUESTIONNAIRE_ROUTE = "/questionnaire" as Href;
const RETAKE_ROUTE = "/questionnaire?retake=1" as Href;

type View_ =
  | { kind: "loading" }
  | { kind: "noSession" }
  | { kind: "ready"; persona: Persona }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

/** 탭 하나가 파티 밖(초기 화면)과 파티 안에서 다른 내용을 보여 준다. */
export default function PersonaScreen() {
  return useSession() === null ? <MyProfile /> : <PartyPersona />;
}

/** 초기 화면의 내 캐릭터: 1~12번 성향 검사를 한 번 해 두면 이 폰에 저장되어 모든 파티에서 쓴다. */
function MyProfile() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const { colors } = useTheme();
  const saved = useProfile();
  const traits = profileTraits(saved);
  if (traits === null) {
    return (
      <StateView
        title="내 성향을 알려 주세요"
        text={"12개 질문에 답하면 내 여행 성향이 이 폰에 저장돼요.\n한 번만 해 두면 어떤 파티에서든 다시 묻지 않아요."}
        actionLabel="성향 검사 시작"
        onAction={() => router.navigate(QUESTIONNAIRE_ROUTE)}
      />
    );
  }
  const chips = profileChips(saved);
  const color = memberColors[0];
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
      <Card>
        <View style={styles.hero}>
          <Avatar color={color} chips={chips} name="내 성향" size="xl" variant="full" />
          <AppText variant="heading" align="center">
            내 여행 성향
          </AppText>
          <View style={styles.chips}>
            {chips.map((chip) => (
              <Chip key={chip.label} label={chip.label} emoji={chip.emoji} size="sm" />
            ))}
          </View>
        </View>
      </Card>
      <Card title="성향 자세히 보기">
        <View style={styles.traits}>
          {traits.map((trait) => {
            const neutral = trait.level === "neutral";
            const label = neutral ? "상관없음" : trait.label;
            return (
              <View key={trait.key} style={styles.trait}>
                <View style={styles.traitHead}>
                  <AppText variant="small" tone="muted">
                    {trait.name}
                  </AppText>
                  <AppText variant="smallStrong" tone={neutral ? "muted" : "default"}>
                    {trait.emoji === "" ? "" : `${trait.emoji} `}
                    {label}
                  </AppText>
                </View>
                <ProgressBar
                  value={traitRatio(trait.score)}
                  color={neutral ? colors.border : color}
                  accessibilityLabel={`${trait.name} ${label}`}
                />
              </View>
            );
          })}
        </View>
      </Card>
      <AppText variant="small" tone="muted" align="center">
        캐릭터 이름과 한마디는 파티에 들어가 여행 질문 3개에 답하면 AI가 만들어 줘요.
      </AppText>
      <Button label="12문항 다시 하기" variant="secondary" block onPress={() => router.navigate(QUESTIONNAIRE_ROUTE)} />
    </ScrollView>
  );
}

function PartyPersona() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const saved = useProfile();
  const [view, setView] = useState<View_>({ kind: "loading" });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setView({ kind: "loading" });
    if (session.getSession() === null) {
      setView({ kind: "noSession" });
      return;
    }
    try {
      const persona = await endpoints.getPersona();
      if (id !== requestId.current) return;
      setView({ kind: "ready", persona });
    } catch (error) {
      if (id !== requestId.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setView({ kind: "notFound" });
      } else {
        setView({ kind: "error", message: describeError(error) });
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestId.current++;
      };
    }, [load]),
  );

  if (view.kind === "ready") {
    return (
      <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
        <PartyActions />
        <PersonaCard persona={view.persona} />
        <Button
          label={saved === null ? "다시 검사하기" : "이번 여행 질문 다시 답하기"}
          variant="secondary"
          block
          onPress={() => router.navigate(QUESTIONNAIRE_ROUTE)}
        />
        {saved !== null && (
          <>
            <AppText variant="small" tone="muted" align="center">
              성향 1~12번은 폰에 저장된 답을 써요.
            </AppText>
            <Button label="내 성향(1~12번)부터 다시 하기" variant="ghost" block onPress={() => router.navigate(RETAKE_ROUTE)} />
          </>
        )}
      </ScrollView>
    );
  }
  if (view.kind === "noSession") {
    return (
      <StateView
        title="먼저 여행에 참여해 주세요"
        text="홈에서 여행을 만들거나 초대 코드로 들어오면 내 캐릭터를 만들 수 있어요."
        actionLabel="홈으로 가기"
        onAction={() => router.navigate("/")}
      />
    );
  }
  if (view.kind === "notFound") {
    return (
      <StateView
        title="아직 내 캐릭터가 없어요"
        text={
          saved === null
            ? "몇 가지 질문에 답하면 AI가 나를 닮은 캐릭터 카드를 만들어 줘요."
            : "저장된 내 성향을 쓸게요. 이번 여행 질문 3개만 답하면 AI가 캐릭터 카드를 만들어 줘요."
        }
        actionLabel={saved === null ? "성향 검사 시작" : "여행 질문 답하기"}
        onAction={() => router.navigate(QUESTIONNAIRE_ROUTE)}
      />
    );
  }
  if (view.kind === "error") {
    return (
      <StateView tone="danger" title="캐릭터를 불러오지 못했어요" text={view.message} actionLabel="다시 시도" onAction={() => void load()} />
    );
  }
  return <StateView loading title="내 캐릭터를 불러오는 중이에요" />;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { padding: spacing.md, gap: spacing.md },
    hero: { alignItems: "center", gap: spacing.sm + spacing.xs },
    chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
    traits: { gap: spacing.md },
    trait: { gap: spacing.xs },
    traitHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  });
