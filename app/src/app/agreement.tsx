import { useRouter } from "expo-router";
import { useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import {
  AppText,
  Button,
  ConcessionRow,
  MemberBand,
  SatisfactionRow,
  StatGroup,
} from "../components/index.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { agreementView } from "../lib/meeting/view.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { spacing, useStyles, type Theme } from "../theme/index.ts";

/** B3 AI 합의안: 합의가 끝났을 때 걸린 시간, 만족도, 서로 양보한 것을 보여 주고 일정으로 넘어간다. */
export default function AgreementScreen() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const state = useSyncExternalStore(meetingResultStore.subscribe, meetingResultStore.get, meetingResultStore.get);
  const conditions = useSyncExternalStore(conditionsStore.subscribe, conditionsStore.get, conditionsStore.get);
  const view = state === null ? null : agreementView(state);

  if (state === null || view === null) {
    return (
      <View style={styles.empty}>
        <AppText variant="title" align="center">
          아직 합의안이 없어요
        </AppText>
        <AppText variant="small" tone="muted" align="center">
          AI 회의가 끝나면 여기에서 결과를 볼 수 있어요.
        </AppText>
        <Button label="AI 회의로 가기" onPress={() => router.replace("/meeting")} />
      </View>
    );
  }

  const threshold = conditions?.rules.aiMinSatisfaction;
  const [time, ...stats] = view.stats;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <MemberBand members={state.agents.map((a) => ({ id: a.agentId, name: a.nickname, color: a.color, chips: a.chips }))} />

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <AppText variant="display" accessibilityRole="header">
              합의했어요
            </AppText>
            {time !== undefined && (
              <AppText variant="small" tone="muted">
                {time.value} 걸렸어요
              </AppText>
            )}
          </View>

          <StatGroup items={stats} />

          <View style={styles.section}>
            <AppText variant="heading" accessibilityRole="header">
              만족도
            </AppText>
            {view.satisfaction.map((s) => (
              <SatisfactionRow key={s.name} name={s.name} color={s.color} score={s.score} threshold={threshold} />
            ))}
          </View>

          {view.concessions.length > 0 && (
            <View style={styles.section}>
              <AppText variant="heading" accessibilityRole="header">
                서로 양보한 것
              </AppText>
              {view.concessions.map((c) => (
                <ConcessionRow key={`${c.name}-${c.gave}`} name={c.name} color={c.color} gave={c.gave} got={c.got} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="조건 바꾸기" variant="secondary" onPress={() => router.push("/conditions")} style={styles.half} />
        <Button label="일정 보기" onPress={() => router.push("/plan")} style={styles.half} />
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { paddingBottom: spacing.lg },
    body: { padding: spacing.md, gap: spacing.md },
    titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
    section: { gap: spacing.sm },
    footer: {
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
