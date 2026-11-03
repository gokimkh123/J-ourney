import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import {
  AppText,
  AvatarStack,
  Banner,
  BudgetSlider,
  Button,
  Chip,
  DateRangeCalendar,
  FormSheet,
  InlineField,
  SegmentedTabs,
  Stepper,
  TextListInput,
  TimeWheel,
} from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import { config } from "../lib/config/index.ts";
import type { InviteInfo } from "../lib/persona/types.ts";
import { session } from "../lib/session/index.ts";
import { putPartyInfo } from "../lib/session/partyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { DEFAULT_BUDGET } from "../lib/trip/budget.ts";
import {
  BOOKED_LIMITS,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_MIN_SATISFACTION,
  MAX_ROUNDS_RANGE,
  MIN_SATISFACTION_RANGE,
  validateConditions,
} from "../lib/trip/conditions.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { rememberStartedMeeting } from "../lib/meeting/startedMeeting.ts";
import { chosenPlanStore } from "../lib/plan/chosenPlan.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { addDays, dateLabel, nextSaturday, todayISO } from "../lib/trip/dateRange.ts";
import { describeError, formatWon, nightsLabel } from "../lib/ui/format.ts";
import { usePolling } from "../lib/ui/usePolling.ts";
import { hitSize, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

// 구성원 준비 상태를 다시 받는 간격(홈과 같음)
const INFO_POLL_MS = 3000;

// 11/2: 도보는 뺐다(여행 이동으로는 맞지 않음).
const TRANSPORTS = [
  { key: "자동차", label: "자동차" },
  { key: "대중교통", label: "대중교통" },
];

const LODGING = [
  { key: "no", label: "없어요" },
  { key: "yes", label: "있어요" },
] as const;

type TimeKey = "arrival" | "departure";
const TIME_TITLE: Record<TimeKey, string> = { arrival: "첫날 도착 시각", departure: "마지막 날 출발 시각" };
// 시각 고르기 창을 처음 열 때 가운데에 둘 값
const TIME_START: Record<TimeKey, string> = { arrival: "10:00", departure: "18:00" };

/** 비행기·기차 시각 칸. 비어 있으면 "없음", 누르면 시각 고르기 창. 값이 있으면 ✕로 지운다. */
function TimeBox({ label, value, onPress, onClear }: { label: string; value: string | null; onPress: () => void; onClear: () => void }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  // 칸 전체(시각 고르기)와 ✕(지우기)는 나란히 둔다. 버튼 안에 버튼을 넣지 않는다.
  return (
    <View style={styles.timeBox}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value ?? "없음"}, 바꾸려면 누르세요`}
        style={({ pressed }) => [styles.timeText, pressed && { opacity: pressedOpacity }]}
      >
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        <AppText variant={value === null ? "body" : "heading"} tone={value === null ? "muted" : "default"}>
          {value ?? "없음"}
        </AppText>
      </Pressable>
      {value !== null && (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={`${label} 지우기`}
          style={({ pressed }) => [styles.timeClear, pressed && { opacity: pressedOpacity }]}
        >
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M4 4l8 8M12 4l-8 8" stroke={colors.textMuted} strokeWidth={1.8} strokeLinecap="round" fill="none" />
          </Svg>
        </Pressable>
      )}
    </View>
  );
}

/** B1 회의 조건: 여행지·날짜·예산·이동수단과 AI 회의 규칙을 정하고 회의를 시작한다. */
export default function ConditionsScreen() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const me = useSession();
  const today = useMemo(() => todayISO(), []);

  // 다른 화면에 갔다 돌아와도 정해 둔 조건이 남아 있게 저장소에서 먼저 읽는다.
  const saved = conditionsStore.get();
  const [range, setRange] = useState(() => {
    if (saved !== null) return { start: saved.startDate, end: saved.endDate };
    const start = nextSaturday(today);
    return { start, end: addDays(start, 1) };
  });
  const [budget, setBudget] = useState(saved?.budgetPerPerson ?? DEFAULT_BUDGET);
  const [transport, setTransport] = useState(saved?.transport ?? "대중교통");
  const [minSatisfaction, setMinSatisfaction] = useState(saved?.rules.aiMinSatisfaction ?? DEFAULT_MIN_SATISFACTION);
  const [maxRounds, setMaxRounds] = useState(saved?.rules.maxRounds ?? DEFAULT_MAX_ROUNDS);
  // 이미 정해진 것(v2.4 방장 칸, 모두 선택)
  const [times, setTimes] = useState<Record<TimeKey, string | null>>({
    arrival: saved?.arrivalTime ?? null,
    departure: saved?.departureTime ?? null,
  });
  const [lodgingOn, setLodgingOn] = useState(saved?.bookedLodging !== undefined);
  const [lodging, setLodging] = useState(saved?.bookedLodging ?? "");
  const [bookedPlaces, setBookedPlaces] = useState<string[]>(saved?.bookedPlaces ?? []);
  const [timeSheet, setTimeSheet] = useState<{ key: TimeKey; value: string } | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // starting은 다시 그려진 뒤에야 바뀐다. 그 전에 한 번 더 눌러도 회의를 두 번 시작하지 않게 ref로 막는다.
  const inFlight = useRef(false);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const inviteCode = me?.inviteCode ?? null;

  // 구성원 준비 상태를 계속 새로 받는다(파티원이 나가거나 성향 검사를 마치면 "N명 모두 준비됐어요"가 바로 바뀐다).
  const refreshInfo = useCallback(async () => {
    if (inviteCode === null) return;
    try {
      const next = await endpoints.getInvite(inviteCode);
      if (session.getSession()?.inviteCode !== inviteCode) return;
      setInfo(next);
      putPartyInfo(next);
      setInfoError(null);
    } catch (error) {
      if (session.getSession()?.inviteCode === inviteCode) setInfoError(describeError(error));
    }
  }, [inviteCode]);
  usePolling(refreshInfo, INFO_POLL_MS, inviteCode !== null, inviteCode);

  const members = info?.members ?? [];
  const waiting = members.filter((m) => !m.personaReady);
  const ready = info !== null && members.length > 0 && waiting.length === 0;
  const readyText =
    info === null
      ? infoError ?? "구성원을 확인하는 중이에요"
      : ready
        ? `${members.length}명 모두 준비됐어요`
        : `${waiting.map((m) => m.nickname).join(", ")} 님이 성향 검사를 아직 안 했어요`;

  async function onStart() {
    if (inFlight.current) return;
    const result = validateConditions(
      {
        destination: "부산",
        startDate: range.start,
        endDate: range.end,
        budgetPerPerson: budget,
        transport,
        aiMinSatisfaction: minSatisfaction,
        maxRounds,
        arrivalTime: times.arrival,
        departureTime: times.departure,
        bookedLodging: lodgingOn ? lodging : null,
        bookedPlaces,
      },
      today,
    );
    if (!result.ok) {
      setErrorText(Object.values(result.errors)[0] ?? "조건을 다시 확인해 주세요.");
      return;
    }
    setErrorText(null);
    // 실서버에서는 조건을 저장하고 회의를 시작해야 이벤트가 흐른다. 가짜 서버는 회의 화면이 예시 회의를 재생한다.
    if (!config.useMock) {
      if (me === null) return;
      inFlight.current = true;
      setStarting(true);
      try {
        await endpoints.saveConditions(me.tripId, result.body);
        const started = await endpoints.startMeeting(me.tripId);
        rememberStartedMeeting(me.tripId, started.id);
      } catch (e) {
        setErrorText(describeError(e, "meeting"));
        setStarting(false);
        inFlight.current = false;
        return;
      }
      setStarting(false);
      inFlight.current = false;
    }
    // 새 조건으로 회의를 다시 하므로 이전 합의안은 지운다.
    meetingResultStore.set(null);
    chosenPlanStore.set(null);
    conditionsStore.set(result.body);
    router.replace("/meeting");
  }

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {errorText !== null && <Banner tone="danger" text={errorText} />}

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            어디로 가나요
          </AppText>
          <View style={styles.destination}>
            <AppText variant="display">부산</AppText>
            <Chip label="경상남도" size="sm" />
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            언제 가나요
          </AppText>
          <Pressable
            onPress={() => setCalendarOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${dateLabel(range.start)}부터 ${dateLabel(range.end)}까지, 바꾸려면 누르세요`}
            style={({ pressed }) => [styles.dates, pressed && { opacity: pressedOpacity }]}
          >
            <View style={styles.dateBox}>
              <AppText variant="bodyStrong">{dateLabel(range.start)}</AppText>
            </View>
            <AppText variant="body" tone="muted">
              →
            </AppText>
            <View style={styles.dateBox}>
              <AppText variant="bodyStrong">{dateLabel(range.end)}</AppText>
            </View>
          </Pressable>
          <AppText variant="caption" tone="muted">
            {nightsLabel(range.start, range.end)}
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            한 사람당 예산
          </AppText>
          <AppText variant="display" accessibilityLiveRegion="polite">
            {formatWon(budget)}
          </AppText>
          <BudgetSlider value={budget} onChange={setBudget} />
          <View style={styles.scaleRow}>
            <AppText variant="caption" tone="muted">
              1만 원
            </AppText>
            <AppText variant="caption" tone="muted">
              1,000만 원
            </AppText>
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            어떻게 이동하나요
          </AppText>
          <SegmentedTabs options={TRANSPORTS} value={transport} onChange={setTransport} accessibilityLabel="이동 수단" />
        </View>

        <View style={styles.groupHead}>
          <AppText variant="heading" accessibilityRole="header">
            이미 정해진 것
          </AppText>
          <AppText variant="small" tone="muted">
            있으면 AI가 맞춰 짜요
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            비행기·기차 시간
          </AppText>
          <View style={styles.times}>
            {(["arrival", "departure"] as const).map((key) => (
              <TimeBox
                key={key}
                label={key === "arrival" ? "첫날 도착" : "마지막 날 출발"}
                value={times[key]}
                onPress={() => setTimeSheet({ key, value: times[key] ?? TIME_START[key] })}
                onClear={() => setTimes((current) => ({ ...current, [key]: null }))}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            예약한 숙소
          </AppText>
          <SegmentedTabs
            options={[...LODGING]}
            value={lodgingOn ? "yes" : "no"}
            onChange={(key) => setLodgingOn(key === "yes")}
            accessibilityLabel="예약한 숙소"
          />
          {lodgingOn && (
            <InlineField
              value={lodging}
              onChangeText={setLodging}
              placeholder="예: 해운대 오션뷰 호텔"
              maxLength={BOOKED_LIMITS.nameMax}
              onClear={lodging === "" ? undefined : () => setLodging("")}
              accessibilityLabel="예약한 숙소 이름"
            />
          )}
        </View>

        <View style={styles.section}>
          <AppText variant="small" tone="muted">
            예약한 장소
          </AppText>
          <TextListInput
            values={bookedPlaces}
            onChange={setBookedPlaces}
            max={BOOKED_LIMITS.places}
            maxLength={BOOKED_LIMITS.nameMax}
            placeholder="예: 부산 아쿠아리움"
            addLabel="예약한 장소 추가"
            itemLabel="예약한 장소"
            startWithField={false}
          />
        </View>

        <View style={styles.rules}>
          <AppText variant="small" tone="muted">
            AI 회의 규칙
          </AppText>
          <Stepper
            label="최소 만족도"
            description="모두가 이 점수 이상이면 합의"
            value={minSatisfaction}
            unit="점"
            min={MIN_SATISFACTION_RANGE.min}
            max={MIN_SATISFACTION_RANGE.max}
            onChange={setMinSatisfaction}
          />
          <Stepper
            label="최대 라운드"
            description="넘으면 가장 가까운 안으로 정리"
            value={maxRounds}
            unit="회"
            min={MAX_ROUNDS_RANGE.min}
            max={MAX_ROUNDS_RANGE.max}
            onChange={setMaxRounds}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.readyRow} accessible accessibilityLabel={readyText}>
          {members.length > 0 && (
            <AvatarStack people={members.map((m) => ({ color: m.color, name: m.nickname }))} size="xs" />
          )}
          <AppText variant="small" tone={ready ? "default" : "muted"} style={styles.readyText}>
            {readyText}
          </AppText>
        </View>
        <Button label="회의 시작" size="lg" block disabled={!ready} loading={starting} onPress={() => void onStart()} />
      </View>

      <FormSheet visible={timeSheet !== null} title={timeSheet === null ? "" : TIME_TITLE[timeSheet.key]} onClose={() => setTimeSheet(null)}>
        {timeSheet !== null && (
          <>
            <TimeWheel value={timeSheet.value} onChange={(value) => setTimeSheet((current) => (current === null ? null : { ...current, value }))} />
            <View style={styles.sheetButtons}>
              <Button label="취소" variant="secondary" onPress={() => setTimeSheet(null)} style={styles.sheetCancel} />
              <Button
                label={`${timeSheet.value}으로 정하기`}
                onPress={() => {
                  setTimes((current) => ({ ...current, [timeSheet.key]: timeSheet.value }));
                  setTimeSheet(null);
                }}
                style={styles.sheetOk}
              />
            </View>
          </>
        )}
      </FormSheet>
      <DateRangeCalendar
        visible={calendarOpen}
        initial={range}
        today={today}
        onClose={() => setCalendarOpen(false)}
        onConfirm={(next) => {
          setRange(next);
          setCalendarOpen(false);
        }}
      />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
    section: {
      gap: spacing.sm,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    rules: { gap: spacing.sm },
    destination: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dates: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dateBox: {
      flex: 1,
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: t.colors.surfaceSunken,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.sm,
    },
    scaleRow: { flexDirection: "row", justifyContent: "space-between" },
    groupHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" },
    times: { flexDirection: "row", gap: spacing.sm },
    timeBox: {
      flex: 1,
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radius.md,
      backgroundColor: t.colors.surfaceSunken,
      paddingLeft: spacing.sm + spacing.xs,
    },
    timeText: { flex: 1, alignSelf: "stretch", justifyContent: "center", gap: 2, paddingVertical: spacing.sm },
    timeClear: { width: hitSize, height: hitSize, alignItems: "center", justifyContent: "center" },
    sheetButtons: { flexDirection: "row", gap: spacing.sm },
    sheetCancel: { flex: 1 },
    sheetOk: { flex: 2 },
    footer: {
      padding: spacing.md,
      gap: spacing.sm,
      backgroundColor: t.colors.background,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    readyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    readyText: { flex: 1 },
  });
