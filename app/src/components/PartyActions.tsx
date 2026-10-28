import { useRouter } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";

import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { useSession } from "../lib/session/useSession.ts";
import { usePartyInfos, useRefreshParty } from "../lib/session/usePartyInfo.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { homeActions } from "../lib/trip/homeActions.ts";
import { homeStep } from "../lib/trip/homeStep.ts";
import { usePolling } from "../lib/ui/usePolling.ts";
import { spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";
import Card from "./Card.tsx";

const POLL_MS = 3000;

/**
 * 내 성향 검사를 마친 뒤(회의 시작 전) 파티 안 화면 아래에 놓는 버튼 묶음.
 * 초대 코드 공유 · 안 한 사람 재촉하기 · 방장 재촉하기 · 회의 시작하기를 조건에 맞게 보여 준다.
 * 홈의 "지금 할 일"과 같은 규칙(homeStep·homeActions)을 쓰고, 조건이 아니면 아무것도 그리지 않는다.
 */
export default function PartyActions() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const me = useSession();
  const infos = usePartyInfos();
  const refreshOne = useRefreshParty();
  const conditions = useSyncExternalStore(conditionsStore.subscribe, conditionsStore.get, conditionsStore.get);
  const result = useSyncExternalStore(meetingResultStore.subscribe, meetingResultStore.get, meetingResultStore.get);

  const refresh = useCallback(async () => {
    if (me !== null) await refreshOne(me);
  }, [me, refreshOne]);
  usePolling(refresh, POLL_MS, me !== null, me?.inviteCode);

  if (me === null) return null;
  const info = infos[me.tripId] ?? null;
  const view = homeStep({
    members: info?.members ?? null,
    myMemberId: me.memberId,
    hasConditions: conditions !== null,
    hasResult: result !== null,
  });
  const actions = homeActions(info?.members ?? null, me.memberId, view.step);
  if (info === null || (view.step !== "waiting" && view.step !== "conditions")) return null;

  const onShare = async () => {
    try {
      await Share.share({ message: `${info.trip.title} 여행에 초대해요! 여행회의 앱에서 초대 코드 ${me.inviteCode}를 넣어 주세요.` });
    } catch {
      // 공유 창을 열지 못해도 화면은 그대로 둔다.
    }
  };
  // 알림 보내기는 서버 기능이 생기면 붙인다(docs/app/나중에_구현할_것.md). 지금은 버튼만 있다.
  const onNudge = () => Alert.alert("준비 중이에요", "재촉하기는 서버 알림 기능이 준비되면 열려요.");

  let title: string;
  let text: string;
  if (view.step === "waiting") {
    title = "친구들을 기다리고 있어요";
    text = `${view.readyCount}/${view.total}명이 준비됐어요. 모두 성향 검사를 마치면 회의를 시작할 수 있어요.`;
  } else if (actions.canStart) {
    title = "모두 준비됐어요";
    text = "날짜와 예산을 정하면 AI들이 회의를 시작해요.";
  } else {
    title = "방장이 시작할 차례예요";
    text = "모두 준비됐어요. 회의 조건과 시작은 방장만 할 수 있어요.";
  }

  return (
    <Card tone="accent" accessibilityLabel={`다음 할 일: ${title}`}>
      <AppText variant="caption" tone="accent">
        다음 할 일
      </AppText>
      <AppText variant="title">{title}</AppText>
      <AppText variant="small" tone="muted">
        {text}
      </AppText>
      <View style={styles.actions}>
        {view.step === "waiting" ? (
          <View style={styles.row}>
            {actions.canShare && <Button label="초대 코드 공유" variant="secondary" onPress={() => void onShare()} style={styles.half} />}
            {actions.nudgeTargets.length > 0 && <Button label="안 한 사람 재촉하기" onPress={onNudge} style={styles.half} />}
          </View>
        ) : (
          <>
            {actions.canStart ? (
              <Button label="회의 시작하기" onPress={() => router.push("/conditions")} block />
            ) : (
              <Button label="방장 재촉하기" onPress={onNudge} block />
            )}
            {actions.canShare && (
              <Button label="초대 코드 공유" variant="ghost" size="sm" onPress={() => void onShare()} block />
            )}
          </>
        )}
      </View>
    </Card>
  );
}

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    actions: { gap: spacing.xs, marginTop: spacing.sm },
    row: { flexDirection: "row", gap: spacing.sm },
    half: { flex: 1 },
  });
