import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { AppText, MeetingMap, ScheduleItem, SegmentedTabs, StatusPill, boundsAround } from "../components/index.ts";
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
export default function PlanScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const plan = currentPlan;
  const tabs = useMemo(() => dayTabs(plan), [plan]);
  const [tab, setTab] = useState(tabs[0]?.key ?? "");
  const planDay = plan.days.find((d) => `day-${d.day}` === tab) ?? plan.days[0];
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <MeetingMap
        art="busan"
        artView="fit"
        bounds={boundsAround(points)}
        pins={planDay.items.map((item, i) => ({
          id: item.id,
          name: item.title,
          lat: item.place.lat,
          lng: item.place.lng,
          color: currentMembers.find((m) => m.memberId === item.forMembers[0])?.color ?? colors.accent,
          label: String(i + 1),
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
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
