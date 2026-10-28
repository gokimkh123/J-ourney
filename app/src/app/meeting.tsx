import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import {
  AgentStatusRow,
  AppText,
  BottomSheet,
  Button,
  CandidateRow,
  MeetingMap,
  PlayButton,
  ProgressBar,
  SegmentedTabs,
  SpeechRow,
  boundsAround,
} from "../components/index.ts";
import {
  agentRows,
  candidateRows,
  currentBubble,
  mapAgents,
  mapPins,
  mapPoints,
  phaseLabel,
  speechFeed,
} from "../lib/meeting/view.ts";
import { usePinStage } from "../components/map/usePinStage.ts";
import { keepAgentsVisible, type Position } from "../lib/meeting/agentPositions.ts";
import { latestRoute } from "../lib/meeting/reducer.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { meetingImmersive } from "../lib/meeting/stageStore.ts";
import { useMeetingPlayback } from "../lib/meeting/usePlayback.ts";
import { clampSheetHeight } from "../lib/ui/sheetSnap.ts";
import { settleLevel } from "../lib/ui/sheetLevels.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { conditionsDates, conditionsSummary } from "../lib/trip/conditionsSummary.ts";
import { spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

type Tab = "ai" | "board" | "talk";

// 시트는 세 단계다. 접힘(손잡이·제목 줄만), 중간(처음 모습, 지도를 넓게 보여 줌), 펼침(목록을 길게 봄).
const SHEET_COLLAPSED = 96;
const SHEET_MID_RATIO = 0.34;
const SHEET_FULL_RATIO = 0.62;
const LEVEL_MID = 1;
// 시트 윗선 위로 끌 수 있는 투명한 띠의 높이(손잡이를 정확히 짚지 않아도 잡히게)
const SHEET_DRAG_EXTRA = 28;
const SHEET_OVERLAP = 22; // 시트 둥근 윗부분이 지도를 덮는 높이

/** B2 회의 진행: 지도 위 AI들이 움직이고, 아래 시트에서 조사·후보·대화를 본다. 지금은 가짜 회의(부산)를 재생한다. */
export default function MeetingScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const conditions = useSyncExternalStore(conditionsStore.subscribe, conditionsStore.get, conditionsStore.get);
  const play = useMeetingPlayback(conditions !== null, conditions);
  const [tab, setTab] = useState<Tab>("ai");
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const [level, setLevel] = useState(LEVEL_MID);
  const [areaHeight, setAreaHeight] = useState(0);
  const onAreaLayout = (e: LayoutChangeEvent) => setAreaHeight(Math.round(e.nativeEvent.layout.height));
  const reduceMotion = useReducedMotion();
  // 시트 높이는 값으로 두고 부드럽게 바꾼다. 지도는 항상 전체 크기로 깔려 있어서 시트가 움직여도 그림은 그대로다.
  // 높이는 레이아웃 값이라 기본 Animated(네이티브 드라이버 없이)로 움직인다.
  const sheetHeight = useRef(new Animated.Value(0)).current;
  const sheetWrapHeight = useRef(Animated.add(sheetHeight, SHEET_DRAG_EXTRA)).current;
  const sheetShown = useRef(false);
  const sheetAnim = useRef<Animated.CompositeAnimation | null>(null);
  const sheetNow = useRef(0); // 지금 시트 높이(끄는 도중에도 알 수 있게 값 변화를 따라간다)
  const dragBase = useRef(0);
  const releaseVelocity = useRef(0);
  const agentMemory = useRef(new Map<string, Position>());
  const midHeight = Math.round(areaHeight * SHEET_MID_RATIO);
  const fullHeight = Math.round(areaHeight * SHEET_FULL_RATIO);
  useEffect(() => {
    const id = sheetHeight.addListener(({ value }) => {
      sheetNow.current = value;
    });
    return () => sheetHeight.removeListener(id);
  }, [sheetHeight]);

  // 목표 높이로 부드럽게 붙인다. 손을 뗄 때의 속도를 이어받아서 끌던 느낌 그대로 자리 잡는다.
  const animateSheetTo = useCallback(
    (target: number, velocity: number) => {
      sheetAnim.current?.stop();
      if (reduceMotion) {
        sheetHeight.setValue(target);
        return;
      }
      const run = Animated.spring(sheetHeight, {
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
    const target = [SHEET_COLLAPSED, midHeight, fullHeight][level];
    const velocity = releaseVelocity.current;
    releaseVelocity.current = 0;
    // 처음 자리 잡을 때는 애니메이션 없이 바로 맞춘다.
    if (!sheetShown.current) {
      sheetShown.current = true;
      sheetHeight.setValue(target);
      return;
    }
    animateSheetTo(target, velocity);
    return () => sheetAnim.current?.stop();
  }, [areaHeight, level, midHeight, fullHeight, animateSheetTo, sheetHeight]);

  const onSheetDragStart = useCallback(() => {
    sheetAnim.current?.stop();
    dragBase.current = sheetNow.current;
  }, []);
  const onSheetDragMove = useCallback(
    (dy: number) => {
      // 엄지를 따라 위아래로 움직이되, 접힌 높이와 펼친 높이를 벗어나지 않는다.
      sheetHeight.setValue(clampSheetHeight(dragBase.current - dy, SHEET_COLLAPSED, fullHeight));
    },
    [fullHeight, sheetHeight],
  );
  const onSheetDragEnd = useCallback(
    (_dy: number, vy: number) => {
      const heights = [SHEET_COLLAPSED, midHeight, fullHeight];
      const next = settleLevel({ height: sheetNow.current, levels: heights, vy });
      // 위로 올리면 높이가 커지므로 손가락 속도(아래가 +)의 부호를 뒤집어 넘긴다. px/ms → px/ms 그대로.
      if (next === level) animateSheetTo(heights[next], -vy);
      else {
        releaseVelocity.current = -vy;
        setLevel(next);
      }
    },
    [animateSheetTo, fullHeight, level, midHeight],
  );

  // 회의가 시작되면 대화 탭으로 옮겨 준다(그 뒤로는 사용자가 고른 탭을 그대로 둔다).
  const lastPhase = useRef(play.state.phase);
  useEffect(() => {
    if (lastPhase.current !== play.state.phase) {
      if (play.state.phase === "meeting") setTab("talk");
      lastPhase.current = play.state.phase;
    }
  }, [play.state.phase]);

  // 회의가 재생되는 동안만 탭바를 숨긴다. 일시정지·종료하거나 다른 화면으로 가면 다시 나온다.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const immersive = focused && play.status === "playing";
  useEffect(() => {
    meetingImmersive.set(immersive);
    return () => meetingImmersive.set(false);
  }, [immersive]);

  // 합의가 나오면 B3 화면이 읽을 수 있게 최종 상태를 내놓는다.
  useEffect(() => {
    if (play.status === "finished" && play.state.phase === "agreed") meetingResultStore.set(play.state);
  }, [play.status, play.state]);

  // 조사 단계에서는 AI가 새 후보로 걸어가 핀을 꽂는다. 훅이라 아래 조기 반환보다 먼저 부른다.
  const pinStage = usePinStage({
    candidates: play.state.board.candidates,
    agents: keepAgentsVisible(mapAgents(play.state), play.state.agents, agentMemory.current),
    animate: play.state.phase === "researching",
  });

  if (conditions === null) {
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
  const feed = [...speechFeed(state)].reverse();
  const route = latestRoute(state);
  const playing = play.status === "playing";
  const done = play.status === "finished" || play.status === "error";

  // 시트 제목 줄 오른쪽 버튼: 재생 중에는 건너뛰기·일시정지, 끝나면 다시 보기·합의안 보기.
  const action = done ? (
    <View style={styles.actions}>
      <Pressable onPress={play.restart} accessibilityRole="button" style={styles.textAction}>
        <AppText variant="smallStrong" tone="accent">
          다시 보기
        </AppText>
      </Pressable>
      {state.phase === "agreed" && <Button label="합의안 보기" onPress={() => router.push("/agreement")} />}
    </View>
  ) : (
    <View style={styles.actions}>
      {play.canSkip && (
        <Pressable
          onPress={play.skipToEnd}
          accessibilityRole="button"
          accessibilityLabel="건너뛰기"
          accessibilityHint="회의를 끝까지 넘겨 합의안을 봐요"
          style={styles.textAction}
        >
          <AppText variant="smallStrong" tone="accent">
            건너뛰기
          </AppText>
        </Pressable>
      )}
      <PlayButton playing={playing} onPress={playing ? play.pause : play.resume} />
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.area} onLayout={onAreaLayout}>
        {areaHeight > 0 && (
          <>
            <MeetingMap
              art="busan"
              artView="full"
              bounds={boundsAround(mapPoints(state))}
              agents={pinStage.agents}
              pins={mapPins(state).filter((pin) => pinStage.isVisible(pin.id))}
              routes={route.map((day) => ({ color: colors.accent, points: day.stops }))}
              bubble={currentBubble(state)}
              height={areaHeight}
              viewHeight={areaHeight - midHeight + SHEET_OVERLAP}
              accessibilityLabel={phaseLabel(state)}
            />
            <Animated.View style={[styles.sheetWrap, { height: sheetWrapHeight }]}>
            <BottomSheet
              title={phaseLabel(state)}
              meta={`${play.applied}/${play.total} · 후보 ${candidates.length} · 대화 ${feed.length}`}
              action={action}
              dragExtra={SHEET_DRAG_EXTRA}
              collapsed={level === 0}
              onCollapsedChange={(collapsed) => setLevel(collapsed ? 0 : LEVEL_MID)}
              onDragStart={onSheetDragStart}
              onDragMove={onSheetDragMove}
              onDragEnd={onSheetDragEnd}
              style={styles.sheet}
            >
              <ProgressBar
                value={play.total > 0 ? play.applied / play.total : 0}
                size="sm"
                accessibilityLabel={`회의 진행 ${play.applied}/${play.total}`}
              />
              <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
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
                <View style={styles.list}>
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
                      feed.map((m) => (
                        <SpeechRow key={m.seq} name={m.name} color={m.color} chips={m.chips} text={m.text} meta={m.meta} />
                      ))
                    ))}
                </View>
                <View>
                  <AppText variant="caption" tone="muted">
                    {conditionsDates(conditions)} · {conditionsSummary(conditions)}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    지금은 예시 회의(부산)를 보여 줘요. 서버가 연결되면 이 조건으로 회의해요.
                  </AppText>
                </View>
              </ScrollView>
            </BottomSheet>
            </Animated.View>
          </>
        )}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    area: { flex: 1, backgroundColor: t.colors.mapSea },
    sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
    sheet: { flex: 1 },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { gap: spacing.sm + spacing.xs, paddingBottom: spacing.sm },
    list: { gap: spacing.sm },
    actions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    textAction: { minHeight: 48, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center" },
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
