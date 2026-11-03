import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { AppText, Banner, Button, ConfirmSheet, FormSheet, PlacePhoto, StateView, StatusPill, Star, TextField } from "../../components/index.ts";
import { endpoints } from "../../lib/api/index.ts";
import { ApiError } from "../../lib/api/errors.ts";
import {
  REVIEW_TEXT_MAX,
  kakaoMapUrl,
  plainOverview,
  ratingWord,
  reviewDate,
  type CommunityPlaceDetail,
  type CommunityReview,
} from "../../lib/community/community.ts";
import { useParties } from "../../lib/session/useParties.ts";
import { describeError } from "../../lib/ui/format.ts";
import { showToast } from "../../lib/ui/toast.ts";
import { pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../../theme/index.ts";

type View_ = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; detail: CommunityPlaceDetail };

const PHOTO_H = 220;
const OVERVIEW_LINES = 3;
/** 이보다 긴 소개글만 접어 두고 '더 보기'를 붙인다(대략 세 줄) */
const OVERVIEW_LONG = 90;

/** 커뮤니티 장소 하나: 사진, AI가 고른 수, 영업 여부, 별점, 관광공사 소개글, 여행자 후기. 후기는 저장된 파티의 이름으로 쓴다. */
export default function CommunityPlaceScreen() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  // 후기는 구성원 토큰이 있어야 쓴다(서버 규칙). 파티 밖이라 가장 최근에 들어간 파티의 이름·토큰을 쓴다.
  const author = useParties()[0] ?? null;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [more, setMore] = useState(false);
  const [writing, setWriting] = useState(false);
  // 내 후기 지우기: 시스템 창 대신 앱 모양 확인 시트로 묻고(11/3), 서버가 답할 때까지 시트를 열어 둔다.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const req = ++requestId.current;
      if (!quiet) setView({ kind: "loading" });
      try {
        const detail = await endpoints.getCommunityPlace(id, author?.token);
        if (req === requestId.current) setView({ kind: "ready", detail });
      } catch (error) {
        if (req === requestId.current) setView({ kind: "error", message: describeError(error) });
      }
    },
    [id, author?.token],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/community" as Href);
  };

  const backButton = (
    <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="커뮤니티로 돌아가기" style={[styles.back, { top: insets.top + spacing.sm }]}>
      {({ pressed }) => (
        <View style={[styles.backInner, pressed && { opacity: pressedOpacity }]}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M15 6l-6 6 6 6" stroke={colors.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </View>
      )}
    </Pressable>
  );

  if (view.kind !== "ready") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 64 }]}>
        {view.kind === "loading" ? (
          <StateView loading title="장소를 불러오는 중이에요" />
        ) : (
          <StateView tone="danger" title="장소를 불러오지 못했어요" text={view.message} actionLabel="다시 시도" onAction={() => void load()} />
        )}
        {backButton}
      </View>
    );
  }

  const { place, reviews } = view.detail;
  const mine = reviews.find((r) => r.mine) ?? null;
  const overview = plainOverview(place.overview);
  const rated = place.rating.count > 0 && place.rating.average !== null;
  const sub = [place.group, place.category, place.address].filter(Boolean).join(" · ");
  const open = place.openNow === true ? "영업 중" : place.openNow === false ? "지금은 쉬어요" : null;
  const hoursLabel = [open, place.hours].filter(Boolean).join(" · ");

  const onDelete = () => {
    if (author === null) return;
    setRemoveError(null);
    setConfirmOpen(true);
  };
  const confirmDelete = () => {
    if (author === null || removing) return;
    setRemoving(true);
    setRemoveError(null);
    endpoints.deleteCommunityReview(place.placeId, author.token).then(
      async () => {
        await load(true);
        setRemoving(false);
        setConfirmOpen(false);
        showToast("후기를 지웠어요");
      },
      (error: unknown) => {
        setRemoving(false);
        setRemoveError(describeError(error));
      },
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView overScrollMode="never" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View>
          <PlacePhoto place={place} width="100%" height={PHOTO_H + insets.top} rounded={false} />
          {place.imageUrl !== null && place.imageCredit !== null && (
            <View style={styles.credit}>
              <AppText variant="caption" color="#FFFFFF">
                사진 {place.imageCredit}
              </AppText>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.titleBlock}>
            <AppText variant="title" accessibilityRole="header">
              {place.name}
            </AppText>
            {sub !== "" && (
              <AppText variant="small" tone="muted">
                {sub}
              </AppText>
            )}
          </View>

          <View style={styles.pills}>
            {hoursLabel !== "" && <StatusPill label={hoursLabel} tone={place.openNow === true ? "success" : "neutral"} />}
          </View>

          <View style={styles.ratingBox}>
            {rated ? (
              <>
                <AppText variant="display">{place.rating.average!.toFixed(1)}</AppText>
                <View style={styles.ratingSide}>
                  <Stars value={Math.round(place.rating.average!)} size={18} label={`별점 5점 만점에 ${place.rating.average!.toFixed(1)}점`} />
                  <AppText variant="small" color={colors.textBody}>
                    여행자 후기 {place.rating.count}개
                  </AppText>
                </View>
              </>
            ) : (
              <AppText variant="small" color={colors.textBody}>
                아직 후기가 없어요. 다녀왔다면 첫 후기를 남겨 주세요.
              </AppText>
            )}
          </View>

          {overview !== null && (
            <View style={styles.block}>
              <AppText variant="heading" accessibilityRole="header">
                소개
              </AppText>
              <AppText variant="body" color={colors.textBody} numberOfLines={more ? undefined : OVERVIEW_LINES}>
                {overview}
              </AppText>
              {(overview.length > OVERVIEW_LONG || overview.split("\n").length > OVERVIEW_LINES) && (
                <Button label={more ? "접기" : "더 보기"} variant="ghost" size="sm" onPress={() => setMore((v) => !v)} />
              )}
            </View>
          )}

          <View style={styles.block}>
            <AppText variant="heading" accessibilityRole="header">
              후기 {reviews.length}
            </AppText>
            {reviews.length === 0 ? (
              <AppText variant="small" tone="muted">
                아직 후기가 없어요.
              </AppText>
            ) : (
              reviews.map((r) => <ReviewRow key={r.reviewId} review={r} onEdit={() => setWriting(true)} onDelete={onDelete} removing={removing} />)
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: spacing.lg + insets.bottom }]}>
        {author === null && (
          <AppText variant="caption" tone="muted" align="center">
            파티를 만들거나 참여하면 후기를 쓸 수 있어요.
          </AppText>
        )}
        <View style={styles.bottomRow}>
          <Button label="지도에서 보기" variant="secondary" onPress={() => void Linking.openURL(kakaoMapUrl(place))} style={styles.mapBtn} />
          <Button label={mine !== null ? "내 후기 고치기" : "후기 쓰기"} onPress={() => setWriting(true)} disabled={author === null} style={styles.writeBtn} />
        </View>
      </View>

      {backButton}

      {author !== null && (
        <ReviewSheet
          visible={writing}
          placeName={place.name}
          nickname={author.nickname}
          initial={mine}
          onClose={() => setWriting(false)}
          onSubmit={async (rating, text) => {
            await endpoints.putCommunityReview(place.placeId, rating, text, author.token);
            setWriting(false);
            await load(true);
          }}
        />
      )}

      <ConfirmSheet
        visible={confirmOpen}
        title="내 후기를 지울까요?"
        message="지운 후기는 되돌릴 수 없어요."
        confirmLabel="지우기"
        danger
        busy={removing}
        error={removeError}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}

function Stars({ value, size, label }: { value: number; size: number; label: string }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.stars} accessible accessibilityRole="image" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} filled={n <= value} />
      ))}
    </View>
  );
}

