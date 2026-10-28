import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AppText, AvatarStack, Banner, Button, MemberBand, StateView, TextField } from "../../components/index.ts";
import { endpoints } from "../../lib/api/index.ts";
import { ApiError } from "../../lib/api/errors.ts";
import type { InviteInfo } from "../../lib/persona/types.ts";
import { partyActions } from "../../lib/session/index.ts";
import { fromSessionResponse } from "../../lib/session/session.ts";
import { useParties } from "../../lib/session/useParties.ts";
import { spacing, useStyles, type Theme } from "../../theme/index.ts";
import { describeError, normalizeInviteCode } from "../../lib/ui/format.ts";

function describeJoinError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "초대 코드를 찾을 수 없어요";
  return describeError(error, "join");
}

type Preview =
  | { kind: "loading" }
  | { kind: "ready"; info: InviteInfo }
  | { kind: "notFound" }
  | { kind: "error" };

/** 초대 링크로 들어온 화면: 어떤 여행인지 보여 주고, 닉네임만 정하면 참여한다. */
export default function InviteScreen() {
  const styles = useStyles(createStyles);
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const router = useRouter();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = normalizeInviteCode(rawCode ?? "");

  const list = useParties();
  const joined = list.find((p) => p.inviteCode === code);
  // 다른 파티에서 쓰던 닉네임을 기본으로 채운다.
  const [nickname, setNickname] = useState(() => list[0]?.nickname ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const inFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 참여 전에 어떤 여행인지 보여 준다. 못 불러와도 참여는 시도할 수 있다.
  useEffect(() => {
    if (code === "") return;
    let cancelled = false;
    setPreview({ kind: "loading" });
    endpoints
      .getInvite(code)
      .then((info) => {
        if (!cancelled) setPreview({ kind: "ready", info });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(e instanceof ApiError && e.status === 404 ? { kind: "notFound" } : { kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  function goHome() {
    router.replace("/");
  }

  async function onJoin() {
    const name = nickname.trim();
    if (name === "" || code === "" || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const next = fromSessionResponse(await endpoints.joinInvite(code, name));
      await partyActions.join(next);
      if (alive.current) goHome();
    } catch (e) {
      if (alive.current) setError(describeJoinError(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  // 이미 들어가 있는 파티의 초대 링크면 새로 참여하지 않고 그 파티를 연다.
  if (joined !== undefined) {
    return (
      <StateView
        title="이미 들어가 있는 파티예요"
        text="이 초대 코드의 파티에는 이미 참여하고 있어요."
        actionLabel="파티 열기"
        onAction={() => {
          void partyActions.enter(joined.tripId);
          goHome();
        }}
      />
    );
  }

  if (code === "" || preview.kind === "notFound") {
    return (
      <StateView
        tone="danger"
        title="초대 코드를 찾을 수 없어요"
        text="코드를 다시 확인하거나 방장에게 새 초대 링크를 받아 주세요."
        actionLabel="홈으로 이동"
        onAction={goHome}
      />
    );
  }

  const canJoin = !submitting && nickname.trim() !== "";
  const info = preview.kind === "ready" ? preview.info : null;
  const members = info?.members ?? [];
  const host = members.find((m) => m.isHost) ?? members[0];
  const waiting =
    host === undefined
      ? null
      : members.length > 1
        ? `${host.nickname} 님 외 ${members.length - 1}명이 기다리고 있어요`
        : `${host.nickname} 님이 기다리고 있어요`;

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {members.length > 0 && <MemberBand members={members.map((m) => ({ id: m.id, name: m.nickname, color: m.color }))} />}
      <View style={styles.body}>
        <View style={styles.intro}>
          <AppText variant="label" tone="accent">
            여행 초대
          </AppText>
          <AppText variant="display" accessibilityRole="header">
            {info?.trip.title ?? "여행에 초대받았어요"}
          </AppText>
          {waiting !== null && (
            <View style={styles.waiting} accessible accessibilityLabel={waiting}>
              <AvatarStack people={members.map((m) => ({ color: m.color, name: m.nickname }))} size="xs" />
              <AppText variant="small" tone="muted" style={styles.waitingText}>
                {waiting}
              </AppText>
            </View>
          )}
          <AppText variant="small" tone="muted">
            초대 코드 {code}
          </AppText>
        </View>

        {preview.kind === "error" && (
          <Banner tone="warning" text="여행 정보를 불러오지 못했어요. 그래도 참여할 수 있어요." />
        )}

        <TextField
          label="내 닉네임"
          value={nickname}
          onChangeText={setNickname}
          editable={!submitting}
          placeholder="여행 친구들이 부를 이름"
          maxLength={12}
        />
        {error !== null && <Banner tone="danger" text={error} />}
        <Button label="참여하기" onPress={() => void onJoin()} disabled={!canJoin} loading={submitting} block />
      </View>
    </ScrollView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: { paddingBottom: spacing.lg },
    body: { padding: spacing.md, gap: spacing.md },
    intro: { gap: spacing.xs + spacing.xxs },
    waiting: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    waitingText: { flex: 1 },
  });
