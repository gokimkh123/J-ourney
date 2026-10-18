import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";

import { AppText, Banner, Button, Chip, ProgressBar, StateView, TextField } from "../components/index.ts";
import { endpoints } from "../lib/api/index.ts";
import {
  buildSubmitBody,
  isAnswered,
  isComplete,
  setScale,
  setText,
  toggleOption,
} from "../lib/persona/answers.ts";
import type {
  AnswerState,
  MultiQuestion,
  Question,
  ScaleQuestion,
  TextQuestion,
} from "../lib/persona/types.ts";
import { pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import { describeError, formatCount } from "../lib/ui/format.ts";

const PERSONA_ROUTE = "/persona" as Href;
const SCALE_GAP = 8;

type UpdateAnswers = Dispatch<SetStateAction<AnswerState>>;

/** 1~N 점수 고르기. 숫자 칸은 같은 너비로 한 줄에 놓고 양 끝에 뜻을 적는다. */
function ScaleInput({ question, answers, update }: {
  question: ScaleQuestion;
  answers: AnswerState;
  update: UpdateAnswers;
}) {
  const styles = useStyles(createStyles);
  const answer = answers[question.id];
  const values = Array.from(
    { length: question.max - question.min + 1 },
    (_, i) => question.min + i,
  );
  // 칸이 많으면(0~10) 두 줄로 나눠서 손가락으로 누를 만한 너비를 지킨다.
  const columns = values.length > 7 ? Math.ceil(values.length / 2) : values.length;
  const cellWidth = `${100 / columns}%` as const;
  return (
    <View style={styles.inputBlock}>
      <View style={styles.scaleRow} accessibilityRole="radiogroup" accessibilityLabel={question.text}>
        {values.map((value) => {
          const selected = answer?.type === "scale" && answer.value === value;
          return (
            <View key={value} style={[styles.scaleCell, { width: cellWidth }]}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${value}점`}
              accessibilityHint={value === question.min ? question.minLabel : value === question.max ? question.maxLabel : undefined}
              onPress={() => update((state) => setScale(state, question, value))}
              style={({ pressed }) => [styles.scaleButton, selected && styles.scaleSelected, pressed && { opacity: pressedOpacity }]}
            >
              <AppText variant="bodyStrong" tone={selected ? "onAccent" : "default"}>
                {value}
              </AppText>
            </Pressable>
            </View>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        <AppText variant="caption" tone="muted">
          {question.minLabel}
        </AppText>
        <AppText variant="caption" tone="muted">
          {question.maxLabel}
        </AppText>
      </View>
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

export default function Questionnaire() {
  const styles = useStyles(createStyles);
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);

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
    };
  }, []);

  async function onSubmit() {
    if (questions === null || inFlight.current || !isComplete(questions, answers)) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await endpoints.submitPersona(buildSubmitBody(questions, answers).answers);
      if (alive.current) router.navigate(PERSONA_ROUTE);
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
  if (loadError !== null || questions === null) {
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.progress}>
          <AppText variant="label" tone="accent">
            {formatCount(index + 1, questions.length)}
          </AppText>
          <ProgressBar value={(index + 1) / questions.length} size="sm" accessibilityLabel={`문항 ${index + 1}/${questions.length}`} />
        </View>
        {question !== undefined && (
          <>
            <AppText variant="title" accessibilityRole="header">
              {question.text}
            </AppText>
            {question.type === "scale" && (
              <ScaleInput question={question} answers={answers} update={setAnswers} />
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
        {submitting && <Banner tone="accent" text="AI가 캐릭터 카드를 쓰고 있어요. 몇 초 걸려요" />}
        {!submitting && submitError !== null && (
          <Banner tone="danger" text={submitError} actionLabel="다시 시도" onAction={() => void onSubmit()} />
        )}
        <View style={styles.navRow}>
          {index > 0 && (
            <Button
              label="이전"
              variant="secondary"
              disabled={submitting}
              onPress={() => setIndex((i) => Math.max(0, i - 1))}
              style={styles.navPrev}
            />
          )}
          {isLast ? (
            <Button
              label="내 캐릭터 카드 만들기"
              disabled={!canSubmit}
              loading={submitting}
              onPress={() => void onSubmit()}
              style={styles.navNext}
            />
          ) : (
            <Button
              label="다음"
              disabled={!canNext}
              onPress={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
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
    // 칸마다 가장자리 여백을 반씩 주고, 줄 전체를 그만큼 바깥으로 당겨 양끝을 맞춘다.
    scaleRow: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -SCALE_GAP / 2 },
    scaleCell: { padding: SCALE_GAP / 2 },
    scaleButton: {
      minHeight: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
    },
    scaleSelected: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
    labelRow: { flexDirection: "row", justifyContent: "space-between" },
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