function ReviewRow({ review, onEdit, onDelete, removing }: { review: CommunityReview; onEdit: () => void; onDelete: () => void; removing: boolean }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.review}>
      <View style={styles.reviewHead}>
        <AppText variant="bodyStrong">{review.nickname}</AppText>
        {review.mine && <StatusPill label="내 후기" tone="accent" />}
        <Stars value={review.rating} size={14} label={`${review.rating}점`} />
        <AppText variant="small" tone="muted" style={styles.reviewDate}>
          {reviewDate(review.updatedAt)}
        </AppText>
      </View>
      {review.text !== "" && <AppText variant="body">{review.text}</AppText>}
      {review.mine && (
        <View style={styles.reviewActions}>
          <Button label="고치기" variant="ghost" size="sm" onPress={onEdit} />
          <Button label="지우기" variant="ghost" size="sm" onPress={onDelete} loading={removing} />
        </View>
      )}
    </View>
  );
}

type ReviewSheetProps = {
  visible: boolean;
  placeName: string;
  nickname: string;
  initial: CommunityReview | null;
  onClose: () => void;
  onSubmit: (rating: number, text: string) => Promise<void>;
};

/** 후기 쓰기: 별 다섯 개, 300자 글(안 써도 됨), 누구 이름으로 올라가는지 */
function ReviewSheet({ visible, placeName, nickname, initial, onClose, onSubmit }: ReviewSheetProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [text, setText] = useState(initial?.text ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState(false);

  // 시트를 열 때마다 지금 내 후기(없으면 빈칸)로 채운다.
  if (visible && !shownFor) {
    setShownFor(true);
    setRating(initial?.rating ?? 0);
    setText(initial?.text ?? "");
    setError(null);
  } else if (!visible && shownFor) {
    setShownFor(false);
  }

  const submit = async () => {
    if (rating === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(rating, text.trim());
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "파티 정보가 바뀌어 후기를 쓸 수 없어요. 파티에 다시 들어간 뒤 써 주세요." : describeError(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <FormSheet visible={visible} title={`${placeName} 후기`} onClose={onClose}>
      <View style={styles.pick}>
        <View style={styles.pickStars} accessibilityRole="radiogroup" accessibilityLabel="별점">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => setRating(n)}
              accessibilityRole="radio"
              accessibilityState={{ checked: rating === n }}
              accessibilityLabel={`${n}점`}
              style={({ pressed }) => [styles.pickStar, pressed && { opacity: pressedOpacity }]}
            >
              <Star size={40} filled={n <= rating} />
            </Pressable>
          ))}
        </View>
        <AppText variant="bodyStrong" color={rating === 0 ? colors.textMuted : colors.accentSoftText}>
          {rating === 0 ? "별을 눌러 주세요" : `${rating}점 · ${ratingWord(rating)}`}
        </AppText>
      </View>
      <TextField
        label="어땠나요? (안 써도 돼요)"
        multiline
        value={text}
        onChangeText={setText}
        maxLength={REVIEW_TEXT_MAX}
        placeholder="좋았던 점, 다음 사람에게 알려 주고 싶은 점"
        hint={`${Array.from(text).length}/${REVIEW_TEXT_MAX}`}
        editable={!sending}
      />
      <AppText variant="small" tone="muted">
        ‘{nickname}’ 이름으로 올라가요. 전화번호 같은 개인 정보는 가려져요.
      </AppText>
      {error !== null && <Banner tone="danger" text={error} />}
      <Button label={initial !== null ? "후기 고치기" : "후기 올리기"} size="lg" onPress={() => void submit()} disabled={rating === 0} loading={sending} block />
    </FormSheet>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { paddingBottom: spacing.lg },
    back: { position: "absolute", left: spacing.xs, width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    backInner: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      boxShadow: t.elevation.float,
    },
    credit: { position: "absolute", right: 10, bottom: 10, borderRadius: radius.full, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: spacing.sm, paddingVertical: 2 },
    body: { paddingHorizontal: 20, paddingTop: 18, gap: 18 },
    titleBlock: { gap: spacing.xs },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    ratingBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    ratingSide: { gap: 2 },
    stars: { flexDirection: "row", gap: 1 },
    block: { gap: 6 },
    review: { gap: 6, paddingVertical: 14, borderTopWidth: 1, borderTopColor: t.colors.border },
    reviewHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
    reviewDate: { marginLeft: "auto" },
    reviewActions: { flexDirection: "row", gap: spacing.sm },
    bottom: { paddingHorizontal: spacing.md, paddingTop: spacing.sm + spacing.xs, gap: spacing.sm, backgroundColor: t.colors.background, borderTopWidth: 1, borderTopColor: t.colors.border },
    bottomRow: { flexDirection: "row", gap: spacing.sm },
    mapBtn: { flex: 1 },
    writeBtn: { flex: 2 },
    pick: { alignItems: "center", gap: 6 },
    pickStars: { flexDirection: "row", gap: 2 },
    pickStar: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  });
