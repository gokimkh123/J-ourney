import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { api, endpoints } from "../lib/api/index.ts";
import { checkHealth } from "../lib/api/health.ts";
import type { HealthResult } from "../lib/api/health.ts";
import { config } from "../lib/config/index.ts";
import type { InviteInfo, SessionResponse } from "../lib/persona/types.ts";
import { session } from "../lib/session/index.ts";
import { fromSessionResponse } from "../lib/session/session.ts";
import type { Session } from "../lib/session/session.ts";
import { useStyles, useTheme, type Theme } from "../theme/index.ts";
import { describeError, inviteLink, normalizeInviteCode } from "../lib/ui/format.ts";

const POLL_MS = 3000;

export default function Index() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const inFlight = useRef(false);

  const [sessionLoading, setSessionLoading] = useState(true);
  const [current, setCurrent] = useState<Session | null>(null);
  const sessionLoaded = useRef(false);

  const [title, setTitle] = useState("부산 1박 2일");
  const [hostNickname, setHostNickname] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const submitInFlight = useRef(false);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const requestId = useRef(0);

  async function onCheck() {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkHealth(api));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      let loaded: Session | null = null;
      try {
        loaded = await session.load();
      } catch {
        // 저장소를 읽지 못하면 세션이 없는 것으로 본다.
      }
      if (!alive) return;
      sessionLoaded.current = true;
      setCurrent(loaded);
      setSessionLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 초대 화면에서 참여한 뒤 돌아오면 저장된 세션을 반영한다.
  // 세션이 없어졌으면(나가기 중 저장소 삭제 실패 등) 홈도 세션 없음으로 맞춘다.
  useFocusEffect(
    useCallback(() => {
      if (!sessionLoaded.current) return;
      const saved = session.getSession();
      setCurrent(saved);
      if (saved === null) {
        requestId.current++;
        setInfo(null);
        setPollError(null);
        setLeaveError(null);
      }
    }, []),
  );

  const inviteCode = current?.inviteCode ?? null;

  useFocusEffect(
    useCallback(() => {
      if (inviteCode === null) return;
      const code = inviteCode;

      async function refresh() {
        const id = ++requestId.current;
        try {
          const next = await endpoints.getInvite(code);
          if (id !== requestId.current) return;
          setInfo(next);
          setPollError(null);
        } catch (error) {
          if (id !== requestId.current) return;
          setPollError(describeError(error));
        }
      }

      void refresh();
      const timer = setInterval(() => void refresh(), POLL_MS);
      return () => {
        clearInterval(timer);
        requestId.current++;
      };
    }, [inviteCode]),
  );

  async function submit(request: () => Promise<SessionResponse>) {
    submitInFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const next = fromSessionResponse(await request());
      await session.save(next);
      setInfo(null);
      setPollError(null);
      setCurrent(next);
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function onCreate() {
    const tripTitle = title.trim();
    const nickname = hostNickname.trim();
    if (tripTitle === "" || nickname === "" || submitInFlight.current) return;
    await submit(() => endpoints.createTrip(tripTitle, nickname, demoMode));
  }

  async function onJoin() {
    const code = joinCode.trim();
    const nickname = joinNickname.trim();
    if (code === "" || nickname === "" || submitInFlight.current) return;
    await submit(() => endpoints.joinInvite(code, nickname));
  }

  async function onShare() {
    if (inviteCode === null) return;
    const prefix = info !== null ? `${info.trip.title} ` : "";
    try {
      await Share.share({
        message: `${prefix}여행에 초대해요! 초대 코드: ${inviteCode}\n${inviteLink(inviteCode)}`,
      });
    } catch {
      // 공유 창을 열지 못해도 화면은 그대로 둔다.
    }
  }

  async function onLeave() {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setLeaveError(null);
    try {
      await session.clear();
      requestId.current++;
      setCurrent(null);
      setInfo(null);
      setPollError(null);
      setFormError(null);
    } catch (error) {
      setLeaveError(describeError(error));
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  const canCreate = !submitting && title.trim() !== "" && hostNickname.trim() !== "";
  const canJoin = !submitting && joinCode.trim() !== "" && joinNickname.trim() !== "";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>여행회의</Text>
      <Text style={styles.line}>모드: {config.useMock ? "가짜 데이터" : "서버"}</Text>
      <Text style={styles.line}>
        서버 주소: {config.apiBaseUrl === "" ? "없음 (가짜 데이터 사용)" : config.apiBaseUrl}
      </Text>
      {config.warning !== null && <Text style={styles.warning}>{config.warning}</Text>}

      <Pressable
        style={[styles.button, checking && styles.buttonDisabled]}
        onPress={onCheck}
        disabled={checking}
      >
        <Text style={styles.buttonText}>{checking ? "확인 중..." : "서버 연결 확인"}</Text>
      </Pressable>

      {checking && <ActivityIndicator style={styles.spinner} color={colors.accent} />}
      {result !== null && result.ok && (
        <Text style={styles.line}>연결 성공 · 응답 시간 {result.latencyMs}ms</Text>
      )}
      {result !== null && !result.ok && (
        <Text style={styles.warning}>
          연결 실패 · {result.error.code}: {result.error.message}
        </Text>
      )}

      {sessionLoading && <ActivityIndicator style={styles.spinner} color={colors.accent} />}

      {!sessionLoading && current === null && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>새 여행 만들기</Text>
            <Text style={styles.label}>여행 이름</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="여행 이름"
        placeholderTextColor={colors.textMuted}
              editable={!submitting}
            />
            <Text style={styles.label}>닉네임</Text>
            <TextInput
              style={styles.input}
              value={hostNickname}
              onChangeText={setHostNickname}
              placeholder="닉네임"
        placeholderTextColor={colors.textMuted}
              editable={!submitting}
            />
            <View style={styles.switchRow}>
              <Text style={styles.label}>시연 모드</Text>
              <Switch value={demoMode} onValueChange={setDemoMode} disabled={submitting} />
            </View>
            <Pressable
              style={[styles.button, !canCreate && styles.buttonDisabled]}
              onPress={onCreate}
              disabled={!canCreate}
            >
              <Text style={styles.buttonText}>{submitting ? "요청 중..." : "여행 만들기"}</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>초대 코드로 참여</Text>
            <Text style={styles.label}>초대 코드</Text>
            <TextInput
              style={styles.input}
              value={joinCode}
              onChangeText={(text) => setJoinCode(normalizeInviteCode(text))}
              placeholder="예: BSN482"
        placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
            />
            <Text style={styles.label}>닉네임</Text>
            <TextInput
              style={styles.input}
              value={joinNickname}
              onChangeText={setJoinNickname}
              placeholder="닉네임"
        placeholderTextColor={colors.textMuted}
              editable={!submitting}
            />
            <Pressable
              style={[styles.button, !canJoin && styles.buttonDisabled]}
              onPress={onJoin}
              disabled={!canJoin}
            >
              <Text style={styles.buttonText}>{submitting ? "요청 중..." : "참여하기"}</Text>
            </Pressable>
          </View>

          {submitting && <ActivityIndicator style={styles.spinner} color={colors.accent} />}
          {formError !== null && <Text style={styles.warning}>{formError}</Text>}
        </>
      )}

      {!sessionLoading && current !== null && (
        <View style={styles.section}>
          {info === null ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.line}>여행 정보를 불러오는 중...</Text>
            </>
          ) : (
            <Text style={styles.sectionTitle}>{info.trip.title}</Text>
          )}
          <Text style={styles.line}>초대 코드: {current.inviteCode}</Text>
          <Text style={styles.link}>{inviteLink(current.inviteCode)}</Text>
          <Pressable style={styles.button} onPress={onShare}>
            <Text style={styles.buttonText}>공유하기</Text>
          </Pressable>

          <Text style={[styles.sectionTitle, styles.membersTitle]}>구성원</Text>
          {info?.members.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <View style={[styles.dot, { backgroundColor: member.color }]} />
              <View style={styles.memberBody}>
                <Text style={styles.memberName}>
                  {member.nickname}
                  {member.isHost ? " · 방장" : ""}
                </Text>
                <Text style={styles.memberSub}>
                  {member.personaReady && member.title ? member.title : "성향 검사 전"}
                </Text>
              </View>
            </View>
          ))}
          {pollError !== null && <Text style={styles.warning}>{pollError}</Text>}

          {leaveError !== null && <Text style={styles.warning}>{leaveError}</Text>}
          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={onLeave}
            disabled={submitting}
          >
            <Text style={styles.buttonText}>여행에서 나가기</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    container: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      backgroundColor: t.colors.background,
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: t.colors.text,
      marginBottom: 16,
    },
    line: {
      marginTop: 8,
      fontSize: 16,
      color: t.colors.text,
      textAlign: "center",
    },
    warning: {
      marginTop: 8,
      fontSize: 14,
      color: t.colors.text,
      textAlign: "center",
    },
    button: {
      marginTop: 24,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      backgroundColor: t.colors.accent,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: "bold",
      color: t.colors.onAccent,
    },
    spinner: {
      marginTop: 16,
    },
    section: {
      alignSelf: "stretch",
      alignItems: "center",
      marginTop: 32,
      padding: 16,
      borderRadius: 12,
      backgroundColor: t.colors.surface,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: "bold",
      color: t.colors.text,
    },
    label: {
      alignSelf: "stretch",
      marginTop: 12,
      fontSize: 14,
      color: t.colors.text,
    },
    input: {
      alignSelf: "stretch",
      marginTop: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderRadius: 8,
      borderColor: t.colors.accent,
      fontSize: 16,
      color: t.colors.text,
      backgroundColor: t.colors.surface,
    },
    switchRow: {
      alignSelf: "stretch",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    link: {
      marginTop: 4,
      fontSize: 14,
      color: t.colors.accent,
      textAlign: "center",
    },
    membersTitle: {
      marginTop: 24,
    },
    memberRow: {
      alignSelf: "stretch",
      flexDirection: "row",
      alignItems: "center",
      marginTop: 12,
    },
    dot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      marginRight: 12,
    },
    memberBody: {
      flex: 1,
    },
    memberName: {
      fontSize: 16,
      fontWeight: "bold",
      color: t.colors.text,
    },
    memberSub: {
      marginTop: 2,
      fontSize: 13,
      color: t.colors.text,
    },
  });
