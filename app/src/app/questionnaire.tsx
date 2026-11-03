import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";

import { AppText, Banner, Button, InlineField, ProgressBar, ScaleDial, StateView, TextField, TextListInput } from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import {
  buildSubmitBody,
  hasContent,
  listDraft,
  setOther,
  setScale,
  setSingle,
  setText,
  setTexts,
  toggleOption,
} from "../lib/persona/answers.ts";
import {
  extractProfile,
  isProfileComplete,
  mergeProfile,
  partyQuestions,
  profileQuestions,
} from "../lib/persona/profile.ts";
import { profile, useProfile } from "../lib/persona/profileStore.ts";
import { canMoveOn, isReadyToSubmit } from "../lib/persona/skip.ts";
import { markPersonaReady } from "../lib/session/partyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import type {
  AnswerState,
  ListQuestion,
  MultiQuestion,
  Question,
  ScaleQuestion,
  SingleQuestion,
  TextQuestion,
} from "../lib/persona/types.ts";
import { disabledOpacity, hitSize, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import { describeError, formatCount } from "../lib/ui/format.ts";
import { DOUBLE_TAP_MS, isDoubleTap, type LastTap } from "../lib/persona/doubleTap.ts";

const PERSONA_ROUTE = "/persona" as Href;
// 점수를 누른 뒤 다음 문항으로 넘어가기까지 기다리는 시간(고른 칸이 잠깐 보이게). 같은 칸을 이 안에 다시 누르면 바로 넘어간다.
const AUTO_ADVANCE_MS = DOUBLE_TAP_MS;
// 여러 개 고르기 칩을 한 줄에 몇 개 놓는지
const CHIP_COLUMNS = 3;

type UpdateAnswers = Dispatch<SetStateAction<AnswerState>>;

/** 0~10 점수 고르기. 반원형 칸을 눌러 고르고 양 끝에 뜻을 적는다. */
function ScaleInput({ question, answers, update, onPick }: {
  question: ScaleQuestion;
  answers: AnswerState;
  update: UpdateAnswers;
  /** 점수를 눌렀을 때(고른 뒤) 고른 점수와 함께 불린다. 화면이 0.3초 뒤(같은 칸을 한 번 더 누르면 바로) 다음 문항으로 넘긴다. */
  onPick?: (value: number) => void;
}) {
  const styles = useStyles(createStyles);
  const answer = answers[question.id];
  return (
    <View style={styles.inputBlock}>
      <ScaleDial
        min={question.min}
        max={question.max}
        value={answer?.type === "scale" ? answer.value : null}
        minLabel={question.minLabel}
        maxLabel={question.maxLabel}
        accessibilityLabel={question.text}
        onSelect={(value) => update((state) => setScale(state, question, value))}
        onTap={onPick}
      />
    </View>
  );
}

/**
 * 여러 개 고르기. 칩을 세 줄로 놓고, 고른 칩은 ✓로 표시한다. 고를 수 있는 수가 차면 나머지 칩은 흐려진다.
 * 기타 입력이 있는 문항(v2.4)은 끝에 "기타" 칩을 두고, 누르면 아래에 입력칸이 열린다. 기타는 개수에 안 세서 늘 누를 수 있다.
 */
function MultiInput({ question, answers, update, otherOpen, onToggleOther }: {
  question: MultiQuestion;
  answers: AnswerState;
  update: UpdateAnswers;
  otherOpen: boolean;
  onToggleOther: () => void;
}) {
  const styles = useStyles(createStyles);
  const answer = answers[question.id];
  const selectedIds = answer?.type === "multi" ? answer.optionIds : [];
  const full = selectedIds.length >= question.maxSelect;
  const cells = question.options.map((option) => {
    const selected = selectedIds.includes(option.id);
    return {
      key: option.id,
      label: option.text,
      selected,
      disabled: full && !selected,
      onPress: () => update((state) => toggleOption(state, question, option.id)),
    };
  });
  if (question.other !== undefined) cells.push({ key: "__other", label: "기타", selected: otherOpen, disabled: false, onPress: onToggleOther });
  const rows: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += CHIP_COLUMNS) rows.push(cells.slice(i, i + CHIP_COLUMNS));
  return (
    <View style={styles.chipGrid} accessibilityRole="none" accessibilityLabel={`${question.text}, 최대 ${question.maxSelect}개`}>
      {rows.map((row, r) => (
        <View key={r} style={styles.chipRow}>
          {row.map((cell) => (
            <QuizChip key={cell.key} label={cell.label} selected={cell.selected} disabled={cell.disabled} onPress={cell.onPress} />
          ))}
          {Array.from({ length: CHIP_COLUMNS - row.length }, (_, i) => (
            <View key={`gap${i}`} style={styles.chipCell} />
          ))}
        </View>
      ))}
      {question.other !== undefined && otherOpen && (
        <InlineField
          value={answer?.type === "multi" ? answer.other ?? "" : ""}
          onChangeText={(text) => update((state) => setOther(state, question, text))}
          placeholder={question.other.placeholder}
          maxLength={question.other.maxLength}
          onClear={onToggleOther}
          accessibilityLabel="기타"
          autoFocus
        />
      )}
    </View>
  );
}

