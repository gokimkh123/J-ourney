import { useRouter } from "expo-router";
import { useDeferredValue, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";

import {
  AppText,
  AvatarStack,
  Banner,
  Button,
  Chip,
  DraggableList,
  FormSheet,
  MeetingMap,
  ScheduleItem,
  SegmentedTabs,
  SheetOption,
  StatusPill,
  boundsAround,
  type DraggableItem,
} from "../components/index.ts";
import { config } from "../lib/config/index.ts";
import type { RouteDay } from "../lib/meeting/types.ts";
import type { MemberRef } from "../lib/meeting/view.ts";
import type { EditOptions } from "../lib/plan/board.ts";
import { categoryOf, chosenPlanStore, dayOfKey, dayRows, peopleOf, routeDayTabs, stopKindOf } from "../lib/plan/chosenPlan.ts";
import { addableSights, canEdit, dayIndexOf, historyRows, mealChoices, type HistoryRow } from "../lib/plan/editView.ts";
import {
  addSight,
  changeCount,
  createDraft,
  draftEdits,
  draftRows,
  dropRow,
  moveRow,
  removeRow,
  restoreRow,
  swapMeal,
  type DraftMark,
  type PlanDraft,
} from "../lib/plan/planDraft.ts";
import { usePlanEdit } from "../lib/plan/usePlanEdit.ts";
import type { PlanStatus } from "../lib/plan/types.ts";
import { currentMembers, currentPlan } from "../lib/plan/current.ts";
import { dayTabs, planSummary, scheduleRows } from "../lib/plan/view.ts";
import { usePartyInfos } from "../lib/session/usePartyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { placeKindOf } from "../lib/plan/placeKind.ts";
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

type Sheet = { type: "row"; key: string } | { type: "replace"; key: string } | { type: "add" } | { type: "history" };

const BADGE: Record<Exclude<DraftMark, null>, { label: string; tone: "accent" | "warning" | "danger" }> = {
  removed: { label: "뺌", tone: "danger" },
  added: { label: "넣음", tone: "accent" },
  moved: { label: "옮김", tone: "warning" },
  reordered: { label: "순서", tone: "warning" },
  swapped: { label: "바꿈", tone: "warning" },
};

/** 서버가 한 번에 받는 고치기 수 */
const MAX_EDITS = 10;

/**
 * 실서버: A·B 중 정해진 안의 날짜별 지도와 시간표. 시각은 앱이 이동 시간을 이어 붙여 짐작한 값이다.
 * 정해지면 끝이고(확정 투표 없음, 11/1 결정), 그 뒤로 누구나 고친다: 손잡이(≡)로 끌어 순서, 줄을 눌러 빼기·장소 변경·다른 날로, 장소 넣기. 고친 것은 이 폰에만 모였다가
 * 하나라도 있으면 아래에 "수정 확정"이 나오고, 누르면 한 번에 보낸다. 누가 무엇을 바꿨는지는 고친 기록에 남는다.
 */
function LivePlanScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const me = useSession();
  const infos = usePartyInfos();
  const chosen = useSyncExternalStore(chosenPlanStore.subscribe, chosenPlanStore.get, chosenPlanStore.get);
  // 일정 탭은 늘 떠 있으니, 회의가 끝나 서버가 일정 표를 연 뒤(여행 상태 voting 이후)나 이 폰에서 안을 정한 뒤에만 불러온다.
  const tripStatus = me === null ? undefined : infos[me.tripId]?.trip.status;
  const edit = usePlanEdit(me !== null && (chosen !== null || tripStatus === "voting" || tripStatus === "confirmed"), me?.tripId ?? null);
  const board = edit.flow.board;
  const [tab, setTab] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // 고친 것(초안). 처음 고칠 때 그때의 서버 일정으로 만든다.
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  // 줄을 끄는 동안에는 화면 스크롤을 멈춘다.
  const [dragging, setDragging] = useState(false);

  // 앱을 다시 켜서 이 폰에 정한 안이 없어도 서버 일정 표가 있으면 그것을 보여 준다.
  const route = board?.plan?.route ?? chosen?.route ?? null;
  const members: MemberRef[] = useMemo(() => {
    if (chosen !== null && chosen.members.length > 0) return chosen.members;
    const info = me === null ? undefined : infos[me.tripId];
    return (info?.members ?? []).map((m) => ({ memberId: m.id, name: m.nickname, color: m.color }));
  }, [chosen, infos, me]);
  const tabs = useMemo(() => (route === null ? [] : routeDayTabs(route)), [route]);
  const history = useMemo(() => (board === null ? [] : historyRows(board, members)), [board, members]);

  if (route === null || tabs.length === 0) {
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

  const busy = edit.flow.busy;
  const editable = canEdit(board) && !busy;
  const count = draft === null ? 0 : changeCount(draft);
  const editing = draft !== null && count > 0;
  // 고치는 사이 다른 사람이 먼저 고쳤으면(서버 일정 version이 바뀜) 보내지 않는다.
  const stale = editing && board?.plan !== undefined && board.plan !== null && board.plan.version !== draft.baseVersion;
  const shownRoute = draft?.route ?? route;
  const title = board?.candidates.find((c) => c.planId === board.plan?.planId)?.title ?? `부산 ${tabs.length}일`;
  const day = tabs.find((t) => t.key === tab)?.key ?? tabs[0]!.key;
  const dayIndex = dayIndexOf(shownRoute, dayOfKey(day));
  const rows = dayRows({ route, members }, dayOfKey(day), colors.accent);
  const date = route.find((d) => d.day === dayOfKey(day))?.date;
  const points = rows.map((r) => ({ lat: r.lat, lng: r.lng }));
  const notices = [
    ...(stale ? ["다른 사람이 먼저 고쳤어요. 바꾼 것은 최신 일정에 다시 해 주세요."] : []),
    ...(count > MAX_EDITS ? [`한 번에 ${MAX_EDITS}건까지 확정할 수 있어요`] : []),
    ...(edit.flow.notice !== null ? [edit.flow.notice] : []),
    ...edit.failures,
  ];

  // 고치기 한 번: 초안이 없으면 지금 서버 일정으로 만들고 바꾼다.
  const change = (fn: (d: PlanDraft) => PlanDraft) => {
    if (!editable || board?.plan == null) return;
    edit.clearFailures();
    // 바뀐 게 없는 초안은 버리고 지금 서버 일정으로 새로 만든다(그사이 다른 사람이 고쳤을 수 있다).
    setDraft((prev) => fn(prev !== null && changeCount(prev) > 0 ? prev : createDraft(board.plan!.route, board.plan!.version)));
    setSheet(null);
  };
  const openSheet = (next: Sheet) => {
    if (next.type !== "history") edit.loadOptions();
    setSheet(next);
  };
  const confirm = async () => {
    if (draft === null) return;
    // 고치기 시작할 때의 version을 같이 보내, 그 사이 다른 사람이 고쳤으면 서버가 막는다(409 PLAN_LOCKED).
    if (await edit.apply(draftEdits(draft), draft.baseVersion)) setDraft(null);
  };

  // 줄마다 할 수 있는 일. 고치기 전에는 지금 서버 일정으로 만든 빈 초안에서 읽는다.
  const actionRows = !editable || board?.plan == null ? [] : draftRows(editing ? draft : createDraft(board.plan.route, board.plan.version), dayIndex);
  // v2.4: 관광지·끼니 식당·옮겨 온 곳·넣은 곳을 끌어서 그날 순서를 정한다(점심은 저녁보다 앞).
  const draggableKeys = actionRows.filter((r) => r.canDrag).map((r) => r.key);
  const drop = (fromKey: string, targetKey: string) => {
    if (!draggableKeys.includes(fromKey) || !draggableKeys.includes(targetKey) || fromKey === targetKey) return;
    change((d) => dropRow(d, dayIndex, fromKey, targetKey));
  };
  const tappable = (key: string) => {
    const r = actionRows.find((x) => x.key === key);
    return r !== undefined && (r.canMove || r.canRemove || r.canSwap || r.canRestore);
  };
  const items: DraggableItem[] = editing
    ? draftRows(draft, dayIndex).map((row) => ({
        key: row.key,
        draggable: draggableKeys.includes(row.key),
        node: (
          <ScheduleItem
            title={row.name}
            category={row.originalName !== null ? `${row.stop !== null ? categoryOf(row.stop) : "식사"} · ${row.originalName} 대신` : row.stop !== null ? categoryOf(row.stop) : "관광"}
            verified
            forMembers={row.stop !== null ? peopleOf(row.stop, members) : []}
            kind={row.stop !== null ? stopKindOf(row.stop) : placeKindOf(row.added?.category ?? "")}
            struck={row.mark === "removed"}
            {...(row.mark !== null && { badge: BADGE[row.mark] })}
            {...(row.mark === "removed" && editable && { onMore: () => setDraft((d) => (d === null ? d : restoreRow(d, row.key))), moreLabel: "되돌리기" })}
            {...(tappable(row.key) && { onPress: () => openSheet({ type: "row", key: row.key }), pressHint: "빼기·장소 변경을 고릅니다" })}
          />
        ),
      }))
    : rows.map((row) => ({
        key: row.itemId,
        draggable: draggableKeys.includes(row.itemId),
        node: (
          <ScheduleItem
            time={row.time}
            title={row.title}
            category={row.category}
            verified
            forMembers={row.forMembers}
            kind={row.kind}
            {...(row.moveLabel !== undefined && { moveLabel: row.moveLabel })}
            {...(tappable(row.itemId) && { onPress: () => openSheet({ type: "row", key: row.itemId }), pressHint: "빼기·장소 변경을 고릅니다" })}
          />
        ),
      }));
  const list = (
    <DraggableList
      items={items}
      onDrop={drop}
      onDragging={setDragging}
      handleLabel={(key) => `${actionRows.find((r) => r.key === key)?.name ?? ""} 순서 바꾸기`}
    />
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragging}
        style={styles.screen}
        contentContainerStyle={[styles.scroll, editing && styles.scrollWithBar]}
      >
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
            <AppText variant="display" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
            {busy ? (
              <View style={styles.busy} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={colors.accent} />
                <AppText variant="label" tone="muted">
                  길 다시 찾는 중
                </AppText>
              </View>
            ) : (
              history.length > 0 && (
                <Button label={`고친 기록 ${history.length}`} variant="ghost" size="xs" onPress={() => setSheet({ type: "history" })} style={styles.titleAction} />
              )
            )}
          </View>

          <SegmentedTabs options={tabs} value={day} onChange={setTab} accessibilityLabel="날짜 고르기" />
          <View style={styles.dateRow}>
            <AppText variant="caption" tone="muted">
              {date !== undefined ? dateLabel(date) : ""}
            </AppText>
            {canEdit(board) && <Button label="＋ 장소 넣기" variant="secondary" size="xs" disabled={busy} onPress={() => openSheet({ type: "add" })} />}
          </View>

          {notices.map((text) => (
            <Banner key={text} text={text} />
          ))}

          <View style={[styles.list, busy && styles.dim]}>{list}</View>
        </View>
      </ScrollView>

      {editing && (
        <View style={styles.bar}>
          <Button label="수정 취소" variant="secondary" size="lg" disabled={busy} onPress={() => setDraft(null)} style={styles.barButton} />
          <Button
            label={`수정 확정 (${count}건)`}
            size="lg"
            loading={busy}
            disabled={stale || count > MAX_EDITS}
            onPress={() => void confirm()}
            style={styles.barButton}
          />
        </View>
      )}

      <PlanEditSheet
        sheet={sheet}
        draft={editing ? draft : board?.plan != null ? createDraft(board.plan.route, board.plan.version) : null}
        dayIndex={dayIndex}
        dayLabel={tabs.find((t) => t.key === day)?.label ?? ""}
        members={members}
        options={edit.options}
        optionsError={edit.optionsError}
        history={history}
        onChange={change}
        onOpen={openSheet}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

/** 일정 고치기 시트 하나: 줄을 누른 메뉴(관광지·식당), 장소 변경, 장소 넣기, 고친 기록. 고르면 초안에 담고 닫힌다(서버에는 "수정 확정" 때 보냄). */
function PlanEditSheet({
  sheet,
  draft,
  dayIndex,
  dayLabel,
  members,
  options,
  optionsError,
  history,
  onChange,
  onOpen,
  onClose,
}: {
  sheet: Sheet | null;
  draft: PlanDraft | null;
  dayIndex: number;
  dayLabel: string;
  members: MemberRef[];
  options: EditOptions | null;
  optionsError: string | null;
  history: HistoryRow[];
  onChange: (fn: (d: PlanDraft) => PlanDraft) => void;
  onOpen: (next: Sheet) => void;
  onClose: () => void;
}) {
  const styles = useStyles(createStyles);
  const loading = options === null && optionsError === null;
  const row =
    (sheet?.type === "row" || sheet?.type === "replace") && draft !== null
      ? draft.route.map((_, d) => draftRows(draft, d).find((r) => r.key === sheet.key)).find((r) => r !== undefined)
      : undefined;
  const mealLabel = row?.meal === "lunch" ? "점심" : row?.meal === "dinner" ? "저녁" : "식사";
  const replace = row !== undefined && (row.canSwap || (row.kind === "sight" && row.canRemove)) && (
    <SheetOption icon="⇆" label="장소 변경" onPress={() => onOpen({ type: "replace", key: row.key })} />
  );

  let title = "";
  let body: ReactNode = null;
  if (sheet?.type === "replace" && row !== undefined && row.kind === "food" && row.stop !== null) {
    // 식당: 그 끼니에 여는 식당 중에서 고른다
    const itemId = row.stop.itemId;
    title = `${mealLabel} · ${row.originalName ?? row.name} 대신`;
    body = (
      <View>
        {loading && <ActivityIndicator style={styles.loading} />}
        {optionsError !== null && <Banner text={optionsError} />}
        {options !== null &&
          mealChoices(options, itemId).map((m) => (
            <SheetOption key={m.placeId} label={m.name} right={m.detourLabel} onPress={() => onChange((d) => swapMeal(d, itemId, { placeId: m.placeId, name: m.name }))} />
          ))}
        <SheetOption label="아무 데나" onPress={() => onChange((d) => swapMeal(d, itemId, { placeId: null, name: null }))} />
      </View>
    );
  } else if (sheet?.type === "replace" && row !== undefined && row.kind === "sight") {
    // 관광지: 이 곳을 빼고 고른 곳을 같은 날에 넣는다(서버는 넣은 곳을 그날 관광지 맨 뒤에 둔다)
    title = `${row.name} 대신`;
    body = (
      <View>
        {loading && <ActivityIndicator style={styles.loading} />}
        {optionsError !== null && <Banner text={optionsError} />}
        {options !== null &&
          addableSights(options, row.dayIndex, members).map((s) => (
            <SheetOption
              key={s.placeId}
              label={s.name}
              disabled={s.closed}
              right={s.closed ? "이날 쉼" : s.likedBy.length > 0 ? <AvatarStack people={s.likedBy} size="xs" /> : undefined}
              onPress={() =>
                onChange((d) => addSight(removeRow(d, row.key), { placeId: s.placeId, name: s.name, lat: s.lat, lng: s.lng, category: s.category }, row.dayIndex))
              }
            />
          ))}
      </View>
    );
  } else if (row !== undefined && row.kind === "sight") {
    title = row.name;
    body = (
      <View>
        {row.canRestore && <SheetOption icon="↺" label="되돌리기" onPress={() => onChange((d) => restoreRow(d, row.key))} />}
        {replace}
        {row.canMove && draft !== null && (
          <View style={styles.moveDays}>
            <AppText variant="smallStrong" tone="muted">
              ⇄ 다른 날로
            </AppText>
            <View style={styles.chips}>
              {draft.route.map((d, index) =>
                index === row.dayIndex ? null : <Chip key={index} label={`${d.day}일차`} onPress={() => onChange((x) => moveRow(x, row.key, index))} />,
              )}
            </View>
          </View>
        )}
        {row.canRemove && <SheetOption icon="✕" label="빼기" danger onPress={() => onChange((d) => removeRow(d, row.key))} />}
      </View>
    );
  } else if (row !== undefined && row.kind === "food") {
    // 식사도 다른 줄과 같은 ⋯ 메뉴(되돌리기·장소 변경). 순서는 손잡이로 끌어 바꾸고(v2.4), 날짜는 못 바꾼다.
    title = `${mealLabel} · ${row.name}`;
    body = (
      <View>
        {row.canRestore && <SheetOption icon="↺" label="되돌리기" onPress={() => onChange((d) => restoreRow(d, row.key))} />}
        {replace}
      </View>
    );
  } else if (sheet?.type === "add") {
    title = `${dayLabel}에 넣기`;
    body = (
      <View>
        {loading && <ActivityIndicator style={styles.loading} />}
        {optionsError !== null && <Banner text={optionsError} />}
        {options !== null &&
          addableSights(options, dayIndex, members).map((s) => (
            <SheetOption
              key={s.placeId}
              label={s.name}
              disabled={s.closed}
              right={s.closed ? "이날 쉼" : s.likedBy.length > 0 ? <AvatarStack people={s.likedBy} size="xs" /> : undefined}
              onPress={() => onChange((d) => addSight(d, { placeId: s.placeId, name: s.name, lat: s.lat, lng: s.lng, category: s.category }, dayIndex))}
            />
          ))}
      </View>
    );
  } else if (sheet?.type === "history") {
    title = "고친 기록";
    body = (
      <View style={styles.history}>
        {history.map((h) => (
          <View key={h.key} style={styles.historyRow} accessible accessibilityLabel={`${h.who} ${h.when}, ${h.changes.join(", ")}`}>
            <AppText variant="caption" tone="muted">
              {h.who} · {h.when}
            </AppText>
            {h.changes.map((c) => (
              <AppText key={c} variant="body">
                {c}
              </AppText>
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <FormSheet visible={sheet !== null && body !== null} title={title} onClose={onClose}>
      {body}
    </FormSheet>
  );
}

export default function PlanScreen() {
  return config.useMock ? <MockPlanScreen /> : <LivePlanScreen />;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // 제목이 두 줄이 되어도 오른쪽 버튼은 첫 줄 가운데에 맞춘다(display 줄 높이 36, 작은 버튼 32)
    titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
    titleAction: { marginTop: (36 - 32) / 2 },
    title: { flex: 1, minWidth: 0 },
    busy: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 36 },
    dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32, marginTop: -spacing.xs },
    dim: { opacity: 0.45 },
    scrollWithBar: { paddingBottom: 96 },
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: t.colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
    barButton: { flex: 1, alignSelf: "stretch" },
    moveDays: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingLeft: spacing.lg + spacing.sm },
    loading: { paddingVertical: spacing.md },
    history: { gap: spacing.md },
    historyRow: { gap: spacing.xxs },
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
