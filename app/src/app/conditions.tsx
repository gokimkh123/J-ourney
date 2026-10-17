import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  AppText,
  AvatarStack,
  Banner,
  BudgetSlider,
  Button,
  Chip,
  DateRangeCalendar,
  SegmentedTabs,
  Stepper,
} from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import type { InviteInfo } from "../lib/persona/types.ts";
import { useSession } from "../lib/session/useSession.ts";
import { DEFAULT_BUDGET } from "../lib/trip/budget.ts";
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_MIN_SATISFACTION,
  MAX_ROUNDS_RANGE,
  MIN_SATISFACTION_RANGE,
  validateConditions,
} from "../lib/trip/conditions.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { addDays, dateLabel, nextSaturday, todayISO } from "../lib/trip/dateRange.ts";
import { describeError, formatWon, nightsLabel } from "../lib/ui/format.ts";
import { pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";

const TRANSPORTS = [
  { key: "자동차", label: "자동차" },
  { key: "대중교통", label: "대중교통" },
  { key: "도보", label: "도보" },
];

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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const inviteCode = me?.inviteCode ?? null;

  useFocusEffect(
    useCallback(() => {
      if (inviteCode === null) return;
      let alive = true;
      endpoints
        .getInvite(inviteCode)
        .then((next) => {
          if (!alive) return;
          setInfo(next);
          setInfoError(null);
        })
        .catch((error: unknown) => {
          if (alive) setInfoError(describeError(error));
        });
      return () => {
        alive = false;
      };
    }, [inviteCode]),
  );

  const members = info?.members ?? [];
  const waiting = members.filter((m) => !m.personaReady);
  const ready = info !== null && members.length > 0 && waiting.length === 0;
  const readyText =
    info === null
      ? infoError ?? "구성원을 확인하는 중이에요"
      : ready
        ? `${members.length}명 모두 준비됐어요`
        : `${waiting.map((m) => m.nickname).join(", ")} 님이 성향 검사를 아직 안 했어요`;

  function onStart() {
    const result = validateConditions(
      {
        destination: "부산",
        startDate: range.start,
        endDate: range.end,
        budgetPerPerson: budget,
        transport,
        aiMinSatisfaction: minSatisfaction,
        maxRounds,
      },
      today,
    );
    if (!result.ok) {
      setErrorText(Object.values(result.errors)[0] ?? "조건을 다시 확인해 주세요.");
      return;
    }
    setErrorText(null);
    conditionsStore.set(result.body);
    router.replace("/meeting");
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <Button label="회의 시작" size="lg" block disabled={!ready} onPress={onStart} />
      </View>

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
