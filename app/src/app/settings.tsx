import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";

import { AppText, Banner, Button, Card, SegmentedTabs } from "../components/index.ts";
import { api } from "../lib/api/index.ts";
import { ApiError } from "../lib/api/errors.ts";
import { checkHealth } from "../lib/api/health.ts";
import { config } from "../lib/config/index.ts";
import { leaveDeps } from "../lib/session/leaveDeps.ts";
import { deleteParty, leaveParty } from "../lib/session/leaveParty.ts";
import { partyInfo } from "../lib/session/partyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { themeMode } from "../lib/settings/index.ts";
import { useThemeMode } from "../lib/settings/useThemeMode.ts";
import type { ThemeMode } from "../lib/settings/themeMode.ts";
import { describeError } from "../lib/ui/format.ts";
import { spacing, useStyles, type Theme } from "../theme/index.ts";

const MODE_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: "system", label: "시스템" },
  { key: "light", label: "밝게" },
  { key: "dark", label: "다크" },
];

function InfoRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.infoRow}>
      <AppText variant="small" tone="muted">
        {label}
      </AppText>
      <AppText variant="smallStrong" style={styles.infoValue} selectable>
        {value}
      </AppText>
    </View>
  );
}

export default function SettingsScreen() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const mode = useThemeMode();
  const me = useSession();
  const [saveFailed, setSaveFailed] = useState(false);
  const [health, setHealth] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const onMode = (next: ThemeMode) => {
    setSaveFailed(false);
    themeMode.set(next).catch(() => setSaveFailed(true));
  };

  const doLeave = async () => {
    if (me !== null) {
      const isHost = partyInfo.get()[me.tripId]?.members.find((m) => m.id === me.memberId)?.isHost === true;
      await leaveParty(leaveDeps, me.tripId, isHost).catch(() => undefined);
    }
    router.replace("/");
  };

  const isHost = me !== null && partyInfo.get()[me.tripId]?.members.find((m) => m.id === me.memberId)?.isHost === true;

  // 방장은 나갈 수 없고 파티를 없앤다(v2.4). 회의가 도는 중이면 서버가 막는다.
  const onDelete = () => {
    if (me === null) return;
    Alert.alert("파티를 없앨까요?", "모든 구성원의 휴대폰에서 이 파티가 사라져요. 되돌릴 수 없어요.", [
      { text: "취소", style: "cancel" },
      {
        text: "없애기",
        style: "destructive",
        onPress: () => {
          deleteParty(leaveDeps, me.tripId)
            .then(() => router.replace("/"))
            .catch((e: unknown) =>
              Alert.alert(
                "파티를 없애지 못했어요",
                e instanceof ApiError && e.status === 409 ? "AI 회의가 진행 중이에요. 회의가 끝난 뒤 다시 해 주세요." : describeError(e),
              ),
            );
        },
      },
    ]);
  };

  const onLeave = () => {
    Alert.alert("파티에서 나갈까요?", "이 휴대폰에서 이 파티 정보가 지워져요. 같은 초대 코드로 다시 들어오면 새 구성원으로 참여해요.", [
      { text: "취소", style: "cancel" },
      { text: "나가기", style: "destructive", onPress: () => void doLeave() },
    ]);
  };

  const onCheck = async () => {
    setChecking(true);
    const result = await checkHealth(api);
    setHealth(result.ok ? `연결됨 (${result.latencyMs}ms)` : `연결 실패: ${result.error.message}`);
    setChecking(false);
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
      {saveFailed && <Banner tone="warning" text="설정을 저장하지 못했어요. 이번 실행 동안만 적용돼요." />}

      <Card title="화면 모드">
        <SegmentedTabs options={MODE_OPTIONS} value={mode} onChange={onMode} accessibilityLabel="화면 모드" />
        <AppText variant="caption" tone="muted">
          시스템을 고르면 휴대폰의 다크 모드 설정을 따라가요.
        </AppText>
      </Card>

      <Card title="내 정보">
        {me === null ? (
          <AppText variant="small" tone="muted">
            지금 들어가 있는 파티가 없어요. 홈에서 파티를 만들거나 초대 코드로 들어와 보세요.
          </AppText>
        ) : (
          <>
            <InfoRow label="닉네임" value={me.nickname} />
            <InfoRow label="초대 코드" value={me.inviteCode} />
            <Button label={isHost ? "파티 없애기" : "파티에서 나가기"} variant="secondary" onPress={isHost ? onDelete : onLeave} block />
          </>
        )}
      </Card>

      <Card title="앱 정보">
        <InfoRow label="버전" value={Constants.expoConfig?.version ?? "-"} />
      </Card>

      {__DEV__ && (
        <Card title="개발 정보">
          <InfoRow label="데이터" value={config.useMock ? "가짜 데이터" : "서버"} />
          {!config.useMock && <InfoRow label="서버 주소" value={config.apiBaseUrl} />}
          {config.warning !== null && (
            <AppText variant="caption" tone="warning">
              {config.warning}
            </AppText>
          )}
          <Button label="연결 확인" variant="secondary" size="sm" onPress={() => void onCheck()} loading={checking} />
          {health !== null && (
            <AppText variant="small" tone="muted">
              {health}
            </AppText>
          )}
        </Card>
      )}
    </ScrollView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
    infoValue: { flexShrink: 1, textAlign: "right" },
  });
