import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, ScrollView, StyleSheet, View } from "react-native";

import { AppText, Button, InfoList, PlaceSticker, SpeechRow, StatusPill } from "../../components/index.ts";
import { currentMembers, currentPlan } from "../../lib/plan/current.ts";
import { placeKindOf } from "../../lib/plan/placeKind.ts";
import { placeEvidenceRows } from "../../lib/plan/evidence.ts";
import { findItem, placeDetail } from "../../lib/plan/view.ts";
import { spacing, useStyles, type Theme } from "../../theme/index.ts";

/** C2 근거 보기: 이 장소를 왜 골랐는지(구성원별 이유)와 주소·영업시간 등 장소 정보. */
export default function PlaceScreen() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = typeof id === "string" ? id : "";
  const detail = placeDetail(currentPlan, itemId, currentMembers);
  const item = findItem(currentPlan, itemId);

  if (detail === null || item === undefined) {
    return (
      <View style={styles.empty}>
        <AppText variant="title" align="center">
          장소를 찾지 못했어요
        </AppText>
        <Button label="일정으로 돌아가기" onPress={() => router.replace("/plan")} style={styles.emptyAction} />
      </View>
    );
  }

  const address = item.place.address;
  // 지도 앱·브라우저를 못 열면 주소라도 보여 줘서 직접 찾을 수 있게 한다.
  const openMap = (url: string) => {
    Linking.openURL(url).catch(() => Alert.alert("지도를 열 수 없어요", `주소: ${address}`));
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll}>
      <Stack.Screen options={{ title: detail.title }} />
      <View style={styles.head}>
        <PlaceSticker kind={placeKindOf(item.category)} size={48} />
        <View style={styles.headText}>
          <AppText variant="title" accessibilityRole="header">
            {detail.title}
          </AppText>
          <View style={styles.sub}>
            <AppText variant="small" tone="muted">
              {detail.category} · {detail.costLabel}
            </AppText>
            {!detail.verified && <StatusPill label="지도 확인 필요" tone="warning" />}
          </View>
        </View>
      </View>
      {!detail.verified && (
        <AppText variant="small" tone="muted">
          지도에서 위치를 확인하지 못한 장소예요. 가기 전에 지도에서 한 번 더 찾아봐 주세요.
        </AppText>
      )}

      {detail.reasons.length > 0 && (
        <View style={styles.section}>
          <AppText variant="heading" accessibilityRole="header">
            이 장소를 고른 이유
          </AppText>
          {detail.reasons.map((r) => (
            <SpeechRow key={`${r.name}-${r.text}`} name={r.name} color={r.color} text={r.text} />
          ))}
        </View>
      )}

      <View style={styles.section}>
        <AppText variant="heading" accessibilityRole="header">
          장소 정보
        </AppText>
        <InfoList rows={[...detail.rows, ...placeEvidenceRows(item.place)]} />
      </View>

      <View style={styles.links}>
        <Button label="카카오맵에서 찾기" variant="secondary" onPress={() => openMap(detail.kakaoMapUrl)} style={styles.half} />
        <Button label="네이버지도에서 찾기" variant="secondary" onPress={() => openMap(detail.naverMapUrl)} style={styles.half} />
      </View>
    </ScrollView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { padding: spacing.md, gap: spacing.lg },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    headText: { flex: 1, minWidth: 0, gap: spacing.xs },
    sub: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    section: { gap: spacing.md },
    links: { flexDirection: "row", gap: spacing.sm },
    half: { flex: 1 },
    emptyAction: { alignSelf: "center" },
    empty: {
      flex: 1,
      backgroundColor: t.colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.lg,
    },
  });