/** 여러 줄 글(v2.4 가고 싶은 곳): 칸 하나 + "장소 추가". */
function ListInput({ question, answers, update }: { question: ListQuestion; answers: AnswerState; update: UpdateAnswers }) {
  return (
    <TextListInput
      values={listDraft(answers, question.id)}
      onChange={(texts) => update((state) => setTexts(state, question, texts))}
      max={question.maxItems}
      maxLength={question.maxLength}
      placeholder={question.placeholder}
      addLabel="장소 추가"
      itemLabel="가고 싶은 곳"
    />
  );
}

/** 하나 고르기(v2.4 이번 여행 속도): 글자만 있는 큰 버튼 셋. 누르면 0.3초 뒤(같은 버튼을 한 번 더 누르면 바로) 다음 문항으로 간다. 안 고르면 아래 '건너뛰기'. */
function SingleInput({ question, answers, update, onPick }: {
  question: SingleQuestion;
  answers: AnswerState;
  update: UpdateAnswers;
  onPick: (optionId: string) => void;
}) {
  const styles = useStyles(createStyles);
  const answer = answers[question.id];
  const chosen = answer?.type === "single" ? answer.optionId : null;
  return (
    <View style={styles.singleRow} accessibilityRole="radiogroup" accessibilityLabel={question.text}>
      {question.options.map((option) => {
        const selected = option.id === chosen;
        return (
          <Pressable
            key={option.id}
            onPress={() => {
              update((state) => setSingle(state, question, option.id));
              onPick(option.id);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.text}
            style={({ pressed }) => [styles.singleCard, selected && styles.chipOn, pressed && { opacity: pressedOpacity }]}
          >
            <AppText variant="heading" align="center" style={selected ? styles.chipOnText : undefined}>
              {selected ? `✓ ${option.text}` : option.text}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function QuizChip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chipCell,
        styles.chip,
        selected && styles.chipOn,
        pressed && { opacity: pressedOpacity },
        disabled && { opacity: disabledOpacity },
      ]}
    >
      <AppText variant="bodyStrong" align="center" numberOfLines={2} style={selected ? styles.chipOnText : undefined}>
        {selected ? `✓ ${label}` : label}
      </AppText>
    </Pressable>
  );
}

function TextAnswerInput({ question, draft, onChangeText }: {
  question: TextQuestion;
  draft: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <TextField
      label="내 답"
      multiline
      placeholder={question.placeholder}
      maxLength={question.maxLength}
      value={draft}
      onChangeText={onChangeText}
    />
  );
}

/**
 * 설문 화면은 탭 안에서 계속 살아 있어서, 끝낸 뒤의 문항 위치·답이 그대로 남는다.
 * 파티가 바뀌거나(파티 밖 ↔ 안, A ↔ B) 다시 하기로 들어오면 새로 시작하도록 key를 바꿔 다시 만든다.
 */
export default function Questionnaire() {
  const tripId = useSession()?.tripId ?? "none";
  const { retake } = useLocalSearchParams<{ retake?: string }>();
  const [round, setRound] = useState(0);
  return <QuestionnaireBody key={`${tripId}:${retake ?? ""}:${round}`} onFinished={() => setRound((n) => n + 1)} />;
}

function QuestionnaireBody({ onFinished }: { onFinished: () => void }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // 파티 밖(초기 화면)에서는 내 성향(1~12번)만 묻고 폰에 저장한다.
  // 파티 안에서는 저장된 성향이 있으면 13번부터만 묻는다. retake=1이면 1~12번도 다시 묻는다.
  const me = useSession();
  const inParty = me !== null;
  const saved = useProfile();
  const { retake } = useLocalSearchParams<{ retake?: string }>();
  const [allQuestions, setQuestions] = useState<Question[] | null>(null);
  // 문항을 받은 순간에 한 번만 정한다. 제출하면서 성향이 저장돼도 중간에 문항 범위가 바뀌지 않게 한다.
  const reuseDecision = useRef<boolean | null>(null);
  if (allQuestions !== null && reuseDecision.current === null) {
    reuseDecision.current = inParty && isProfileComplete(allQuestions, saved) && retake !== "1";
  }
  const reuseSaved = reuseDecision.current === true;
  const questions = useMemo<Question[] | null>(() => {
    if (allQuestions === null) return null;
    if (!inParty) return profileQuestions(allQuestions);
    return partyQuestions(allQuestions, reuseSaved);
  }, [allQuestions, inParty, reuseSaved]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 기타 입력칸이 열린 문항. 닫으면 적은 글도 지운다.
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<LastTap>(null);

  function cancelAdvance() {
    lastTap.current = null;
    if (advanceTimer.current !== null) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  // 고르면 0.3초 뒤 다음 문항으로 간다. 그 사이 다른 칸을 누르면 시간을 다시 재고, 같은 칸을 한 번 더 누르면 기다리지 않고 바로 간다.
  // 마지막 문항이거나 그 사이 다른 문항으로 옮겼다면 가지 않는다.
  function advanceAfterPick(from: number, total: number, key: string) {
    const now = Date.now();
    const again = isDoubleTap(lastTap.current, key, now);
    cancelAdvance();
    if (from >= total - 1) return;
    const go = () => {
      if (alive.current) setIndex((i) => (i === from ? from + 1 : i));
    };
    if (again) {
      go();
      return;
    }
    lastTap.current = { key, at: now };
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      lastTap.current = null;
      go();
    }, AUTO_ADVANCE_MS);
  }

  function goTo(next: (i: number) => number) {
    cancelAdvance();
    setIndex(next);
  }

  // 폰의 뒤로 가기: 첫 문항이 아니면 이전 문항으로, 첫 문항이면 설문을 나간다(기본 동작).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (index === 0 || submitting) return false;
        goTo((i) => Math.max(0, i - 1));
        return true;
      });
      return () => sub.remove();
    }, [index, submitting]),
  );

  async function loadQuestions() {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await endpoints.getQuestions();
      if (!alive.current) return;
      setQuestions(list);
      setIndex(0);
    } catch (error) {
      if (alive.current) setLoadError(describeError(error));
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    void loadQuestions();
    return () => {
      alive.current = false;
      cancelAdvance();
    };
  }, []);

  async function onSubmit() {
    if (allQuestions === null || questions === null || inFlight.current || !isReadyToSubmit(questions, answers)) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (me === null) {
        await profile.save(extractProfile(allQuestions, answers));
      } else {
        const merged = mergeProfile(reuseSaved ? saved : null, answers);
        await endpoints.submitPersona(buildSubmitBody(allQuestions, merged).answers);
        // 받아 둔 파티 정보에서도 나를 준비됨으로 바로 바꾼다. 내 캐릭터 탭에 가자마자 회의 시작하기(방장)·기다림 카드가 뜬다(11/4).
        markPersonaReady(me.tripId, me.memberId);
        // 처음 하거나 다시 한 1~12번은 폰에 남겨 다음 파티에서 쓴다. 저장이 안 돼도 이번 제출은 성공이다.
        if (!reuseSaved) await profile.save(extractProfile(allQuestions, merged)).catch(() => undefined);
      }
      if (alive.current) {
        router.navigate(PERSONA_ROUTE);
        // 화면을 벗어난 뒤 새 설문으로 갈아 끼운다. 다음에 열면 1번부터 나온다.
        setTimeout(onFinished, 0);
      }
    } catch (error) {
      if (alive.current) setSubmitError(describeError(error));
    } finally {
      inFlight.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  function onChangeText(question: TextQuestion, text: string) {
    setDrafts((current) => ({ ...current, [question.id]: text }));
    setAnswers((state) => setText(state, question, text));
  }

  if (loading) return <StateView loading title="문항을 불러오는 중이에요" />;
  if (loadError !== null || questions === null || allQuestions === null) {
    return (
      <StateView
        tone="danger"
        title="문항을 불러오지 못했어요"
        text={loadError ?? undefined}
        actionLabel="다시 시도"
        onAction={() => void loadQuestions()}
      />
    );
  }

  const question = questions[index];
  const isLast = index === questions.length - 1;
  // 이번 여행 속도는 고르지 않고 건너뛸 수 있다(서버가 빈 답도 받음).
  const canNext = question !== undefined && canMoveOn(question, answers);
  // 넘어가도 되는 문항(가고 싶은 곳·속도·싫은 것)이 비어 있으면 "다음" 대신 "건너뛰기"
  const skipping = question !== undefined && !isLast && canNext && !hasContent(question, answers);
  const canSubmit = isReadyToSubmit(questions, answers) && !submitting;

  const picked = question === undefined ? undefined : answers[question.id];
  const pickedCount = picked?.type === "multi" ? picked.optionIds.length : 0;

  // 닫기: 열기 전 화면으로 돌아간다. 답은 이 화면이 살아 있는 동안 남는다.
  const onClose = () => {
    cancelAdvance();
    if (router.canGoBack()) router.back();
    else router.navigate(inParty ? "/" : PERSONA_ROUTE);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Pressable
          onPress={onClose}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="성향 검사 닫기"
          style={({ pressed }) => [styles.close, pressed && { opacity: pressedOpacity }]}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path d="M6 6l12 12M18 6L6 18" stroke={colors.text} strokeWidth={1.8} strokeLinecap="round" fill="none" />
          </Svg>
        </Pressable>
        <View style={styles.bar}>
          <ProgressBar value={(index + 1) / questions.length} accessibilityLabel={`${questions.length}문항 중 ${index + 1}번째`} />
        </View>
        <AppText variant="label" color={colors.textBody} style={styles.count}>
          {formatCount(index + 1, questions.length)}
        </AppText>
      </View>

      {/* 키보드가 뜨면 문항과 아래 버튼을 키보드 위로 올린다(11/3: 기타 입력칸이 키보드에 가려짐). 안드로이드는 화면이 시스템 막대 뒤까지
          그려져 창이 줄지 않으므로 직접 올린다. 키보드 높이에 아래 시스템 막대가 들어 있어 그만큼(insets.bottom)은 빼고 올린다. */}
      <KeyboardAvoidingView style={styles.body} behavior="padding" keyboardVerticalOffset={-insets.bottom}>
        <ScrollView overScrollMode="never" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {question !== undefined && (
            <>
              <View style={[styles.qHead, question.type === "scale" && styles.qHeadScale]}>
                <AppText variant="title" accessibilityRole="header" style={styles.qText}>
                  {question.text}
                </AppText>
                {question.type === "multi" && (
                  <AppText variant="label" tone="accent" style={styles.qCount}>
                    {formatCount(pickedCount, question.maxSelect)}
                  </AppText>
                )}
              </View>
              {reuseSaved && index === 0 && (
                <AppText variant="small" tone="muted">
                  저장된 내 성향을 써요. 이번 여행 질문만 답해 주세요.
                </AppText>
              )}
              {question.type === "scale" && (
                <View style={styles.dialArea}>
                  <ScaleInput
                    question={question}
                    answers={answers}
                    update={setAnswers}
                    onPick={(value) => advanceAfterPick(index, questions.length, `${question.id}:${value}`)}
                  />
                </View>
              )}
              {question.type === "multi" && (
                <MultiInput
                  question={question}
                  answers={answers}
                  update={setAnswers}
                  otherOpen={otherOpen[question.id] === true}
                  onToggleOther={() => {
                    const open = otherOpen[question.id] === true;
                    if (open) setAnswers((state) => setOther(state, question, ""));
                    setOtherOpen((current) => ({ ...current, [question.id]: !open }));
                  }}
                />
              )}
              {question.type === "list" && <ListInput question={question} answers={answers} update={setAnswers} />}
              {question.type === "single" && (
                <SingleInput
                  question={question}
                  answers={answers}
                  update={setAnswers}
                  onPick={(optionId) => advanceAfterPick(index, questions.length, `${question.id}:${optionId}`)}
                />
              )}
              {question.type === "text" && (
                <TextAnswerInput
                  question={question}
                  draft={drafts[question.id] ?? ""}
                  onChangeText={(text) => onChangeText(question, text)}
                />
              )}
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
          {!submitting && submitError !== null && (
            <Banner tone="danger" text={submitError} actionLabel="다시 시도" onAction={() => void onSubmit()} />
          )}
          <View style={styles.navRow}>
            {index > 0 && (
              <Button
                label="이전"
                variant="secondary"
                disabled={submitting}
                onPress={() => goTo((i) => Math.max(0, i - 1))}
                style={styles.navPrev}
              />
            )}
            {isLast ? (
              <Button
                label={inParty ? "내 캐릭터 카드 만들기" : "내 성향 저장하기"}
                disabled={!canSubmit}
                loading={submitting}
                onPress={() => void onSubmit()}
                style={styles.navNext}
              />
            ) : (
              <Button
                label={skipping ? "건너뛰기" : "다음"}
                variant={skipping ? "soft" : "primary"}
                disabled={!canNext}
                onPress={() => goTo((i) => Math.min(questions.length - 1, i + 1))}
                style={styles.navNext}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    head: { height: 56, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingLeft: spacing.xs, paddingRight: spacing.md },
    close: { width: hitSize, height: hitSize, alignItems: "center", justifyContent: "center" },
    bar: { flex: 1 },
    count: { minWidth: 40, textAlign: "right" },
    body: { flex: 1 },
    content: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.md, gap: spacing.md },
    qHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.sm + spacing.xs, paddingHorizontal: spacing.sm },
    qText: { flex: 1, lineHeight: 32 },
    // 점수 문항은 질문이 1~3줄로 바뀌어도 다이얼(누르는 곳)이 제자리에 있게 제목 칸을 세 줄 높이로 둔다.
    qHeadScale: { minHeight: 32 * 3, alignItems: "flex-start" },
    qCount: { paddingBottom: 6 },
    dialArea: { flex: 1, justifyContent: "center" },
    inputBlock: { gap: spacing.sm },
    chipGrid: { gap: 10, paddingTop: spacing.sm + spacing.xs },
    chipRow: { flexDirection: "row", gap: spacing.sm },
    chipCell: { flex: 1 },
    chip: {
      minHeight: hitSize,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    chipOn: { backgroundColor: t.colors.accentSoft, borderWidth: 2, borderColor: t.colors.accent },
    chipOnText: { color: t.colors.accentSoftText },
    singleRow: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm },
    singleCard: {
      flex: 1,
      height: 88,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
      backgroundColor: t.colors.background,
    },
    navRow: { flexDirection: "row", gap: spacing.sm },
    navPrev: { flex: 1 },
    navNext: { flex: 2 },
  });
