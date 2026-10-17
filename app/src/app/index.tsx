import { useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ScrollView, Share, StyleSheet, Switch, View } from "react-native";

import {
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  MemberBand,
  SegmentedTabs,
  StatusPill,
  TextField,
} from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import { busanAgents } from "../lib/meeting/fixtures/busan.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import type { InviteInfo, SessionResponse } from "../lib/persona/types.ts";
import { session } from "../lib/session/index.ts";
import { fromSessionResponse } from "../lib/session/session.ts";
import { useSession } from "../lib/session/useSession.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { homeStep, type HomeStep } from "../lib/trip/homeStep.ts";
import { describeError, normalizeInviteCode } from "../lib/ui/format.ts";
import { usePolling } from "../lib/ui/usePolling.ts";
import { radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

const POLL_MS = 3000;
const QUESTIONNAIRE: Href = "/questionnaire" as Href;

type Mode = "create" | "join";

const STEP_LABELS = ["성향 검사", "친구 준비", "회의 조건", "AI 회의", "합의안"];

/** 참여 전 홈 위쪽 띠에 서 있는 예시 캐릭터들 */
const SAMPLE_BAND = busanAgents.map((a) => ({ id: a.agentId, name: a.nickname, color: a.color, chips: a.chips }));

/** 홈: 참여 전에는 여행 만들기·참여, 참여 후에는 지금 할 일과 같이 가는 사람의 준비 상태를 보여 준다. */
export default function Home() {
  const me = useSession();
  return me === null ? <Welcome /> : <TripHome key={me.tripId} />;
}

/* ───────────── 참여 전 ───────────── */

function Welcome() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>("create");
  const [title, setTitle] = useState("부산 1박 2일");
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [demo, setDemo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(request: () => Promise<SessionResponse>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // 저장되면 세션 구독으로 홈이 참여 후 화면으로 바뀐다.
      await session.save(fromSessionResponse(await request()));
    } catch (e) {
      setError(describeError(e));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const name = nickname.trim();
  const canCreate = !submitting && title.trim() !== "" && name !== "";
  const canJoin = !submitting && code.trim() !== "" && name !== "";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <MemberBand members={SAMPLE_BAND} />
      <View style={styles.body}>
        <View style={styles.intro}>
          <AppText variant="display" accessibilityRole="header">
            여행회의
          </AppText>
          <AppText variant="body" tone="muted">
            각자 여행 성향을 알려 주면, 나를 대신한 AI들이 회의해서 모두가 만족할 일정을 제안해요.
          </AppText>
        </View>

        <SegmentedTabs<Mode>
          options={[
            { key: "create", label: "새 여행 만들기" },
            { key: "join", label: "초대 코드로 참여" },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
          accessibilityLabel="시작 방법"
        />

        <View style={styles.form}>
          {mode === "create" ? (
            <TextField label="여행 이름" value={title} onChangeText={setTitle} editable={!submitting} placeholder="예: 부산 1박 2일" />
          ) : (
            <TextField
              label="초대 코드"
              value={code}
              onChangeText={(text) => setCode(normalizeInviteCode(text))}
              placeholder="예: BSN482"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
              hint="친구에게 받은 6자리 코드를 넣어 주세요."
            />
          )}
          <TextField
            label="내 닉네임"
            value={nickname}
            onChangeText={setNickname}
            editable={!submitting}
            placeholder="여행 친구들이 부를 이름"
            maxLength={12}
          />
          {mode === "create" && (
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <AppText variant="smallStrong">시연 모드</AppText>
                <AppText variant="caption" tone="muted">
                  예시 친구 3명이 함께 들어와서 혼자서도 끝까지 볼 수 있어요.
                </AppText>
              </View>
              <Switch
                value={demo}
                onValueChange={setDemo}
                disabled={submitting}
                trackColor={{ true: colors.accent, false: colors.border }}
                accessibilityLabel="시연 모드"
              />
            </View>
          )}
          {error !== null && <Banner tone="danger" text={error} />}
          {mode === "create" ? (
            <Button
              label="여행 만들기"
              onPress={() => void submit(() => endpoints.createTrip(title.trim(), name, demo))}
              disabled={!canCreate}
              loading={submitting}
              block
            />
          ) : (
            <Button
              label="참여하기"
              onPress={() => void submit(() => endpoints.joinInvite(code.trim(), name))}
              disabled={!canJoin}
              loading={submitting}
              block
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

/* ───────────── 참여 후 ───────────── */

function TripHome() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const me = useSession()!;
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const conditions = useSyncExternalStore(conditionsStore.subscribe, conditionsStore.get, conditionsStore.get);
  const result = useSyncExternalStore(meetingResultStore.subscribe, meetingResultStore.get, meetingResultStore.get);

  const code = me.inviteCode;
  const refresh = useCallback(async () => {
    try {
      const next = await endpoints.getInvite(code);
      // 기다리는 사이 나가거나 다른 여행으로 바뀌었으면 버린다.
      if (session.getSession()?.inviteCode !== code) return;
      setInfo(next);
      setPollError(null);
    } catch (e) {
      if (session.getSession()?.inviteCode !== code) return;
      setPollError(describeError(e));
    }
  }, [code]);
  usePolling(refresh, POLL_MS, true, code);

  const view = homeStep({
    members: info?.members ?? null,
    myMemberId: me.memberId,
    hasConditions: conditions !== null,
    hasResult: result !== null,
  });

  const onShare = async () => {
    const prefix = info !== null ? `${info.trip.title} ` : "";
    try {
      await Share.share({ message: `${prefix}여행에 초대해요! 여행회의 앱에서 초대 코드 ${code}를 넣어 주세요.` });
    } catch {
      // 공유 창을 열지 못해도 화면은 그대로 둔다.
    }
  };

  const members = info?.members ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      {members.length > 0 && <MemberBand members={members.map((m) => ({ id: m.id, name: m.nickname, color: m.color }))} />}
      <View style={[styles.body, members.length === 0 && styles.bodyTop]}>
        <View style={styles.intro}>
          <AppText variant="display" accessibilityRole="header">
            {info?.trip.title ?? "여행 정보를 불러오는 중"}
          </AppText>
          <View style={styles.codeRow}>
            <AppText variant="small" tone="muted">
              초대 코드
            </AppText>
            <AppText variant="bodyStrong" selectable accessibilityLabel={`초대 코드 ${code.split("").join(" ")}`}>
              {code}
            </AppText>
            <Button label="공유" variant="secondary" size="sm" onPress={() => void onShare()} />
          </View>
        </View>

        <StepTrack done={view.doneCount} />

        <NextAction
          step={view.step}
          loading={info === null}
          readyCount={view.readyCount}
          total={view.total}
          onPersona={() => router.push(QUESTIONNAIRE)}
          onShare={() => void onShare()}
          onCharacter={() => router.navigate("/persona")}
          onConditions={() => router.push("/conditions")}
          onMeeting={() => router.navigate("/meeting")}
          onAgreement={() => router.push("/agreement")}
          onPlan={() => router.navigate("/plan")}
        />

        {pollError !== null && <Banner tone="warning" text={`구성원 정보를 새로 받지 못했어요. ${pollError}`} actionLabel="다시 시도" onAction={() => void refresh()} />}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText variant="heading" accessibilityRole="header">
              같이 가는 사람
            </AppText>
            {info !== null && (
              <AppText variant="caption" tone="muted">
                {view.readyCount}/{view.total}명 준비
              </AppText>
            )}
          </View>
          {members.map((m) => (
            <View key={m.id} style={styles.memberRow} accessible accessibilityLabel={`${m.nickname}${m.id === me.memberId ? ", 나" : ""}${m.isHost ? ", 방장" : ""}, ${m.personaReady ? "준비 완료" : "성향 검사 전"}`}>
              <Avatar color={m.color} name={m.nickname} size="sm" />
              <View style={styles.memberBody}>
                <View style={styles.memberName}>
                  <AppText variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
                    {m.nickname}
                  </AppText>
                  {m.id === me.memberId && (
                    <AppText variant="caption" tone="accent">
                      나
                    </AppText>
                  )}
                  {m.isHost && (
                    <AppText variant="caption" tone="muted">
                      방장
                    </AppText>
                  )}
                </View>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {m.personaReady ? m.title ?? "성향 검사 완료" : "아직 성향 검사 전이에요"}
                </AppText>
              </View>
              <StatusPill label={m.personaReady ? "준비 완료" : "검사 전"} tone={m.personaReady ? "success" : "neutral"} />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/** 성향 검사 → 친구 준비 → 회의 조건 → AI 회의 → 합의안. done개가 끝났고 그다음이 지금 단계. */
function StepTrack({ done }: { done: number }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.track} accessible accessibilityLabel={`진행 단계 ${STEP_LABELS.length}개 중 ${done}개 완료, 지금은 ${STEP_LABELS[Math.min(done, STEP_LABELS.length - 1)]}`}>
      {STEP_LABELS.map((label, i) => {
        const state = i < done ? "done" : i === done ? "now" : "todo";
        return (
          <View key={label} style={styles.trackItem}>
            <View style={styles.trackLineRow}>
              <View style={[styles.trackLine, { backgroundColor: i === 0 ? "transparent" : i <= done ? colors.accent : colors.border }]} />
              <View
                style={[
                  styles.trackDot,
                  state === "done" && { backgroundColor: colors.accent, borderColor: colors.accent },
                  state === "now" && { borderColor: colors.accent, borderWidth: 3 },
                ]}
              />
              <View
                style={[
                  styles.trackLine,
                  { backgroundColor: i === STEP_LABELS.length - 1 ? "transparent" : i < done ? colors.accent : colors.border },
                ]}
              />
            </View>
            <AppText variant="caption" tone={state === "todo" ? "muted" : "default"} align="center" style={state === "now" ? styles.trackNow : undefined}>
              {label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

type NextActionProps = {
  step: HomeStep;
  loading: boolean;
  readyCount: number;
  total: number;
  onPersona: () => void;
  onShare: () => void;
  onCharacter: () => void;
  onConditions: () => void;
  onMeeting: () => void;
  onAgreement: () => void;
  onPlan: () => void;
};

/** 지금 단계에서 할 일 하나를 크게 보여 준다. */
function NextAction(p: NextActionProps) {
  const styles = useStyles(createStyles);
  if (p.loading) {
    return (
      <Card tone="accent">
        <AppText variant="small" tone="muted">
          구성원 정보를 불러오고 있어요.
        </AppText>
      </Card>
    );
  }

  let title: string;
  let text: string;
  let actions: ReactNode;
  switch (p.step) {
    case "persona":
      title = "내 성향 검사부터 해요";
      text = "질문에 답하면 나를 대신해 회의할 AI 캐릭터가 생겨요.";
      actions = <Button label="성향 검사 시작" onPress={p.onPersona} block />;
      break;
    case "waiting":
      title = "친구들을 기다리고 있어요";
      text = `${p.readyCount}/${p.total}명이 준비됐어요. 모두 성향 검사를 마치면 회의 조건을 정할 수 있어요.`;
      actions = (
        <View style={styles.actionRow}>
          <Button label="내 캐릭터 보기" variant="secondary" onPress={p.onCharacter} style={styles.half} />
          <Button label="초대 코드 공유" onPress={p.onShare} style={styles.half} />
        </View>
      );
      break;
    case "conditions":
      title = "모두 준비됐어요";
      text = "날짜와 예산을 정하면 AI들이 회의를 시작해요.";
      actions = <Button label="회의 조건 정하기" onPress={p.onConditions} block />;
      break;
    case "meeting":
      title = "AI들이 회의하고 있어요";
      text = "AI들이 장소를 조사하고 서로 의견을 맞추는 모습을 볼 수 있어요.";
      actions = <Button label="AI 회의 보기" onPress={p.onMeeting} block />;
      break;
    case "result":
      title = "AI가 일정을 제안했어요";
      text = "제안 내용을 확인해 보세요. 확정은 함께 가는 사람들이 해요.";
      actions = (
        <View style={styles.actionRow}>
          <Button label="일정 보기" variant="secondary" onPress={p.onPlan} style={styles.half} />
          <Button label="합의안 보기" onPress={p.onAgreement} style={styles.half} />
        </View>
      );
      break;
  }

  return (
    <Card tone="accent" accessibilityLabel={`지금 할 일: ${title}`}>
      <AppText variant="caption" tone="accent">
        지금 할 일
      </AppText>
      <AppText variant="title">{title}</AppText>
      <AppText variant="small" tone="muted">
        {text}
      </AppText>
      <View style={styles.actions}>{actions}</View>
    </Card>
  );
}

const DOT = 14;

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { paddingBottom: spacing.xl },
    body: { padding: spacing.md, gap: spacing.lg },
    bodyTop: { paddingTop: spacing.lg },
    intro: { gap: spacing.xs },
    form: { gap: spacing.md },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.sm + spacing.xs,
      borderRadius: radius.md,
      backgroundColor: t.colors.surfaceSunken,
    },
    switchText: { flex: 1, gap: spacing.xxs },
    codeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    track: { flexDirection: "row" },
    trackItem: { flex: 1, alignItems: "center", gap: spacing.xs },
    trackLineRow: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
    trackLine: { flex: 1, height: 2 },
    trackDot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 2,
      borderColor: t.colors.border,
      backgroundColor: t.colors.background,
    },
    trackNow: { fontWeight: "700" },
    actions: { marginTop: spacing.xs },
    actionRow: { flexDirection: "row", gap: spacing.sm },
    half: { flex: 1 },
    section: { gap: spacing.sm },
    sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
    memberBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
    memberName: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
    shrink: { flexShrink: 1 },
  });
