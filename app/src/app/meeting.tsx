import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import {
  AgentStatusRow,
  AppText,
  Banner,
  BottomSheet,
  Button,
  CandidateRow,
  ConfirmSheet,
  ChatBubble,
  ChatDivider,
  ChoiceResult,
  ChoiceWaiting,
  MeetingMap,
  PlanChoice,
  PlayButton,
  ProgressBar,
  ReviewPanel,
  ReviewWaiting,
  SegmentedTabs,
  boundsAround,
  type PlaceKind,
} from "../components/index.ts";
import {
  agentRows,
  candidateRows,
  currentBubble,
  mapAgents,
  mapPins,
  mapPoints,
  phaseLabel,
  routeMapView,
  withOtherCandidates,
  speechFeed,
} from "../lib/meeting/view.ts";
import { usePinStage } from "../components/map/usePinStage.ts";
import { keepAgentsVisible, type Position } from "../lib/meeting/agentPositions.ts";
import { chatItems, myAgentIdOf } from "../lib/meeting/chatView.ts";
import { sheetLevelFor } from "../lib/meeting/sheetStage.ts";
import { meetingSpeed } from "../lib/meeting/speedStore.ts";
import { latestRoute } from "../lib/meeting/reducer.ts";
import type { RouteDay } from "../lib/meeting/types.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { onlyMeeting, startedMeetingStore } from "../lib/meeting/startedMeeting.ts";
import { meetingImmersive } from "../lib/meeting/stageStore.ts";
import { config } from "../lib/config/index.ts";
import { liveBanner, liveProgress } from "../lib/meeting/liveView.ts";
import { answeredLabel, itemNumber, reviewPeople, reviewPins, pickedCountLabel } from "../lib/meeting/reviewView.ts";
import { useLiveMeeting } from "../lib/meeting/useLiveMeeting.ts";
import { useMeetingPlayback, type MeetingPlayback } from "../lib/meeting/usePlayback.ts";
import { useReview } from "../lib/meeting/useReview.ts";
import { dayOfKey, stopKindOf } from "../lib/plan/chosenPlan.ts";
import { useServerChoice } from "../lib/plan/useServerChoice.ts";
import { usePartyInfos } from "../lib/session/usePartyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { leaveDeps } from "../lib/session/leaveDeps.ts";
import { dropDeletedParty } from "../lib/session/leaveParty.ts";
import { clampSheetHeight } from "../lib/ui/sheetSnap.ts";
import { settleLevel } from "../lib/ui/sheetLevels.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { conditionsDates, conditionsSummary } from "../lib/trip/conditionsSummary.ts";
import { duration, easing, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

type Tab = "ai" | "board" | "talk";

// 시트는 네 단계다. 접힘(손잡이·제목 줄만), 중간(처음 모습, 지도를 넓게 보여 줌), 펼침(목록을 길게 봄),
// 끝까지(11/3: 지도를 거의 덮고 목록만 봄, 위에 끄는 띠만큼만 지도가 남는다).
const SHEET_COLLAPSED = 96;
const SHEET_MID_RATIO = 0.34;
const SHEET_FULL_RATIO = 0.62;
const LEVEL_MID = 1;
// 시트 윗선 위로 끌 수 있는 투명한 띠의 높이(손잡이를 정확히 짚지 않아도 잡히게)
const SHEET_DRAG_EXTRA = 28;
const SHEET_OVERLAP = 22; // 시트 둥근 윗부분이 지도를 덮는 높이

/** B2 회의 진행: 지도 위 AI들이 움직이고, 아래 시트에서 조사·후보·대화를 본다. 지금은 가짜 회의(부산)를 재생한다. */
// 대화 탭에서 이만큼(px) 안쪽까지 내리면 맨 아래로 보고 새 말 따라가기를 다시 켠다.
const NEAR_BOTTOM = 60;

export default function MeetingScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const conditions = useSyncExternalStore(conditionsStore.subscribe, conditionsStore.get, conditionsStore.get);
  // 실서버면 서버가 보내는 이벤트를, 가짜 서버면 예시 회의(부산)를 재생한다.
  const live = !config.useMock;
  const me = useSession();
  const infos = usePartyInfos();
  const isHost = me !== null && (me.demo === true || infos[me.tripId]?.members.find((m) => m.id === me.memberId)?.isHost === true);
  const mock = useMeetingPlayback(!live && conditions !== null, conditions);
  // 실서버는 폰에 조건이 없어도(앱을 다시 켰거나 방장이 아니어도) 서버의 회의를 그대로 따라간다.
  const real = useLiveMeeting(live, me);
  // 이 폰에서 방금 시작한 회의가 있으면, 그 시작 이벤트가 올 때까지 옛 회의는 숨긴다.
  const startedMeetings = useSyncExternalStore(startedMeetingStore.subscribe, startedMeetingStore.get, startedMeetingStore.get);
  const liveState = onlyMeeting(real.state, me === null ? null : startedMeetings[me.tripId] ?? null);
  // 실서버 일시정지는 화면만 멈춘다(회의는 서버에서 계속). 멈춘 동안 쌓인 것은 "지금으로"로 건너뛸 수 있다.
  const liveStatus = liveProgress(real.feedStatus, liveState.phase);
  const play: MeetingPlayback = live
    ? {
        state: liveState,
        status: liveStatus === "playing" && real.paused ? "paused" : liveStatus,
        applied: liveState.lastSeq,
        total: 0,
        canSkip: real.paused,
        pause: real.pause,
        resume: real.resume,
        skipToEnd: real.skipToNow,
        restart() {},
      }
    : mock;
  const connectionNotice = live ? liveBanner(real.feedStatus) : null;
  // 방장이 파티를 없애 서버가 연결을 닫으면(v2.4, 4004) 이 폰에서도 빼고 처음 화면으로 간다.
  const deletedTripId = live && real.feedStatus === "deleted" ? me?.tripId ?? null : null;
  useEffect(() => {
    if (deletedTripId === null) return;
    void dropDeletedParty(leaveDeps, deletedTripId);
    Alert.alert("방장이 파티를 삭제했어요");
    router.replace("/");
  }, [deletedTripId, router]);
  const review = useReview(play.state, me, isHost);
  const hostMemberId = me === null ? null : me.demo === true ? me.memberId : (infos[me.tripId]?.members.find((m) => m.isHost)?.id ?? null);
  // 회의가 끝나면(실서버 전용, meeting.agreed) 시트가 바로 A·B 고르기 화면이 된다. 고르기·정하기는 서버 일정 표로 한다.
  const { view: choice } = useServerChoice(play.state, live && play.state.agreement !== null, me, isHost, hostMemberId, colors.accent);
  const [tab, setTab] = useState<Tab>("ai");
  const sheetScroll = useRef<ScrollView>(null);
  // 대화 탭이 새 말을 따라 내려갈지. 손가락으로 끌어 위를 볼 때만 끄고, 맨 아래로 돌아오면 다시 켠다.
  // (자동으로 내려가는 애니메이션 중의 스크롤 이벤트로는 바꾸지 않는다. 말이 빨리 오면 따라가기를 놓쳤다)
  const atBottom = useRef(true);
  const dragging = useRef(false);
  const flinging = useRef(false);
  const [unseen, setUnseen] = useState(0);
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const [level, setLevel] = useState(LEVEL_MID);
  const [areaHeight, setAreaHeight] = useState(0);
  const onAreaLayout = (e: LayoutChangeEvent) => setAreaHeight(Math.round(e.nativeEvent.layout.height));
  const reduceMotion = useReducedMotion();
  // 2배속 켜짐(아래쪽 빈 화면 return보다 앞에 둔다: 훅 개수가 렌더마다 같아야 한다)
  const speed = useSyncExternalStore(meetingSpeed.subscribe, meetingSpeed.get, meetingSpeed.get);
  // 시트 높이는 값으로 두고 부드럽게 바꾼다. 지도는 항상 전체 크기로 깔려 있어서 시트가 움직여도 그림은 그대로다.
  // 높이는 레이아웃 값이라 기본 Animated(네이티브 드라이버 없이)로 움직인다.
  const sheetHeight = useRef(new Animated.Value(0)).current;
  const sheetWrapHeight = useRef(Animated.add(sheetHeight, SHEET_DRAG_EXTRA)).current;
  const sheetShown = useRef(false);
  const sheetAnim = useRef<Animated.CompositeAnimation | null>(null);
  const sheetNow = useRef(0); // 지금 시트 높이(끄는 도중에도 알 수 있게 값 변화를 따라간다)
  const dragBase = useRef(0);
  const releaseVelocity = useRef(0);
  // 다음 높이 바꿈이 회의 단계 때문인가(그러면 천천히 옮긴다)
  const stageMove = useRef(false);
  const agentMemory = useRef(new Map<string, Position>());
  const midHeight = Math.round(areaHeight * SHEET_MID_RATIO);
  const fullHeight = Math.round(areaHeight * SHEET_FULL_RATIO);
  const topHeight = Math.max(fullHeight, areaHeight - SHEET_DRAG_EXTRA);
  const heights = [SHEET_COLLAPSED, midHeight, fullHeight, topHeight];
  useEffect(() => {
    const id = sheetHeight.addListener(({ value }) => {
      sheetNow.current = value;
    });
    return () => sheetHeight.removeListener(id);
  }, [sheetHeight]);

  // 목표 높이로 부드럽게 붙인다. 손을 뗄 때의 속도를 이어받아서 끌던 느낌 그대로 자리 잡는다.
  // 회의 단계가 바뀌어 앱이 옮길 때(gentle)는 손가락 속도가 없으니 천천히 미끄러지듯 옮긴다.
  const animateSheetTo = useCallback(
    (target: number, velocity: number, gentle = false) => {
      sheetAnim.current?.stop();
      if (reduceMotion) {
        sheetHeight.setValue(target);
        return;
      }
      const run = gentle
        ? Animated.timing(sheetHeight, {
            toValue: target,
            duration: duration.slow,
            easing: Easing.bezier(...easing.standard),
            useNativeDriver: false,
          })
        : Animated.spring(sheetHeight, {
            toValue: target,
            velocity,
            stiffness: 260,
            damping: 28,
            mass: 1,
            overshootClamping: true,
            useNativeDriver: false,
          });
      sheetAnim.current = run;
      run.start();
    },
    [reduceMotion, sheetHeight],
  );

  useEffect(() => {
    if (areaHeight <= 0) return;
    const target = heights[level] ?? midHeight;
    const velocity = releaseVelocity.current;
    releaseVelocity.current = 0;
    const gentle = stageMove.current;
    stageMove.current = false;
    // 처음 자리 잡을 때는 애니메이션 없이 바로 맞춘다.
    if (!sheetShown.current) {
      sheetShown.current = true;
      sheetHeight.setValue(target);
      return;
    }
    animateSheetTo(target, velocity, gentle);
    return () => sheetAnim.current?.stop();
  }, [areaHeight, level, midHeight, fullHeight, topHeight, animateSheetTo, sheetHeight]);

  const onSheetDragStart = useCallback(() => {
    sheetAnim.current?.stop();
    dragBase.current = sheetNow.current;
  }, []);
  const onSheetDragMove = useCallback(
    (dy: number) => {
      // 엄지를 따라 위아래로 움직이되, 접힌 높이와 펼친 높이를 벗어나지 않는다.
      sheetHeight.setValue(clampSheetHeight(dragBase.current - dy, SHEET_COLLAPSED, topHeight));
    },
    [topHeight, sheetHeight],
  );
  const onSheetDragEnd = useCallback(
    (_dy: number, vy: number) => {
      const next = settleLevel({ height: sheetNow.current, levels: heights, vy });
      // 위로 올리면 높이가 커지므로 손가락 속도(아래가 +)의 부호를 뒤집어 넘긴다. px/ms → px/ms 그대로.
      if (next === level) animateSheetTo(heights[next] ?? midHeight, -vy);
      else {
        releaseVelocity.current = -vy;
        setLevel(next);
      }
    },
    [animateSheetTo, heights, level, midHeight],
  );

  // 회의가 시작되면 대화 탭으로 옮겨 준다(그 뒤로는 사용자가 고른 탭을 그대로 둔다).
  const lastPhase = useRef(play.state.phase);
  useEffect(() => {
    if (lastPhase.current !== play.state.phase) {
      if (play.state.phase === "meeting") setTab("talk");
      // 단계가 바뀌는 ①조사 시작·③사람 확인·⑤동선 짜기·⑧A·B 고르기에서 시트 높이를 천천히 옮긴다(그 사이 직접 옮긴 높이는 다음 단계까지 그대로).
      const stageLevel = sheetLevelFor(lastPhase.current, play.state.phase, live);
      if (stageLevel !== null) {
        stageMove.current = true;
        setLevel(stageLevel);
      }
      lastPhase.current = play.state.phase;
    }
  }, [play.state.phase]);

  // 대화 탭을 열면 맨 아래(새 말)부터 보여 준다.
  useEffect(() => {
    if (tab !== "talk") return;
    atBottom.current = true;
    setUnseen(0);
    requestAnimationFrame(() => sheetScroll.current?.scrollToEnd({ animated: false }));
  }, [tab]);
  // 새 말이 왔을 때 위를 읽는 중이면 끌어내리지 않고 몇 개 왔는지만 센다(맨 아래면 onContentSizeChange가 내려 준다).
  const seenTalk = useRef(0);
  const talkCount = play.state.timeline.filter((t) => t.kind === "message").length;
  useEffect(() => {
    const added = talkCount - seenTalk.current;
    seenTalk.current = talkCount;
    if (added > 0 && tab === "talk" && !atBottom.current) setUnseen((n) => n + added);
  }, [talkCount, tab]);
  const isBottom = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    return contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
  };
  const followIfBottom = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    atBottom.current = isBottom(e);
    if (atBottom.current) setUnseen(0);
  };
  const onSheetScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (dragging.current) followIfBottom(e);
    else if (isBottom(e)) setUnseen(0);
  };
  const toNewest = () => {
    atBottom.current = true;
    setUnseen(0);
    sheetScroll.current?.scrollToEnd({ animated: true });
  };

  // 회의가 재생되는 동안만 탭바를 숨긴다. 일시정지·종료하거나 다른 화면으로 가면 다시 나온다.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const immersive = focused && play.status === "playing" && play.state.phase !== "reviewing";
  useEffect(() => {
    meetingImmersive.set(immersive);
    return () => meetingImmersive.set(false);
  }, [immersive]);

  // 합의가 나오면 B3 화면이 읽을 수 있게 최종 상태를 내놓는다. 실서버는 재생 끝이 없어 meeting.agreed를 받은 뒤부터 내놓는다.
  useEffect(() => {
    if (live ? play.state.agreement !== null : play.status === "finished" && play.state.phase === "agreed") meetingResultStore.set(play.state);
  }, [live, play.status, play.state]);

  // 조사 단계에서는 AI가 새 후보로 걸어가 핀을 꽂는다. 훅이라 아래 조기 반환보다 먼저 부른다.
  const pinStage = usePinStage({
    candidates: play.state.board.candidates,
    agents: keepAgentsVisible(mapAgents(play.state), play.state.agents, agentMemory.current),
    animate: play.state.phase === "researching",
  });

  if (!live && conditions === null) {
    return (
      <View style={styles.empty}>
        <AppText variant="title" align="center">
          회의 조건을 먼저 정해 주세요
        </AppText>
        <AppText variant="small" tone="muted" align="center">
          날짜와 예산을 정하면 AI들이 모여 회의를 시작해요.
        </AppText>
        <Button label="회의 조건 정하기" onPress={() => router.push("/conditions")} style={styles.emptyAction} />
      </View>
    );
  }

  const state = play.state;
  const agents = agentRows(state);
  const candidates = candidateRows(state);
  // 대화는 채팅처럼 오래된 말이 위, 내 AI(이 폰 주인)는 오른쪽.
  const feed = speechFeed(state);
  const chat = chatItems(feed, myAgentIdOf(state.agents, me?.memberId ?? null));
  const route = choice?.route ?? latestRoute(state);
  const playing = play.status === "playing";
  const done = play.status === "finished" || play.status === "error";
  const reviewing = live && state.phase === "reviewing" && state.review !== null;
  const reviewItems = state.review?.items ?? [];
  const kinds = stopKinds([...Object.values(state.plans).flatMap((p) => p.route), ...route]);
  const visiblePins = mapPins(state)
    .filter((pin) => pinStage.isVisible(pin.id))
    .map((pin) => ({ ...pin, kind: kinds.get(pin.id) ?? kinds.get(pin.name) ?? "pin" }));
  // 일정안 선을 그리는 동안은 스티커도 그 일정의 정류장으로 그려 모든 아이콘이 선으로 이어지게 한다(11/3).
  // A·B 고르기에서는 시트에서 보는 날만, 번호도 시트 목록과 같다. 일정안이 나온 뒤(고르기·정해짐)는 정류장만,
  // 회의 도중(라운드)에는 AI가 오가는 다른 후보도 번호 없이 남긴다.
  const planMap = !reviewing && route.length > 0 ? routeMapView(state, route, choice?.stage === "choose" ? dayOfKey(choice.day) : null) : null;
  const planOnly = choice !== null || state.phase === "proposed" || state.phase === "agreed" || state.phase === "confirming" || state.phase === "confirmed";
  const pins = reviewing
    ? reviewPins(visiblePins, reviewItems)
    : planMap === null
      ? visiblePins
      : planOnly
        ? planMap.pins
        : withOtherCandidates(planMap.pins, visiblePins);
  const mapRoutes =
    planMap === null ? route.map((day) => ({ color: colors.accent, points: day.stops })) : planMap.lines.map((points) => ({ color: colors.accent, points }));

  // 시트 제목 줄 오른쪽 버튼: 재생 중에는 건너뛰기(실서버는 멈춘 동안 "지금으로")·일시정지, 끝나면 다시 보기·합의안 보기.
  const controls = (
    <View style={styles.actions}>
      {play.canSkip && (
        <Pressable
          onPress={play.skipToEnd}
          accessibilityRole="button"
          accessibilityLabel={live ? "지금으로" : "건너뛰기"}
          accessibilityHint={live ? "멈춘 동안 쌓인 회의를 건너뛰고 지금 회의를 봐요" : "회의를 끝까지 넘겨 합의안을 봐요"}
          style={styles.textAction}
        >
          <AppText variant="smallStrong" tone="accent">
            {live ? "지금으로" : "건너뛰기"}
          </AppText>
        </Pressable>
      )}
      <Pressable
        onPress={() => meetingSpeed.set(speed === 2 ? 1 : 2)}
        accessibilityRole="button"
        accessibilityLabel="2배속"
        accessibilityState={{ selected: speed === 2 }}
        hitSlop={8}
        style={[styles.speed, speed === 2 && styles.speedOn]}
      >
        <AppText variant="smallStrong" tone={speed === 2 ? "default" : "muted"} style={speed === 2 ? styles.speedOnText : undefined}>
          2배속
        </AppText>
      </Pressable>
      <PlayButton playing={playing} onPress={playing ? play.pause : play.resume} />
    </View>
  );
  // 실서버는 AI들이 회의하는 동안만(사람 확인 중·끝난 뒤에는 없음)
  const liveControls = (play.status === "playing" || play.status === "paused") && !reviewing;
  const action = live ? (liveControls ? controls : undefined) : done ? (
    <View style={styles.actions}>
      <Pressable onPress={play.restart} accessibilityRole="button" style={styles.textAction}>
        <AppText variant="smallStrong" tone="accent">
          다시 보기
        </AppText>
      </Pressable>
      {state.phase === "agreed" && <Button label="합의안 보기" onPress={() => router.push("/agreement")} />}
    </View>
  ) : (
    controls
  );

  return (
    <View style={styles.screen}>
      <View style={styles.area} onLayout={onAreaLayout}>
        {areaHeight > 0 && (
          <>
            <MeetingMap
              art="busan"
              artView="full"
              calm
              bounds={boundsAround(mapPoints(state))}
              agents={pinStage.agents}
              pins={pins}
              routes={mapRoutes}
              bubble={currentBubble(state)}
              height={areaHeight}
              viewHeight={areaHeight - (heights[level] ?? midHeight) + SHEET_OVERLAP}
              accessibilityLabel={phaseLabel(state)}
              // 사람이 지도를 끌거나 확대하면 자동 카메라가 멈추고 이 버튼이 뜬다. 회의 단계가 바뀌면(사람 확인·A·B 고르기 등) 저절로 다시 따라간다.
              followLabel="회의 따라보기"
              followKey={state.phase}
              // 다른 탭에 있을 때는 캐릭터의 끝없는 움직임을 멈춘다(탭 화면은 떠 있어 일정 탭까지 끊겼다).
              paused={!focused}
            />
            <Animated.View style={[styles.sheetWrap, { height: sheetWrapHeight }]}>
            <BottomSheet
              title={phaseLabel(state)}
              meta={live ? `${real.paused ? "멈춤 · " : ""}후보 ${candidates.length} · 대화 ${feed.length}` : `${play.applied}/${play.total} · 후보 ${candidates.length} · 대화 ${feed.length}`}
              action={action}
              dragExtra={SHEET_DRAG_EXTRA}
              collapsed={level === 0}
              onCollapsedChange={(collapsed) => setLevel(collapsed ? 0 : LEVEL_MID)}
              onDragStart={onSheetDragStart}
              onDragMove={onSheetDragMove}
              onDragEnd={onSheetDragEnd}
              style={styles.sheet}
            >
              {connectionNotice !== null && <Banner tone="warning" text={connectionNotice} />}
              {!live && (
                <ProgressBar
                  value={play.total > 0 ? play.applied / play.total : 0}
                  size="sm"
                  accessibilityLabel={`회의 진행 ${play.applied}/${play.total}`}
                />
              )}
              {reviewing && !review.sent && (
                <ReviewPanel
                  items={reviewItems}
                  memos={state.review?.memos ?? []}
                  picks={review.picks}
                  onPick={review.pick}
                  countLabel={pickedCountLabel(reviewItems, review.picks)}
                  sendLabel={review.sendLabel}
                  canSend={review.canSend}
                  sending={review.submitting}
                  onSubmit={review.submit}
                  error={review.error}
                />
              )}
              {reviewing && review.sent && (
                <ReviewWaiting
                  countLabel={answeredLabel(state).short}
                  spokenCount={answeredLabel(state).spoken}
                  progress={(state.review?.total ?? 0) > 0 ? (state.review?.answered ?? 0) / (state.review?.total ?? 1) : 0}
                  people={reviewPeople(state)}
                  mine={reviewItems.map((item) => ({ number: itemNumber(reviewItems, item.placeId), name: item.name, keep: review.picks[item.placeId] === true }))}
                  onProceed={isHost ? review.proceed : undefined}
                  proceeding={review.proceeding}
                  error={review.error}
                />
              )}
              {choice?.stage === "choose" && (
                <PlanChoice
                  cards={choice.cards}
                  selected={choice.selected}
                  onSelect={choice.select}
                  people={choice.people}
                  dayTabs={choice.dayTabs}
                  day={choice.day}
                  onDay={choice.setDay}
                  notice={choice.notice}
                  stops={choice.stops}
                  onConfirm={choice.confirm}
                  sending={choice.sending}
                  error={choice.error}
                />
              )}
              {choice?.stage === "waiting" && (
                <ChoiceWaiting
                  cards={choice.cards}
                  mine={choice.mine}
                  onChange={choice.change}
                  people={choice.people}
                  onDecide={choice.decide}
                  sending={choice.sending}
                  error={choice.error}
                />
              )}
              {choice?.stage === "decided" && (
                <ChoiceResult
                  head={choice.result.head}
                  title={choice.result.title}
                  rows={choice.result.rows}
                  hostPick={choice.result.hostPick}
                  onNext={() => router.navigate("/plan")}
                />
              )}
              {!reviewing && choice === null && <View style={styles.sheetScroll}><ScrollView
                overScrollMode="never"
                ref={sheetScroll}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetContent}
                onScroll={onSheetScroll}
                scrollEventThrottle={64}
                onScrollBeginDrag={() => {
                  dragging.current = true;
                }}
                onScrollEndDrag={(e) => {
                  // 손을 뗀 자리로 정하고, 이어지는 관성 스크롤 끝에서 한 번 더 본다.
                  followIfBottom(e);
                  dragging.current = false;
                  flinging.current = true;
                }}
                onMomentumScrollEnd={(e) => {
                  if (flinging.current) followIfBottom(e);
                  flinging.current = false;
                }}
                onContentSizeChange={() => {
                  if (tab === "talk" && atBottom.current) sheetScroll.current?.scrollToEnd({ animated: true });
                }}
                onLayout={() => {
                  // 시트 높이가 바뀌어도 맨 아래를 보던 중이면 그대로 맨 아래
                  if (tab === "talk" && atBottom.current) sheetScroll.current?.scrollToEnd({ animated: false });
                }}
              >
                <SegmentedTabs<Tab>
                  options={[
                    { key: "ai", label: "AI" },
                    { key: "board", label: `후보 ${candidates.length}` },
                    { key: "talk", label: `대화 ${feed.length}` },
                  ]}
                  value={tab}
                  onChange={setTab}
                  accessibilityLabel="회의 보기"
                />
                <View style={tab === "talk" ? styles.chat : styles.list}>
                  {tab === "ai" &&
                    agents.map((row) => (
                      <AgentStatusRow
                        key={row.name}
                        name={row.name}
                        color={row.color}
                        chips={row.chips}
                        text={row.text}
                        statusLabel={row.statusLabel}
                        statusTone={row.statusTone}
                        active={row.active}
                      />
                    ))}
                  {tab === "board" &&
                    (candidates.length === 0 ? (
                      <AppText variant="small" tone="muted">
                        아직 후보가 없어요. AI들이 조사를 마치면 여기에 모여요.
                      </AppText>
                    ) : (
                      candidates.map((c) => (
                        <CandidateRow
                          key={c.placeId}
                          name={c.name}
                          proposerColor={c.proposerColor}
                          kind={c.kind}
                          order={c.order}
                          reactions={c.reactions}
                          expanded={openCandidate === c.placeId}
                          onPress={() => setOpenCandidate(openCandidate === c.placeId ? null : c.placeId)}
                        />
                      ))
                    ))}
                  {tab === "talk" &&
                    (feed.length === 0 ? (
                      <AppText variant="small" tone="muted">
                        회의가 시작되면 AI들의 이야기가 여기에 쌓여요.
                      </AppText>
                    ) : (
                      chat.map((item) =>
                        item.type === "divider" ? (
                          <ChatDivider key={item.key} label={item.label} />
                        ) : (
                          <ChatBubble key={item.key} mine={item.mine} text={item.text} name={item.name} face={item.face} />
                        ),
                      )
                    ))}
                </View>
                {tab !== "talk" && <View>
                  {conditions !== null && (
                    <AppText variant="caption" tone="muted">
                      {conditionsDates(conditions)} · {conditionsSummary(conditions)}
                    </AppText>
                  )}
                  {!live && (
                    <AppText variant="caption" tone="muted">
                      지금은 예시 회의(부산)를 보여 줘요. 서버가 연결되면 이 조건으로 회의해요.
                    </AppText>
                  )}
                </View>}
              </ScrollView>
              {tab === "talk" && unseen > 0 && (
                <Pressable onPress={toNewest} accessibilityRole="button" style={({ pressed }) => [styles.newChip, pressed && { opacity: 0.75 }]}>
                  <AppText variant="label" tone="onAccent">
                    새 말 {unseen}개 ↓
                  </AppText>
                </Pressable>
              )}
              </View>}
            </BottomSheet>
            </Animated.View>
          </>
        )}
      </View>
      {/* 방장 "기다리지 않고 진행하기" 확인(11/3: 시스템 창 대신 앱 모양 시트) */}
      <ConfirmSheet
        visible={review.proceedAsk !== null}
        title="지금 진행할까요?"
        message={review.proceedAsk ?? ""}
        confirmLabel="진행하기"
        cancelLabel="더 기다리기"
        onConfirm={review.confirmProceed}
        onCancel={review.cancelProceed}
      />
    </View>
  );
}

