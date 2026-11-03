import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { AppText, Button, FormSheet, PlacePhoto, StateView, Star } from "../components/index.ts";
import { CharacterSvg } from "../components/character/Bean.tsx";
import { endpoints } from "../lib/api/index.ts";
import { REGIONS, districtsOf, filterByDistrict, regionName, type CommunityList, type CommunityPlace } from "../lib/community/community.ts";
import { describeError } from "../lib/ui/format.ts";
import { hitSize, memberColors, outline, pastel, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";

type View_ = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; list: CommunityList };

const CARD_W = 168;
const PHOTO_H = 112;
// 고른 지역은 이번 실행 동안 기억한다(탭을 오가도 그대로).
let lastRegion: string | null = null;

/** 커뮤니티(메인 탭): AI들이 회의에서 많이 고른 곳을 관광공사 분류로 묶어 보여 준다. 지역은 시·도, 구·군으로 고른다. */
export default function CommunityScreen() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const [region, setRegionState] = useState<string | null>(lastRegion);
  const [district, setDistrict] = useState<string | null>(null);
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<"region" | "district" | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (code: string | null, quiet = false) => {
    const id = ++requestId.current;
    if (!quiet) setView({ kind: "loading" });
    try {
      const list = await endpoints.getCommunityPlaces(code ?? undefined);
      if (id === requestId.current) setView({ kind: "ready", list });
    } catch (error) {
      if (id === requestId.current && !quiet) setView({ kind: "error", message: describeError(error) });
    }
  }, []);

  // 화면에 올 때마다 새로 받는다(후기를 쓰고 돌아오면 별점이 바뀐다). 이미 보이는 목록이 있으면 조용히.
  useFocusEffect(
    useCallback(() => {
      void load(region, view.kind === "ready");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, region]),
  );

  const setRegion = (code: string | null) => {
    lastRegion = code;
    setRegionState(code);
    setDistrict(null);
    setSheet(null);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load(region, true);
    setRefreshing(false);
  };

  const list = view.kind === "ready" ? view.list : null;
  const districts = list === null || region === null ? [] : districtsOf(list);
  const shown = list === null ? null : filterByDistrict(list, district);
  const open = (place: CommunityPlace) => router.push(`/community/${encodeURIComponent(place.placeId)}` as Href);

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        <FilterButton label={regionName(region)} hint="시·도" onPress={() => setSheet("region")} />
        {districts.length > 0 && <FilterButton label={district ?? "전체 구·군"} hint="구·군" onPress={() => setSheet("district")} />}
      </View>

      {view.kind === "loading" && <StateView loading title="AI들이 고른 곳을 모으는 중이에요" />}
      {view.kind === "error" && <StateView tone="danger" title="불러오지 못했어요" text={view.message} actionLabel="다시 시도" onAction={() => void load(region)} />}
      {shown !== null && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        >
          {shown.sections.length === 0 ? (
            <EmptyRegion name={regionName(region)} onAll={region === null ? undefined : () => setRegion(null)} />
          ) : (
            <>
              <AppText variant="small" color={undefined} style={styles.intro}>
                AI들이 회의에서 많이 고른 곳이에요. 다녀왔다면 후기를 남겨 주세요.
              </AppText>
              {shown.sections.map((section) => (
                <View key={section.group} style={styles.section}>
                  <View style={styles.sectionHead}>
                    <AppText variant="heading" accessibilityRole="header">
                      {section.group}
                    </AppText>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                    {section.places.map((place, i) => (
                      <PlaceCard key={place.placeId} place={place} rank={i + 1} onPress={() => open(place)} />
                    ))}
                  </ScrollView>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      <FormSheet visible={sheet === "region"} title="어디를 볼까요?" onClose={() => setSheet(null)}>
        <ChipGrid
          label="시·도"
          options={[{ key: null, label: "전국" }, ...REGIONS.map((r) => ({ key: r.code, label: r.name }))]}
          value={region}
          onPick={setRegion}
        />
      </FormSheet>
      <FormSheet visible={sheet === "district"} title={`${regionName(region)} 구·군`} onClose={() => setSheet(null)}>
        <ChipGrid
          label="구·군"
          options={[{ key: null, label: "전체" }, ...districts.map((d) => ({ key: d, label: d }))]}
          value={district}
          onPick={(d) => {
            setDistrict(d);
            setSheet(null);
          }}
        />
        <AppText variant="caption" tone="muted">
          AI가 고른 곳이 있는 구·군만 보여요.
        </AppText>
      </FormSheet>
    </View>
  );
}

function FilterButton({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${hint}, 지금 ${label}`} style={({ pressed }) => [styles.filter, pressed && { opacity: pressedOpacity }]}>
      <AppText variant="bodyStrong">{label}</AppText>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d="M6 9l6 6 6-6" stroke={colors.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </Pressable>
  );
}

function PlaceCard({ place, rank, onPress }: { place: CommunityPlace; rank: number; onPress: () => void }) {
  const styles = useStyles(createStyles);
  const sub = [place.category, place.address?.split(/\s+/)[1]].filter(Boolean).join(" · ");
  const rated = place.rating.count > 0 && place.rating.average !== null;
  const label = `${rank}위 ${place.name}, ${rated ? `별점 ${place.rating.average}, 후기 ${place.rating.count}개` : "후기 없음"}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.card, pressed && { opacity: pressedOpacity }]}>
      <View>
        <PlacePhoto place={place} width={CARD_W} height={PHOTO_H} rounded />
        <View style={styles.rank}>
          <AppText variant="label">{rank}</AppText>
        </View>
      </View>
      <View style={styles.cardText}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </AppText>
        {sub !== "" && (
          <AppText variant="small" tone="muted" numberOfLines={1}>
            {sub}
          </AppText>
        )}
        {rated ? (
          <View style={styles.starLine}>
            <Star size={14} filled />
            <AppText variant="smallStrong">{place.rating.average!.toFixed(1)}</AppText>
            <AppText variant="small" tone="muted">
              후기 {place.rating.count}
            </AppText>
          </View>
        ) : (
          <AppText variant="small" tone="muted">
            아직 후기 없음
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

function ChipGrid<K extends string | null>({ label, options, value, onPick }: { label: string; options: { key: K; label: string }[]; value: K; onPick: (key: K) => void }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key ?? "all"}
            onPress={() => onPick(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: pressedOpacity }]}
          >
            <AppText variant="bodyStrong" numberOfLines={1} style={on ? styles.chipOnText : undefined}>
              {on ? `✓ ${o.label}` : o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function EmptyRegion({ name, onAll }: { name: string; onAll?: () => void }) {
  const styles = useStyles(createStyles);
  const color = memberColors[0]!;
  return (
    <View style={styles.empty}>
      <View style={styles.emptyArt} accessible={false}>
        <View style={styles.emptyFloor} />
        <CharacterSvg width={80} height={104} body={pastel(color)} line={outline(color)} props={{ head: "cap", hand: "book" }} />
      </View>
      <AppText variant="heading" align="center">
        {name === "전국" ? "아직 AI가 고른 곳이 없어요" : `아직 ${name}에서 AI가 고른 곳이 없어요`}
      </AppText>
      <AppText variant="body" align="center" color={undefined} style={styles.emptyText}>
        {"이 지역으로 여행 회의를 하면\nAI들이 고른 곳이 여기에 모여요."}
      </AppText>
      {onAll !== undefined && <Button label="전국 보기" variant="secondary" onPress={onAll} />}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    filters: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm + spacing.xs },
    filter: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingLeft: 14,
      paddingRight: spacing.sm + spacing.xs,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
    },
    scroll: { paddingBottom: spacing.xl, gap: spacing.lg, flexGrow: 1 },
    intro: { paddingHorizontal: spacing.md, color: t.colors.textBody },
    section: { gap: spacing.sm + spacing.xs },
    sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: spacing.md },
    row: { gap: spacing.sm + spacing.xs, paddingHorizontal: spacing.md },
    card: { width: CARD_W, gap: spacing.sm },
    rank: {
      position: "absolute",
      left: spacing.sm,
      top: spacing.sm,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      boxShadow: t.elevation.float,
    },
    cardText: { gap: 2 },
    starLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      width: "23%",
      flexGrow: 1,
      minHeight: hitSize - 4,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xs,
    },
    chipOn: { backgroundColor: t.colors.accentSoft, borderWidth: 2, borderColor: t.colors.accent },
    chipOnText: { color: t.colors.accentSoftText },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
    emptyArt: { width: 140, height: 120, alignItems: "center", justifyContent: "flex-end" },
    emptyFloor: { position: "absolute", left: 10, right: 10, bottom: 0, height: 26, borderRadius: 70, backgroundColor: t.colors.stageFloor },
    emptyText: { color: t.colors.textBody },
  });
