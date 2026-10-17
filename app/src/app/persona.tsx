import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Href } from "expo-router";

import PersonaCard from "../components/PersonaCard.tsx";
import { endpoints } from "../lib/api/index.ts";
import { ApiError } from "../lib/api/errors.ts";
import type { Persona } from "../lib/persona/types.ts";
import { session } from "../lib/session/index.ts";
import { useStyles, useTheme, type Theme } from "../theme/index.ts";
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
  const { colors } = useTheme();
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
        <View style={styles.actions}>
          <Pressable style={styles.button} onPress={() => router.navigate(QUESTIONNAIRE_ROUTE)}>
            <Text style={styles.buttonText}>다시 검사하기</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.center}>
      {view.kind === "loading" && <ActivityIndicator color={colors.accent} />}
      {view.kind === "noSession" && (
        <Text style={styles.line}>먼저 홈에서 여행에 참여해 주세요</Text>
      )}
      {view.kind === "notFound" && (
        <Pressable style={styles.button} onPress={() => router.navigate(QUESTIONNAIRE_ROUTE)}>
          <Text style={styles.buttonText}>성향 검사 시작</Text>
        </Pressable>
      )}
      {view.kind === "error" && (
        <>
          <Text style={styles.line}>{view.message}</Text>
          <Pressable style={styles.button} onPress={() => void load()}>
            <Text style={styles.buttonText}>다시 시도</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    scroll: {
      padding: 24,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      backgroundColor: t.colors.background,
    },
    line: {
      fontSize: 16,
      color: t.colors.text,
      textAlign: "center",
    },
    actions: {
      marginTop: 24,
      alignItems: "center",
    },
    button: {
      marginTop: 12,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      backgroundColor: t.colors.accent,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: "bold",
      color: t.colors.onAccent,
    },
  });