/** 지도 스티커 모양. 후보에는 분류가 없어서, 일정안 경로에 같은 장소(장소 번호나 이름)가 있으면 그 분류로 정한다. */
function stopKinds(days: RouteDay[]): Map<string, PlaceKind> {
  const kinds = new Map<string, PlaceKind>();
  for (const stop of days.flatMap((d) => d.stops)) {
    const kind = stopKindOf(stop);
    if (stop.placeId !== undefined) kinds.set(stop.placeId, kind);
    kinds.set(stop.name, kind);
  }
  return kinds;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    area: { flex: 1, backgroundColor: t.colors.mapSea },
    sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
    sheet: { flex: 1 },
    sheetScroll: { flexShrink: 1 },
    chat: { gap: spacing.xs + spacing.xxs },
    newChip: {
      position: "absolute",
      alignSelf: "center",
      bottom: spacing.sm,
      minHeight: 36,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      backgroundColor: t.colors.accent,
      boxShadow: t.elevation.float,
    },
    sheetContent: { gap: spacing.sm + spacing.xs, paddingBottom: spacing.sm },
    list: { gap: spacing.sm },
    actions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    textAction: { minHeight: 48, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center" },
    // 2배속 켜고 끄기: 꺼지면 테두리만, 켜지면 연한 메인 색(고르기 칩과 같은 모양)
    speed: {
      minHeight: 32,
      paddingHorizontal: spacing.sm + spacing.xs,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    speedOn: { backgroundColor: t.colors.accentSoft, borderColor: t.colors.accent },
    speedOnText: { color: t.colors.accentSoftText },
    emptyAction: { alignSelf: "center" },
    empty: {
      flex: 1,
      backgroundColor: t.colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.lg,
    },
  });
