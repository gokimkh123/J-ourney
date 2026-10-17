import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import {
  isSelectable,
  monthGrid,
  monthLabel,
  pickDate,
  shiftMonth,
  type DateRange,
  dateLabel,
} from "../lib/trip/dateRange.ts";
import { nightsLabel } from "../lib/ui/format.ts";
import { pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";

export type DateRangeCalendarProps = {
  visible: boolean;
  /** 열 때 보여 줄 처음 값 */
  initial: DateRange;
  /** 오늘(YYYY-MM-DD). 이전 날은 누를 수 없다. */
  today: string;
  onConfirm: (range: { start: string; end: string }) => void;
  onClose: () => void;
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 아래에서 올라오는 달력. 출발일을 누르고 도착일을 누른다(최대 7일). */
export default function DateRangeCalendar({ visible, initial, today, onConfirm, onClose }: DateRangeCalendarProps) {
  const styles = useStyles(createStyles);
  const startMonth = initial.start ?? today;
  const [range, setRange] = useState<DateRange>(initial);
  const [cursor, setCursor] = useState({ year: Number(startMonth.slice(0, 4)), month: Number(startMonth.slice(5, 7)) });

  const todayMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const atFirstMonth = cursor.year * 12 + cursor.month <= todayMonth.year * 12 + todayMonth.month;
  const complete = range.start !== null && range.end !== null;

  const summary =
    range.start === null
      ? "출발일을 눌러 주세요"
      : range.end === null
        ? `${dateLabel(range.start)} → 도착일을 눌러 주세요`
        : `${dateLabel(range.start)} → ${dateLabel(range.end)} · ${nightsLabel(range.start, range.end)}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="닫기" accessibilityRole="button" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <AppText variant="heading" accessibilityRole="header">
          언제 가나요
        </AppText>

        <View style={styles.monthRow}>
          <Pressable
            onPress={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))}
            disabled={atFirstMonth}
            accessibilityRole="button"
            accessibilityLabel="이전 달"
            style={({ pressed }) => [styles.nav, atFirstMonth && styles.off, pressed && { opacity: pressedOpacity }]}
          >
            <AppText variant="title">‹</AppText>
          </Pressable>
          <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
            {monthLabel(cursor.year, cursor.month)}
          </AppText>
          <Pressable
            onPress={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}
            accessibilityRole="button"
            accessibilityLabel="다음 달"
            style={({ pressed }) => [styles.nav, pressed && { opacity: pressedOpacity }]}
          >
            <AppText variant="title">›</AppText>
          </Pressable>
        </View>

        <View style={styles.week}>
          {WEEK.map((w) => (
            <AppText key={w} variant="caption" tone="muted" align="center" style={styles.cell}>
              {w}
            </AppText>
          ))}
        </View>

        <View>
          {monthGrid(cursor.year, cursor.month).map((week, i) => (
            <View key={i} style={styles.week}>
              {week.map((iso, j) => {
                if (iso === null) return <View key={j} style={styles.cell} />;
                const enabled = isSelectable(range, iso, today);
                const isStart = iso === range.start;
                const isEnd = iso === range.end;
                const inside = range.start !== null && range.end !== null && iso > range.start && iso < range.end;
                return (
                  <Pressable
                    key={j}
                    disabled={!enabled}
                    onPress={() => setRange(pickDate(range, iso))}
                    accessibilityRole="button"
                    accessibilityLabel={dateLabel(iso)}
                    accessibilityState={{ selected: isStart || isEnd, disabled: !enabled }}
                    style={[styles.cell, inside && styles.inside]}
                  >
                    <View style={[styles.day, (isStart || isEnd) && styles.picked]}>
                      <AppText
                        variant="body"
                        tone={isStart || isEnd ? "onAccent" : enabled ? "default" : "muted"}
                        style={!enabled && styles.off}
                      >
                        {Number(iso.slice(8))}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <AppText variant="small" tone="muted" style={styles.summary} accessibilityLiveRegion="polite">
          {summary}
        </AppText>
        <AppText variant="caption" tone="muted">
          여행은 최대 7일까지 고를 수 있어요.
        </AppText>
        <Button
          label="선택 완료"
          size="lg"
          block
          disabled={!complete}
          onPress={() => {
            if (range.start !== null && range.end !== null) onConfirm({ start: range.start, end: range.end });
          }}
        />
      </View>
    </Modal>
  );
}

const CELL = 44;

const createStyles = (t: Theme) =>
  StyleSheet.create({
    dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.colors.border,
      marginBottom: spacing.xs,
    },
    monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    nav: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    off: { opacity: 0.35 },
    week: { flexDirection: "row" },
    cell: { flex: 1, height: CELL, alignItems: "center", justifyContent: "center" },
    inside: { backgroundColor: t.colors.surfaceSunken },
    day: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
    picked: { backgroundColor: t.colors.accent },
    summary: { marginTop: spacing.xs },
  });
