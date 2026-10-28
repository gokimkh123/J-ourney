import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";

import { AppText, Banner, Button, Chip, ProgressBar, ScaleDial, StateView, TextField } from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import {
  buildSubmitBody,
  isAnswered,
  isComplete,
  setScale,
  setText,
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
import { useSession } from "../lib/session/useSession.ts";
import type {
  AnswerState,
  MultiQuestion,
  Question,
  ScaleQuestion,
  TextQuestion,
} from "../lib/persona/types.ts";
import { spacing, useStyles, type Theme } from "../theme/index.ts";
import { describeError, formatCount } from "../lib/ui/format.ts";

const PERSONA_ROUTE = "/persona" as Href;
// 점수를 누른 뒤 다음 문항으로 넘어가기까지 기다리는 시간(고른 칸이 잠깐 보이게)
const AUTO_ADVANCE_MS = 300;

type UpdateAnswers = Dispatch<SetStateAction<AnswerState>>;

/** 0~10 점수 고르기. 반원형 칸을 눌러 고르고 양 끝에 뜻을 적는다. */
function ScaleInput({ question, answers, update, onPick }: {
  question: ScaleQuestion;
  answers: AnswerState;
  update: UpdateAnswers;
  /** 점수를 눌렀을 때(고른 뒤) 불린다. 화면이 다음 문항으로 넘길 때 쓴다. */
  onPick?: () => void;
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

/** 여러 개 고르기. 고를 수 있는 수가 차면 나머지 칩은 흐려진다. */
function MultiInput({ question, answers, update }: {
  question: MultiQuestion;
  answers: AnswerState;
  update: UpdateAnswers;
}) {
  const styles = useStyles(createStyles);
  const answer = answers[question.id];
  const selectedIds = answer?.type === "multi" ? answer.optionIds : [];
  const full = selectedIds.length >= question.maxSelect;
  return (
    <View style={styles.inputBlock}>
      <AppText variant="small" tone="muted">
        {question.minSelect === 0
          ? `${formatCount(selectedIds.length, question.maxSelect)} 선택 · 없으면 넘어가도 돼요`
          : `${formatCount(selectedIds.length, question.maxSelect)} 선택`}
      </AppText>
      <View style={styles.chipRow}>
        {question.options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <Chip
              key={option.id}
              label={option.text}
              emoji={option.emoji}
              selected={selected}
              disabled={full && !selected}
              onPress={() => update((state) => toggleOption(state, question, option.id))}
            />
          );
        })}
      </View>
    </View>
  );
}

function TextAnswerInput({ question, draft, onChangeText }: {
  question: TextQuestion;
  draft: string;
  onChangeText: (text: string) => void;
}) {
  const hint = `남은 글자 ${Math.max(0, question.maxLength - draft.length)}${question.required ? "" : " · 비워 둬도 돼요"}`;
  return (
    <TextField
      label="내 답"
      multiline
      placeholder={question.placeholder}
      maxLength={question.maxLength}
      value={draft}
      onChangeText={onChangeText}
      hint={hint}
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
  const router = useRouter();
  // 파티 밖(초기 화면)에서는 내 성향(1~12번)만 묻고 폰에 저장한다.
  // 파티 안에서는 저장된 성향이 있으면 13번부터만 묻는다. retake=1이면 1~12번도 다시 묻는다.
  const inParty = useSession() !== null;
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelAdvance() {
    if (advanceTimer.current !== null) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  // 점수를 누르면 잠깐 뒤 다음 문항으로 간다. 그 사이 다른 칸을 누르면 시간을 다시 잰다.
  // 마지막 문항이거나 그 사이 다른 문항으로 옮겼다면 가지 않는다.
  function advanceAfterPick(from: number, total: number) {
    cancelAdvance();
    if (from >= total - 1) return;
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      if (alive.current) setIndex((i) => (i === from ? from + 1 : i));
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
    if (allQuestions === null || questions === null || inFlight.current || !isComplete(questions, answers)) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!inParty) {
        await profile.save(extractProfile(allQuestions, answers));
      } else {
        const merged = mergeProfile(reuseSaved ? saved : null, answers);
        await endpoints.submitPersona(buildSubmitBody(allQuestions, merged).answers);
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
  const canNext = question !== undefined && isAnswered(question, answers);
  const canSubmit = isComplete(questions, answers) && !submitting;

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.progress}>
          <AppText variant="label" tone="accent">
            {formatCount(index + 1, questions.length)}
          </AppText>
          {reuseSaved && (
            <AppText variant="small" tone="muted">
              저장된 내 성향을 써요. 이번 여행 질문만 답해 주세요.
            </AppText>
          )}
          <ProgressBar value={(index + 1) / questions.length} size="sm" accessibilityLabel={`문항 ${index + 1}/${questions.length}`} />
        </View>
        {question !== undefined && (
          <>
            <AppText variant="title" accessibilityRole="header">
              {question.text}
            </AppText>
            {question.type === "scale" && (
              <ScaleInput
                question={question}
                answers={answers}
                update={setAnswers}
                onPick={() => advanceAfterPick(index, questions.length)}
              />
            )}
            {question.type === "multi" && (
              <MultiInput question={question} answers={answers} update={setAnswers} />
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

      <View style={styles.footer}>
        {submitting && inParty && <Banner tone="accent" text="AI가 캐릭터 카드를 쓰고 있어요. 몇 초 걸려요" />}
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
              label="다음"
              disabled={!canNext}
              onPress={() => goTo((i) => Math.min(questions.length - 1, i + 1))}
              style={styles.navNext}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: spacing.md, paddingTop: spacing.sm, gap: spacing.md },
    progress: { gap: spacing.xs + spacing.xxs },
    inputBlock: { gap: spacing.sm },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    footer: {
      padding: spacing.md,
      gap: spacing.sm,
      backgroundColor: t.colors.background,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    navRow: { flexDirection: "row", gap: spacing.sm },
    navPrev: { flex: 1 },
    navNext: { flex: 2 },
  });
