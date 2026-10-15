import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { endpoints } from "../../lib/api/index.ts";
import { ApiError } from "../../lib/api/errors.ts";
import { session } from "../../lib/session/index.ts";
import { fromSessionResponse } from "../../lib/session/session.ts";
import type { Session } from "../../lib/session/session.ts";
import { colors } from "../../lib/theme.ts";
import { describeError, normalizeInviteCode } from "../../lib/ui/format.ts";

function describeJoinError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "초대 코드를 찾을 수 없어요";
  return describeError(error);
}

export default function InviteScreen() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const router = useRouter();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = normalizeInviteCode(rawCode ?? "");

  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Session | null>(null);
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      let loaded: Session | null = null;
      try {
        loaded = await session.load();
      } catch {
        // 저장소를 읽지 못하면 세션이 없는 것으로 본다.
      }
      if (!alive.current) return;
      setCurrent(loaded);
      setLoading(false);
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  function goHome() {
    router.replace("/");
  }

  async function onJoin() {
    const name = nickname.trim();
    if (name === "" || code === "" || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const next = fromSessionResponse(await endpoints.joinInvite(code, name));
      await session.save(next);
      if (alive.current) goHome();
    } catch (e) {
      if (alive.current) setError(describeJoinError(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (current !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.line}>이미 여행에 참여 중이에요</Text>
        <Pressable style={styles.button} onPress={goHome}>
          <Text style={styles.buttonText}>홈으로 이동</Text>
        </Pressable>
      </View>
    );
  }

  const canJoin = !submitting && nickname.trim() !== "" && code !== "";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>여행 초대</Text>
      <Text style={styles.line}>초대 코드: {code}</Text>
      <Text style={styles.label}>닉네임</Text>
      <TextInput
        style={styles.input}
        value={nickname}
        onChangeText={setNickname}
        placeholder="닉네임"
        editable={!submitting}
      />
      <Pressable
        style={[styles.button, !canJoin && styles.buttonDisabled]}
        onPress={onJoin}
        disabled={!canJoin}
      >
        <Text style={styles.buttonText}>{submitting ? "요청 중..." : "참여하기"}</Text>
      </Pressable>
      {submitting && <ActivityIndicator style={styles.spinner} color={colors.primary} />}
      {error !== null && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 24,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: 16,
  },
  line: {
    marginTop: 8,
    fontSize: 16,
    color: colors.text,
    textAlign: "center",
  },
  label: {
    marginTop: 16,
    fontSize: 14,
    color: colors.text,
  },
  input: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: colors.primary,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#FFFFFF",
  },
  button: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.background,
  },
  spinner: {
    marginTop: 16,
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    color: colors.text,
    textAlign: "center",
  },
});
