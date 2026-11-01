import * as Clipboard from "expo-clipboard";
import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccessibilityInfo, Alert, Pressable, ScrollView, Share, StyleSheet, Switch, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import {
  AppText,
  Banner,
  Button,
  CodeInput,
  FormSheet,
  PartyCard,
  PartyHomeStage,
  PartyStage,
  StatusPill,
  TextField,
} from "../components/index.ts";
import { CharacterSvg } from "../components/character/Bean.tsx";
import type { CharacterProps } from "../components/character/props.ts";
import { endpoints } from "../lib/api/index.ts";
import { ApiError } from "../lib/api/errors.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { profileChips } from "../lib/persona/profile.ts";
import { useProfile } from "../lib/persona/profileStore.ts";
import type { InviteInfo, SessionResponse } from "../lib/persona/types.ts";
import { partyActions, session } from "../lib/session/index.ts";
import { forgetPartyInfo, putPartyInfo } from "../lib/session/partyInfo.ts";
import { fromSessionResponse } from "../lib/session/session.ts";
import { useParties } from "../lib/session/useParties.ts";
import { usePartyInfos, useRefreshParty } from "../lib/session/usePartyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { MAX_MEMBERS, homeActions, type HomeActions } from "../lib/trip/homeActions.ts";
import { homeBubble, waitingTitle } from "../lib/trip/homeBubble.ts";
import { homeStep, type HomeStep } from "../lib/trip/homeStep.ts";
import { memberChips } from "../lib/trip/memberChips.ts";
import { partyStatus } from "../lib/trip/partyStatus.ts";
import { describeError, normalizeInviteCode } from "../lib/ui/format.ts";
import { usePolling } from "../lib/ui/usePolling.ts";
import { hitSize, memberColors, outline, pastel, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

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
  const myChips = profileChips(useProfile());
  const infos = usePartyInfos();
  const refreshOne = useRefreshParty();
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState(() => list[0]?.nickname ?? "");
  // 새 파티 만들기·코드로 참여는 아래에서 올라오는 시트에서 한다.
  const [sheet, setSheet] = useState<"create" | "join" | null>(null);
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

  async function submit(request: () => Promise<SessionResponse>, demoParty = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // 목록에 넣고 그 파티로 들어가면 홈이 파티 안 화면으로 바뀐다.
      const joined = fromSessionResponse(await request());
      await partyActions.join(demoParty ? { ...joined, demo: true } : joined);
      setCode("");
      setSheet(null);
    } catch (e) {
      setError(describeError(e, "join"));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const name = nickname.trim();
  const joinCode = code.trim();
  const already = list.find((p) => p.inviteCode === joinCode);
  const preview = useInvitePreview(already === undefined && joinCode.length === CODE_LENGTH ? joinCode : null);
  const canJoin = !submitting && joinCode !== "" && preview.kind !== "notFound" && (already !== undefined || name !== "");
  const canCreate = !submitting && title.trim() !== "" && name !== "";

  const onJoin = () => {
    if (already !== undefined) {
      // 이미 들어가 있는 파티의 코드면 새로 참여하지 않고 그 파티로 간다.
      setCode("");
      setSheet(null);
      void partyActions.enter(already.tripId);
      return;
    }
    void submit(() => endpoints.joinInvite(joinCode, name));
  };
  const open = (which: "create" | "join") => {
    setError(null);
    setSheet(which);
  };
  const close = () => {
    if (!submitting) setSheet(null);
  };

  const empty = list.length === 0;
  const previewInfo = preview.kind === "ready" ? preview.info : null;

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
        {empty ? (
          <View style={[styles.body, styles.bodyTop]}>
            <EmptyStart onCreate={() => open("create")} onJoin={() => open("join")} />
          </View>
        ) : (
          <View style={styles.listBody}>
            {list.map((p) => {
              const info = infos[p.tripId];
              return (
                <PartyCard
                  key={p.tripId}
                  title={info?.trip.title ?? null}
                  inviteCode={p.inviteCode}
                  members={(info?.members ?? []).map((m) => ({ name: m.nickname, color: m.color, ready: m.personaReady, chips: memberChips(m, p.memberId, myChips) }))}
                  status={partyStatus(info)}
                  onPress={() => void partyActions.enter(p.tripId)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      {!empty && (
        <View style={styles.bottomActions}>
          <Button label="새 파티" onPress={() => open("create")} style={styles.half} />
          <Button label="코드로 참여" variant="secondary" onPress={() => open("join")} style={styles.half} />
        </View>
      )}

      <FormSheet visible={sheet === "join"} title="초대 코드" onClose={close}>
        <CodeInput
          value={code}
          onChangeText={(text) => setCode(normalizeInviteCode(text))}
          length={CODE_LENGTH}
          editable={!submitting}
          autoFocus={code === ""}
          accessibilityLabel={`초대 코드 ${CODE_LENGTH}자리`}
        />
        {already !== undefined ? (
          <AppText variant="small" tone="muted">
            이미 들어간 파티예요.
          </AppText>
        ) : previewInfo !== null ? (
          <View style={styles.preview} accessible accessibilityLabel={`${previewInfo.trip.title}, ${previewInfo.members.length}명이 기다리고 있어요`}>
            <View style={styles.previewStage}>
              <PartyStage
                members={previewInfo.members.map((m) => ({ name: m.nickname, color: m.color, ready: m.personaReady, chips: memberChips(m, undefined, []) }))}
                meSeat={previewInfo.members.length < MAX_MEMBERS}
                height={120}
                figure={78}
                centered
              />
            </View>
            <View style={styles.previewName}>
              <AppText variant="heading" numberOfLines={1} style={styles.shrink}>
                {previewInfo.trip.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {previewInfo.members.length}명
              </AppText>
            </View>
          </View>
        ) : preview.kind === "notFound" ? (
          <AppText variant="small" tone="danger">
            초대 코드를 찾을 수 없어요. 다시 확인해 주세요.
          </AppText>
        ) : (
          <AppText variant="caption" tone="muted">
            친구에게 받은 {CODE_LENGTH}자리 코드를 넣어 주세요.
          </AppText>
        )}
        {already === undefined && (
          <TextField label="내 닉네임" value={nickname} onChangeText={setNickname} editable={!submitting} placeholder="여행 친구들이 부를 이름" maxLength={12} />
        )}
        {error !== null && <Banner tone="danger" text={error} />}
        <Button label={already !== undefined ? "파티 열기" : "참여하기"} size="lg" onPress={onJoin} disabled={!canJoin} loading={submitting} block />
      </FormSheet>

      <FormSheet visible={sheet === "create"} title="새 파티" onClose={close}>
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
        {error !== null && <Banner tone="danger" text={error} />}
        <Button label="파티 만들기" size="lg" onPress={() => void submit(() => endpoints.createTrip(title.trim(), name, demo), demo)} disabled={!canCreate} loading={submitting} block />
      </FormSheet>
    </View>
  );
}

/** 초대 코드 길이 */
const CODE_LENGTH = 6;

type InvitePreview = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; info: InviteInfo } | { kind: "notFound" } | { kind: "error" };

/** 코드를 다 넣으면 어떤 파티인지 미리 받아 온다. 못 받아 와도 참여는 시도할 수 있다. */
function useInvitePreview(code: string | null): InvitePreview {
  const [preview, setPreview] = useState<InvitePreview>({ kind: "idle" });
  useEffect(() => {
    if (code === null) {
      setPreview({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setPreview({ kind: "loading" });
    endpoints
      .getInvite(code)
      .then((info) => {
        if (!cancelled) setPreview({ kind: "ready", info });
      })
      .catch((e: unknown) => {
        if (!cancelled) setPreview(e instanceof ApiError && e.status === 404 ? { kind: "notFound" } : { kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);
  return preview;
}

/** 파티가 하나도 없을 때: 점선 카드 전체가 "새 파티 만들기" 버튼이고, 민수가 카드 뒤에서 고개를 내민다. */
function EmptyStart({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.start}>
      <AppText variant="title" accessibilityRole="header">
        첫 파티를 만들어 볼까요?
      </AppText>
      <View style={styles.startCardWrap}>
        <View style={styles.peek} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <CharacterSvg width={60} height={78} body={pastel(PEEK_COLOR)} line={outline(PEEK_COLOR)} props={PEEK_PROPS} />
        </View>
        <Pressable
          onPress={onCreate}
          accessibilityRole="button"
          accessibilityLabel="새 파티 만들기"
          style={({ pressed }) => [styles.startCard, pressed && styles.startCardPressed]}
        >
          <View style={styles.startPlus}>
            <Svg width={26} height={26} viewBox="0 0 24 24">
              <Path d="M12 5v14M5 12h14" stroke={colors.onAccent} strokeWidth={2.4} strokeLinecap="round" fill="none" />
            </Svg>
          </View>
          <AppText variant="heading" color={colors.accentSoftText}>
            새 파티 만들기
          </AppText>
        </Pressable>
      </View>
      <Pressable onPress={onJoin} accessibilityRole="button" accessibilityLabel="초대 코드로 참여" style={({ pressed }) => [styles.startLink, pressed && { opacity: pressedOpacity }]}>
        <AppText variant="bodyStrong" color={colors.accentSoftText}>
          초대 코드로 참여
        </AppText>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M9 6l6 6-6 6" stroke={colors.accentSoftText} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </Pressable>
    </View>
  );
}

// 빈 화면의 민수: 첫 구성원 색, 모자와 책.
const PEEK_COLOR = memberColors[0]!;
const PEEK_PROPS: CharacterProps = { head: "cap", hand: "book" };

/* ───────────── 참여 후 ───────────── */

function TripHome() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const me = useSession()!;
  const myChips = profileChips(useProfile());
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

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );

  // 초대 코드만 복사한다(안내 문구는 공유 버튼이 붙인다). 복사했다는 표시는 버튼 글자를 잠깐 바꿔 보여 준다.
  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      return;
    }
    setCopied(true);
    AccessibilityInfo.announceForAccessibility("초대 코드를 복사했어요");
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
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

  // ⋯ 메뉴: 지금은 파티 나가기 하나(홈 아래쪽 버튼에서 옮겨 왔다).
  const onMore = () => {
    Alert.alert(info?.trip.title ?? "이 파티", undefined, [
      { text: "파티 나가기", style: "destructive", onPress: onLeave },
      { text: "취소", style: "cancel" },
    ]);
  };

  const stepIndex = Math.min(view.doneCount, STEP_LABELS.length - 1);
  const preparing = view.step === "persona" || view.step === "waiting" || view.step === "conditions";

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
      <PartyHomeStage
        title={info?.trip.title ?? "불러오는 중"}
        subtitle={`${stepIndex + 1}/${STEP_LABELS.length} · ${STEP_LABELS[stepIndex]}`}
        members={members.map((m) => ({ id: m.id, name: m.nickname, color: m.color, ready: m.personaReady, me: m.id === me.memberId, chips: memberChips(m, me.memberId, myChips) }))}
        showStatus={preparing}
        seats={actions.canShare ? MAX_MEMBERS - members.length : 0}
        onInvite={() => void onShare()}
        bubble={homeBubble(view.step, members, me.memberId)}
        confetti={view.step === "result"}
        onExit={() => void partyActions.exit()}
        onSettings={() => router.push("/settings")}
        onMore={onMore}
      />
      <View style={styles.homeBody}>
        <NextAction
          step={view.step}
          loading={info === null}
          readyCount={view.readyCount}
          total={view.total}
          actions={actions}
          onPersona={() => router.push(QUESTIONNAIRE)}
          onNudge={onNudge}
          onConditions={() => router.push("/conditions")}
          onMeeting={() => router.navigate("/meeting")}
          onAgreement={() => router.push("/agreement")}
          onPlan={() => router.navigate("/plan")}
        />

        {pollError !== null && <Banner tone="warning" text={`구성원 정보를 새로 받지 못했어요. ${pollError}`} actionLabel="다시 시도" onAction={() => void refresh()} />}

        {preparing && <InviteRow code={code} copied={copied} onCopy={() => void onCopy()} onShare={() => void onShare()} />}
      </View>
    </ScrollView>
  );
}

/** 초대 코드 한 줄: 코드와 복사·공유 아이콘 버튼 */
function InviteRow({ code, copied, onCopy, onShare }: { code: string; copied: boolean; onCopy: () => void; onShare: () => void }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const icon = { stroke: colors.text, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <View style={styles.inviteRow}>
      <View style={styles.inviteText}>
        <AppText variant="small" color={colors.textBody}>
          초대 코드
        </AppText>
        <AppText variant="bodyStrong" selectable style={styles.inviteCode} accessibilityLabel={`초대 코드 ${code.split("").join(" ")}`}>
          {code}
        </AppText>
      </View>
      <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={copied ? "초대 코드 복사됨" : "초대 코드 복사"} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: pressedOpacity }]}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          {copied ? (
            <Path d="M5 12.5l4.5 4.5L19 7.5" {...icon} stroke={colors.success} strokeWidth={2.2} />
          ) : (
            <>
              <Rect x={9} y={9} width={11} height={11} rx={2} {...icon} />
              <Path d="M5 15V5a1 1 0 0 1 1-1h10" {...icon} />
            </>
          )}
        </Svg>
      </Pressable>
      <Pressable onPress={onShare} accessibilityRole="button" accessibilityLabel="초대 링크 공유" style={({ pressed }) => [styles.iconBtn, pressed && { opacity: pressedOpacity }]}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Circle cx={18} cy={5} r={2.5} {...icon} />
          <Circle cx={6} cy={12} r={2.5} {...icon} />
          <Circle cx={18} cy={19} r={2.5} {...icon} />
          <Path d="M8.3 13.3l7.4 4.4M15.7 6.3l-7.4 4.4" {...icon} />
        </Svg>
      </Pressable>
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
  /** 안 한 사람·방장 재촉하기(아직 알림 기능이 없어 안내만 띄운다) */
  onNudge: () => void;
  onConditions: () => void;
  onMeeting: () => void;
  onAgreement: () => void;
  onPlan: () => void;
};

/** 지금 단계에서 할 일 하나를 카드로 보여 준다. */
function NextAction(p: NextActionProps) {
  const styles = useStyles(createStyles);
  if (p.loading) {
    return (
      <View style={styles.actionCard}>
        <AppText variant="small" tone="muted">
          구성원 정보를 불러오고 있어요.
        </AppText>
      </View>
    );
  }

  if (p.step === "result") {
    return (
      <View style={[styles.actionCard, styles.resultCard]} accessible={false}>
        <View style={styles.resultPill}>
          <StatusPill label="AI 합의 완료" tone="success" />
        </View>
        <AppText variant="title" accessibilityRole="header">
          AI가 일정을 제안했어요
        </AppText>
        <AppText variant="small" tone="muted">
          확정은 함께 가는 사람들이 해요.
        </AppText>
        <View style={[styles.actionRow, styles.resultActions]}>
          <Button label="합의안 보기" onPress={p.onAgreement} style={styles.half} />
          <Button label="일정 보기" variant="secondary" onPress={p.onPlan} style={styles.half} />
        </View>
      </View>
    );
  }

  let title: string;
  let meta: string | null = null;
  let action: ReactNode = null;
  switch (p.step) {
    case "persona":
      title = "내 캐릭터 만들기";
      action = <Button label="성향 검사 시작" size="lg" onPress={p.onPersona} block />;
      break;
    case "waiting": {
      const names = p.actions.nudgeTargets;
      title = waitingTitle(names);
      meta = `${p.readyCount}/${p.total}명 준비`;
      if (names.length > 0) action = <Button label={names.length === 1 ? `${names[0]} 재촉하기` : "안 한 사람 재촉하기"} size="lg" onPress={p.onNudge} block />;
      break;
    }
    case "conditions":
      meta = `${p.total}명 준비`;
      if (p.actions.canStart) {
        title = "모두 준비됐어요";
        action = <Button label="회의 시작하기" size="lg" onPress={p.onConditions} block />;
      } else {
        title = "방장이 시작할 차례예요";
        action = <Button label="방장 재촉하기" size="lg" onPress={p.onNudge} block />;
      }
      break;
    case "meeting":
      title = "AI들이 회의하고 있어요";
      action = <Button label="AI 회의 보기" size="lg" onPress={p.onMeeting} block />;
      break;
  }

  return (
    <View style={styles.actionCard}>
      <View style={styles.actionHead}>
        <AppText variant="heading" accessibilityRole="header" style={styles.shrink}>
          {title}
        </AppText>
        {meta !== null && (
          <AppText variant="small" style={styles.actionMeta}>
            {meta}
          </AppText>
        )}
      </View>
      {action}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { paddingBottom: spacing.xl },
    body: { padding: spacing.md, gap: spacing.lg },
    bodyTop: { paddingTop: spacing.lg },
    listBody: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm + spacing.xs },
    bottomActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
    preview: { gap: spacing.sm },
    previewStage: { borderRadius: radius.lg, overflow: "hidden" },
    previewName: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
    start: { gap: spacing.md },
    startCardWrap: { paddingTop: 52 },
    peek: { position: "absolute", right: 28, top: 0 },
    startCard: {
      height: 176,
      borderRadius: 24,
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: t.colors.accent,
      backgroundColor: t.colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    startCardPressed: { transform: [{ scale: 0.98 }] },
    startPlus: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.colors.accent, alignItems: "center", justifyContent: "center" },
    startLink: { alignSelf: "center", minHeight: hitSize, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 6 },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.sm + spacing.xs,
      borderRadius: radius.md,
      backgroundColor: t.colors.surfaceSunken,
    },
    switchText: { flex: 1, gap: spacing.xxs },
    homeBody: { padding: spacing.md, gap: spacing.sm + spacing.xs },
    actionCard: {
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.md,
    },
    resultCard: { gap: 10 },
    resultPill: { alignSelf: "flex-start" },
    resultActions: { marginTop: 6 },
    actionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
    actionMeta: { fontWeight: "700", color: t.colors.textBody },
    inviteRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: radius.md,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
    },
    inviteText: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
    inviteCode: { letterSpacing: 1 },
    iconBtn: { width: hitSize, height: hitSize, alignItems: "center", justifyContent: "center" },
    actionRow: { flexDirection: "row", gap: spacing.sm },
    half: { flex: 1 },
    shrink: { flexShrink: 1 },
  });
