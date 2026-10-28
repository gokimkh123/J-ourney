import { useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, ScrollView, Share, StyleSheet, Switch, View } from "react-native";

import {
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  MemberBand,
  PartyCard,
  StatusPill,
  TextField,
} from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import type { InviteInfo, SessionResponse } from "../lib/persona/types.ts";
import { partyActions, session } from "../lib/session/index.ts";
import { forgetPartyInfo, putPartyInfo } from "../lib/session/partyInfo.ts";
import { fromSessionResponse } from "../lib/session/session.ts";
import { useParties } from "../lib/session/useParties.ts";
import { usePartyInfos, useRefreshParty } from "../lib/session/usePartyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { homeActions, type HomeActions } from "../lib/trip/homeActions.ts";
import { homeStep, type HomeStep } from "../lib/trip/homeStep.ts";
import { partyStatus } from "../lib/trip/partyStatus.ts";
import { describeError, normalizeInviteCode } from "../lib/ui/format.ts";
import { usePolling } from "../lib/ui/usePolling.ts";
import { radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

const POLL_MS = 3000;
const QUESTIONNAIRE: Href = "/questionnaire" as Href;

const STEP_LABELS = ["성향 검사", "친구 준비", "회의 조건", "AI 회의", "합의안"];

/** 홈: 파티 밖(초기 화면)에서는 내 파티 목록과 참여·만들기, 파티 안에서는 지금 할 일과 같이 가는 사람의 준비 상태를 보여 준다. */
export default function Home() {
  const me = useSession();
  return me === null ? <PartyList /> : <TripHome key={me.tripId} />;
}

/* ───────────── 초기 화면(파티 밖) ───────────── */

function PartyList() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const list = useParties();
  const infos = usePartyInfos();
  const refreshOne = useRefreshParty();
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState(() => list[0]?.nickname ?? "");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("부산 1박 2일");
  const [demo, setDemo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // 목록에 있는 파티들의 이름·상태를 계속 새로 받는다.
  const ids = list.map((p) => p.tripId).join(",");
  const refreshAll = useCallback(async () => {
    await Promise.all(list.map((p) => refreshOne(p)));
  }, [list, refreshOne]);
  usePolling(refreshAll, POLL_MS * 2, list.length > 0, ids);

  async function submit(request: () => Promise<SessionResponse>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // 목록에 넣고 그 파티로 들어가면 홈이 파티 안 화면으로 바뀐다.
      await partyActions.join(fromSessionResponse(await request()));
      setCode("");
      setCreating(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const name = nickname.trim();
  const joinCode = code.trim();
  const already = list.find((p) => p.inviteCode === joinCode);
  const canJoin = !submitting && joinCode !== "" && (already !== undefined || name !== "");
  const canCreate = !submitting && title.trim() !== "" && name !== "";

  const onJoin = () => {
    if (already !== undefined) {
      // 이미 들어가 있는 파티의 코드면 새로 참여하지 않고 그 파티로 간다.
      setCode("");
      void partyActions.enter(already.tripId);
      return;
    }
    void submit(() => endpoints.joinInvite(joinCode, name));
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={[styles.body, styles.bodyTop]}>
        <View style={styles.intro}>
          <AppText variant="display" accessibilityRole="header">
            내 파티
          </AppText>
          {list.length === 0 && (
            <AppText variant="body" tone="muted">
              각자 여행 성향을 알려 주면, 나를 대신한 AI들이 회의해서 모두가 만족할 일정을 제안해요. 초대 코드를 받았다면 아래에 넣어 주세요.
            </AppText>
          )}
        </View>

        {list.length > 0 && (
          <View style={styles.section}>
            {list.map((p) => {
              const info = infos[p.tripId];
              return (
                <PartyCard
                  key={p.tripId}
                  title={info?.trip.title ?? null}
                  inviteCode={p.inviteCode}
                  members={(info?.members ?? []).map((m) => ({ name: m.nickname, color: m.color }))}
                  status={partyStatus(info)}
                  onPress={() => void partyActions.enter(p.tripId)}
                />
              );
            })}
          </View>
        )}

        <View style={styles.form}>
          <AppText variant="heading" accessibilityRole="header">
            코드로 파티 들어가기
          </AppText>
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
          {joinCode !== "" && already === undefined && (
            <TextField label="내 닉네임" value={nickname} onChangeText={setNickname} editable={!submitting} placeholder="여행 친구들이 부를 이름" maxLength={12} />
          )}
          <Button label={already !== undefined ? "이미 들어간 파티예요 · 열기" : "참여하기"} onPress={onJoin} disabled={!canJoin} loading={submitting && !creating} block />
        </View>

        {!creating ? (
          <Button label="새 파티 만들기" icon="＋" variant="secondary" onPress={() => { setCreating(true); setError(null); }} block />
        ) : (
          <View style={styles.form}>
            <AppText variant="heading" accessibilityRole="header">
              새 파티 만들기
            </AppText>
            <TextField label="여행 이름" value={title} onChangeText={setTitle} editable={!submitting} placeholder="예: 부산 1박 2일" />
            <TextField label="내 닉네임" value={nickname} onChangeText={setNickname} editable={!submitting} placeholder="여행 친구들이 부를 이름" maxLength={12} />
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
            <View style={styles.actionRow}>
              <Button label="취소" variant="secondary" onPress={() => setCreating(false)} disabled={submitting} style={styles.half} />
              <Button label="파티 만들기" onPress={() => void submit(() => endpoints.createTrip(title.trim(), name, demo))} disabled={!canCreate} loading={submitting && creating} style={styles.half} />
            </View>
          </View>
        )}
        {error !== null && <Banner tone="danger" text={error} />}
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
      putPartyInfo(next);
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

  const actions = homeActions(info?.members ?? null, me.memberId, view.step);

  // 알림 보내기는 서버 기능이 생기면 붙인다(docs/app/나중에_구현할_것.md). 지금은 버튼만 있다.
  const onNudge = () => {
    Alert.alert("준비 중이에요", "재촉하기는 서버 알림 기능이 준비되면 열려요.");
  };

  const onShare = async () => {
    const prefix = info !== null ? `${info.trip.title} ` : "";
    try {
      await Share.share({ message: `${prefix}여행에 초대해요! 여행회의 앱에서 초대 코드 ${code}를 넣어 주세요.` });
    } catch {
      // 공유 창을 열지 못해도 화면은 그대로 둔다.
    }
  };

  const members = info?.members ?? [];

  const onLeave = () => {
    Alert.alert(
      `${info?.trip.title ?? "이 파티"}에서 나갈까요?`,
      "이 휴대폰의 이 파티 정보(회의 조건·합의안 포함)가 지워져요. 같은 초대 코드로 다시 들어오면 새 구성원으로 참여해요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "나가기",
          style: "destructive",
          onPress: () => {
            forgetPartyInfo(me.tripId);
            void partyActions.leave(me.tripId);
          },
        },
      ],
    );
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
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
          actions={actions}
          onPersona={() => router.push(QUESTIONNAIRE)}
          onShare={() => void onShare()}
          onNudge={onNudge}
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

        <Button label="파티 나가기" variant="danger" onPress={onLeave} block />
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
  actions: HomeActions;
  onPersona: () => void;
  onShare: () => void;
  /** 안 한 사람·방장 재촉하기(아직 알림 기능이 없어 안내만 띄운다) */
  onNudge: () => void;
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
      text = `${p.readyCount}/${p.total}명이 준비됐어요. 모두 성향 검사를 마치면 회의를 시작할 수 있어요.`;
      actions = (
        <View style={styles.actionRow}>
          {p.actions.canShare && <Button label="초대 코드 공유" variant="secondary" onPress={p.onShare} style={styles.half} />}
          {p.actions.nudgeTargets.length > 0 && (
            <Button label="안 한 사람 재촉하기" onPress={p.onNudge} style={styles.half} />
          )}
        </View>
      );
      break;
    case "conditions":
      if (p.actions.canStart) {
        title = "모두 준비됐어요";
        text = "날짜와 예산을 정하면 AI들이 회의를 시작해요.";
        actions = <Button label="회의 시작하기" onPress={p.onConditions} block />;
      } else {
        title = "방장이 시작할 차례예요";
        text = "모두 준비됐어요. 회의 조건과 시작은 방장만 할 수 있어요.";
        actions = <Button label="방장 재촉하기" onPress={p.onNudge} block />;
      }
      if (p.actions.canShare) {
        actions = (
          <View style={styles.actionColumn}>
            {actions}
            <Button label="초대 코드 공유" variant="ghost" size="sm" onPress={p.onShare} block />
          </View>
        );
      }
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
    actionColumn: { gap: spacing.xs },
    half: { flex: 1 },
    section: { gap: spacing.sm },
    sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
    memberBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
    memberName: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
    shrink: { flexShrink: 1 },
  });
