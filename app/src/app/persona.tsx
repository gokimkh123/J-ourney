import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Href } from "expo-router";

import { Button, PersonaCard, StateView } from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import { ApiError } from "../lib/api/errors.ts";
import type { Persona } from "../lib/persona/types.ts";
import { session } from "../lib/session/index.ts";
import { spacing, useStyles, type Theme } from "../theme/index.ts";
import { describeError } from "../lib/ui/format.ts";

const QUESTIONNAIRE_ROUTE = "/questionnaire" as Href;

type View_ =
  | { kind: "loading" }
  | { kind: "noSession" }
  | { kind: "ready"; persona: Persona }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

export default function PersonaScreen() {
  const styles = useStyles(createStyles);
  const router = useRouter();
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
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
        <PersonaCard persona={view.persona} />
        <Button label="다시 검사하기" variant="secondary" block onPress={() => router.navigate(QUESTIONNAIRE_ROUTE)} />
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
        text="몇 가지 질문에 답하면 AI가 나를 닮은 캐릭터 카드를 만들어 줘요."
        actionLabel="성향 검사 시작"
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
  });
