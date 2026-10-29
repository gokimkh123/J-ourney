import { useRouter } from "expo-router";
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { AppText, MeetingMap, ScheduleItem, SegmentedTabs, StatusPill, boundsAround } from "../components/index.ts";
import { config } from "../lib/config/index.ts";
import { chosenPlanStore, dayOfKey, dayRows, routeDayTabs } from "../lib/plan/chosenPlan.ts";
import type { PlanStatus } from "../lib/plan/types.ts";
import { currentMembers, currentPlan } from "../lib/plan/current.ts";
import { placeKindOf } from "../lib/plan/placeKind.ts";
import { dayTabs, planSummary, scheduleRows } from "../lib/plan/view.ts";
import { dateLabel } from "../lib/trip/dateRange.ts";
import { spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

// 하루 일정이 동래~영도처럼 위아래로 길게 퍼져도 다 들어오는 높이
const MAP_HEIGHT = 360;

const STATUS: Record<PlanStatus, { label: string; tone: "warning" | "accent" | "success" }> = {
  voting: { label: "사람 확정 전", tone: "warning" },
  revising: { label: "수정 중", tone: "accent" },
  confirmed: { label: "확정됨", tone: "success" },
};

/** C1 합의 일정: 날짜별 지도와 시간표. 항목을 누르면 C2 근거 보기. 지금은 가짜 일정(부산)이다. */
function MockPlanScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const plan = currentPlan;
  const tabs = useMemo(() => dayTabs(plan), [plan]);
  const [tab, setTab] = useState(tabs[0]?.key ?? "");
  // 일차 버튼은 바로 바뀌고, 무거운 지도·목록은 한 박자 뒤에 바꾼다(누르자마자 반응하는 느낌을 위해).
  const shownTab = useDeferredValue(tab);
  const planDay = plan.days.find((d) => `day-${d.day}` === shownTab) ?? plan.days[0];
  const summary = planSummary(plan);

  if (planDay === undefined) {
    return (
      <View style={styles.empty}>
        <AppText variant="title" align="center">
          아직 일정이 없어요
        </AppText>
        <AppText variant="small" tone="muted" align="center">
          AI 회의가 끝나면 여기에 일정이 나와요.
        </AppText>
      </View>
    );
  }

  const rows = scheduleRows(plan, planDay.day, currentMembers);
  const points = planDay.items.map((item) => ({ lat: item.place.lat, lng: item.place.lng }));

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
      <MeetingMap
        art="busan"
        artView="fit"
        calm
        bounds={boundsAround(points)}
        pins={planDay.items.map((item, i) => ({
          id: item.id,
          name: item.title,
          lat: item.place.lat,
          lng: item.place.lng,
          color: currentMembers.find((m) => m.memberId === item.forMembers[0])?.color ?? colors.accent,
          label: String(i + 1),
          kind: placeKindOf(item.category),
        }))}
        routes={[{ color: colors.accent, points }]}
        height={MAP_HEIGHT}
        accessibilityLabel={`${planDay.day}일차 장소 ${planDay.items.length}곳 지도`}
      />

      <View style={styles.body}>
        <View style={styles.summary}>
          <View style={styles.pills}>
            <StatusPill label={STATUS[plan.status].label} tone={STATUS[plan.status].tone} />
            <StatusPill label="예시 데이터" />
          </View>
          <AppText variant="display" accessibilityRole="header">
            부산 {summary.dayCount}일
          </AppText>
          <AppText variant="small" tone="muted">
            {summary.itemCount}곳 · 1인 {summary.costLabel} ({summary.budgetLabel})
          </AppText>
        </View>

        <SegmentedTabs options={tabs} value={tab} onChange={setTab} accessibilityLabel="날짜 고르기" />
        <AppText variant="caption" tone="muted">
          {dateLabel(planDay.date)}
        </AppText>

        <View style={styles.list}>
          {rows.map((row) => {
            const item = planDay.items.find((i) => i.id === row.itemId);
            return (
              <ScheduleItem
                key={row.itemId}
                time={row.time}
                title={row.title}
                category={row.category}
                costLabel={row.costLabel}
                verified={row.verified}
                forMembers={row.forMembers}
                moveLabel={row.moveLabel}
                kind={placeKindOf(item?.category ?? "")}
                onPress={() => router.push({ pathname: "/place/[id]", params: { id: row.itemId } })}
              />
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

/** 실서버: 회의에서 사람이 고른 A·B 안의 날짜별 지도와 시간표. 시각은 앱이 이동 시간을 이어 붙여 짐작한 값이다. */
function LivePlanScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const chosen = useSyncExternalStore(chosenPlanStore.subscribe, chosenPlanStore.get, chosenPlanStore.get);
  const tabs = useMemo(() => (chosen === null ? [] : routeDayTabs(chosen.route)), [chosen]);
  const [tab, setTab] = useState("");

  if (chosen === null || tabs.length === 0) {
    return (
      <View style={styles.empty}>
        <AppText variant="title" align="center">
          아직 정한 일정이 없어요
        </AppText>
        <AppText variant="small" tone="muted" align="center">
          AI 회의에서 일정안을 고르면 여기에 나와요.
        </AppText>
      </View>
    );
  }

  const day = tabs.find((t) => t.key === tab)?.key ?? tabs[0]!.key;
  const rows = dayRows(chosen, dayOfKey(day), colors.accent);
  const date = chosen.route.find((d) => d.day === dayOfKey(day))?.date;
  const points = rows.map((r) => ({ lat: r.lat, lng: r.lng }));

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
      <MeetingMap
        art="busan"
        artView="fit"
        calm
        bounds={boundsAround(points)}
        pins={rows.map((r, i) => ({ id: r.itemId, name: r.title, lat: r.lat, lng: r.lng, color: r.color, label: String(i + 1), kind: r.kind }))}
        routes={[{ color: colors.accent, points }]}
        height={MAP_HEIGHT}
        accessibilityLabel={`${dayOfKey(day)}일차 장소 ${rows.length}곳 지도`}
      />

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <AppText variant="display" accessibilityRole="header">
            부산 {tabs.length}일
          </AppText>
        </View>

        <SegmentedTabs options={tabs} value={day} onChange={setTab} accessibilityLabel="날짜 고르기" />
        {date !== undefined && (
          <AppText variant="caption" tone="muted">
            {dateLabel(date)}
          </AppText>
        )}

        <View style={styles.list}>
          {rows.map((row) => (
            <ScheduleItem
              key={row.itemId}
              time={row.time}
              title={row.title}
              category={row.category}
              verified
              forMembers={row.forMembers}
              kind={row.kind}
              {...(row.moveLabel !== undefined && { moveLabel: row.moveLabel })}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

export default function PlanScreen() {
  return config.useMock ? <MockPlanScreen /> : <LivePlanScreen />;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { paddingBottom: spacing.lg },
    body: { padding: spacing.md, gap: spacing.md },
    summary: { gap: spacing.xxs },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.xs },
    list: { gap: spacing.xs },
    empty: {
      flex: 1,
      backgroundColor: t.colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.lg,
    },
  });
