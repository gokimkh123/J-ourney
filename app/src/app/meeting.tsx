import { useRouter } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import {
  AgentStatusRow,
  AppText,
  BottomSheet,
  Button,
  CandidateRow,
  MeetingMap,
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
import { keepAgentsVisible, type Position } from "../lib/meeting/agentPositions.ts";
import { latestRoute } from "../lib/meeting/reducer.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { useMeetingPlayback } from "../lib/meeting/usePlayback.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { conditionsDates, conditionsSummary } from "../lib/trip/conditionsSummary.ts";
import { duration, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

type Tab = "ai" | "board" | "talk";

// 시트가 접히면 손잡이·제목 줄만 남는다. 펼치면 보이는 영역의 절반 가까이를 차지한다.
const SHEET_COLLAPSED = 78;
const SHEET_EXPANDED_RATIO = 0.5;
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
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [areaHeight, setAreaHeight] = useState(0);
  const onAreaLayout = (e: LayoutChangeEvent) => setAreaHeight(Math.round(e.nativeEvent.layout.height));
  const reduceMotion = useReducedMotion();
  // 시트 높이는 값으로 두고 부드럽게 바꾼다. 지도는 항상 전체 크기로 깔려 있어서 시트가 움직여도 그림은 그대로다.
  // 높이는 레이아웃 값이라 기본 Animated(네이티브 드라이버 없이)로 움직인다.
  const sheetHeight = useRef(new Animated.Value(0)).current;
  const sheetShown = useRef(false);
  const agentMemory = useRef(new Map<string, Position>());
  const expandedHeight = Math.round(areaHeight * SHEET_EXPANDED_RATIO);
  useEffect(() => {
    if (areaHeight <= 0) return;
    const target = sheetCollapsed ? SHEET_COLLAPSED : expandedHeight;
    // 처음 자리 잡을 때와 "움직임 줄이기" 설정일 때는 시간 0으로 바로 맞춘다.
    const instant = !sheetShown.current || reduceMotion;
    sheetShown.current = true;
    const run = Animated.timing(sheetHeight, {
      toValue: target,
      duration: instant ? 0 : duration.slow,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [areaHeight, sheetCollapsed, expandedHeight, reduceMotion, sheetHeight]);

  // 회의가 시작되면 대화 탭으로 옮겨 준다(그 뒤로는 사용자가 고른 탭을 그대로 둔다).
  const lastPhase = useRef(play.state.phase);
  useEffect(() => {
    if (lastPhase.current !== play.state.phase) {
      if (play.state.phase === "meeting") setTab("talk");
      lastPhase.current = play.state.phase;
    }
  }, [play.state.phase]);

  // 합의가 나오면 B3 화면이 읽을 수 있게 최종 상태를 내놓는다.
  useEffect(() => {
    if (play.status === "finished" && play.state.phase === "agreed") meetingResultStore.set(play.state);
  }, [play.status, play.state]);

  if (conditions === null) {
    return (
      <View style={styles.empty}>
        <AppText variant="title" align="center">
          회의 조건을 먼저 정해 주세요
        </AppText>
        <AppText variant="small" tone="muted" align="center">
          날짜와 예산을 정하면 AI들이 모여 회의를 시작해요.
        </AppText>
        <Button label="회의 조건 정하기" onPress={() => router.push("/conditions")} />
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
  const mapAgentList = keepAgentsVisible(mapAgents(state), state.agents, agentMemory.current);

  return (
    <View style={styles.screen}>
      <View style={styles.area} onLayout={onAreaLayout}>
        {areaHeight > 0 && (
          <>
            <MeetingMap
              art="busan"
              artView="full"
              bounds={boundsAround(mapPoints(state))}
              agents={mapAgentList}
              pins={mapPins(state)}
              routes={route.map((day) => ({ color: colors.accent, points: day.stops }))}
              bubble={currentBubble(state)}
              height={areaHeight}
              viewHeight={areaHeight - expandedHeight + SHEET_OVERLAP}
              accessibilityLabel={phaseLabel(state)}
            />
            <Animated.View style={[styles.sheetWrap, { height: sheetHeight }]}>
            <BottomSheet
              title={phaseLabel(state)}
              meta={`${play.applied}/${play.total}`}
              collapsed={sheetCollapsed}
              onCollapsedChange={setSheetCollapsed}
              style={styles.sheet}
            >
              <ScrollView nestedScrollEnabled style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
                <View>
                  <AppText variant="caption" tone="muted">
                    {conditionsDates(conditions)}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {conditionsSummary(conditions)}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    지금은 예시 회의(부산)를 보여 줘요. 서버가 연결되면 이 조건으로 회의해요.
                  </AppText>
                </View>
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
              </ScrollView>
            </BottomSheet>
            </Animated.View>
          </>
        )}
      </View>

      <View style={styles.controls}>
        {done ? (
          <>
            <Button label="다시 보기" variant="secondary" onPress={play.restart} style={styles.half} />
            {state.phase === "agreed" && (
              <Button label="합의안 보기" onPress={() => router.push("/agreement")} style={styles.half} />
            )}
          </>
        ) : (
          <>
            <Button
              label={playing ? "일시정지" : "계속"}
              variant="secondary"
              onPress={playing ? play.pause : play.resume}
              style={styles.half}
            />
            <Button label="건너뛰기" onPress={play.skipToEnd} style={styles.half} />
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
    controls: {
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: t.colors.surface,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    half: { flex: 1 },
    empty: {
      flex: 1,
      backgroundColor: t.colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.lg,
    },
  });
