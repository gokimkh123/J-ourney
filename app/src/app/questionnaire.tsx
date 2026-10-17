import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";

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
import { useStyles, useTheme, type Theme } from "../theme/index.ts";
import { describeError, formatCount } from "../lib/ui/format.ts";

const PERSONA_ROUTE = "/persona" as Href;

type UpdateAnswers = Dispatch<SetStateAction<AnswerState>>;

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
  return (
    <View>
      <View style={styles.scaleRow}>
        {values.map((value) => {
          const selected = answer?.type === "scale" && answer.value === value;
          return (
            <Pressable
              key={value}
              style={[styles.scaleButton, selected && styles.selected]}
              onPress={() => update((state) => setScale(state, question, value))}
            >
              <Text style={[styles.scaleText, selected && styles.selectedText]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        <Text style={styles.hint}>{question.minLabel}</Text>
        <Text style={styles.hint}>{question.maxLabel}</Text>
      </View>
    </View>
  );
}

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
    <View>
      <Text style={styles.hint}>{formatCount(selectedIds.length, question.maxSelect)}</Text>
      {question.minSelect === 0 && <Text style={styles.hint}>없으면 넘어가도 돼요</Text>}
      <View style={styles.chipRow}>
        {question.options.map((option) => {
          const selected = selectedIds.includes(option.id);
          const blocked = full && !selected;
          return (
            <Pressable
              key={option.id}
              style={[styles.chip, selected && styles.selected, blocked && styles.dimmed]}
              onPress={() => {
                if (blocked) return;
                update((state) => toggleOption(state, question, option.id));
              }}
            >
              <Text style={[styles.chipText, selected && styles.selectedText]}>
                {option.emoji} {option.text}
              </Text>
            </Pressable>
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
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View>
      <TextInput
        style={styles.textInput}
        multiline
        placeholder={question.placeholder}
        placeholderTextColor={colors.textMuted}
        maxLength={question.maxLength}
        value={draft}
        onChangeText={onChangeText}
      />
      <Text style={styles.hint}>남은 글자 {Math.max(0, question.maxLength - draft.length)}</Text>
      {!question.required && <Text style={styles.hint}>비워 둬도 돼요</Text>}
    </View>
  );
}

export default function Questionnaire() {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
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

  if (loading || loadError !== null || questions === null) {
    return (
      <View style={styles.center}>
        {loading && <ActivityIndicator color={colors.accent} />}
        {loading && <Text style={styles.line}>문항을 불러오는 중...</Text>}
        {!loading && loadError !== null && (
          <>
            <Text style={styles.error}>{loadError}</Text>
            <Pressable style={styles.button} onPress={loadQuestions}>
              <Text style={styles.buttonText}>다시 시도</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const canNext = question !== undefined && isAnswered(question, answers);
  const canSubmit = isComplete(questions, answers) && !submitting;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.progress}>{formatCount(index + 1, questions.length)}</Text>
      {question !== undefined && (
        <>
          <Text style={styles.question}>{question.text}</Text>
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

      <View style={styles.navRow}>
        <Pressable
          style={[styles.navButton, (index === 0 || submitting) && styles.buttonDisabled]}
          disabled={index === 0 || submitting}
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <Text style={styles.buttonText}>이전</Text>
        </Pressable>
        {!isLast && (
          <Pressable
            style={[styles.navButton, !canNext && styles.buttonDisabled]}
            disabled={!canNext}
            onPress={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
          >
            <Text style={styles.buttonText}>다음</Text>
          </Pressable>
        )}
      </View>

      {isLast && (
        <View style={styles.submitArea}>
          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit}
            onPress={onSubmit}
          >
            <Text style={styles.buttonText}>내 캐릭터 카드 만들기</Text>
          </Pressable>
          {submitting && (
            <View style={styles.submitting}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.line}>AI가 캐릭터 카드를 쓰고 있어요. 몇 초 걸려요</Text>
            </View>
          )}
          {!submitting && submitError !== null && (
            <>
              <Text style={styles.error}>{submitError}</Text>
              <Pressable style={styles.button} onPress={onSubmit}>
                <Text style={styles.buttonText}>다시 시도</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    container: {
      padding: 24,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      backgroundColor: t.colors.background,
    },
    progress: {
      fontSize: 14,
      fontWeight: "bold",
      color: t.colors.accent,
    },
    question: {
      marginTop: 8,
      marginBottom: 16,
      fontSize: 20,
      fontWeight: "bold",
      color: t.colors.text,
    },
    line: {
      marginTop: 8,
      fontSize: 16,
      color: t.colors.text,
      textAlign: "center",
    },
    hint: {
      marginTop: 6,
      fontSize: 13,
      color: t.colors.text,
    },
    error: {
      marginTop: 12,
      fontSize: 14,
      color: t.colors.text,
      textAlign: "center",
    },
    scaleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    scaleButton: {
      margin: 4,
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: t.colors.accent,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.colors.surface,
    },
    scaleText: {
      fontSize: 16,
      color: t.colors.text,
    },
    labelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 8,
    },
    chip: {
      margin: 4,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.colors.accent,
      backgroundColor: t.colors.surface,
    },
    chipText: {
      fontSize: 14,
      color: t.colors.text,
    },
    selected: {
      backgroundColor: t.colors.accent,
    },
    selectedText: {
      color: t.colors.onAccent,
      fontWeight: "bold",
    },
    dimmed: {
      opacity: 0.35,
    },
    textInput: {
      minHeight: 120,
      padding: 12,
      borderWidth: 1,
      borderRadius: 8,
      borderColor: t.colors.accent,
      fontSize: 16,
      color: t.colors.text,
      textAlignVertical: "top",
      backgroundColor: t.colors.surface,
    },
    navRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 24,
    },
    navButton: {
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      backgroundColor: t.colors.accent,
    },
    submitArea: {
      marginTop: 24,
      alignItems: "center",
    },
    submitting: {
      marginTop: 16,
      alignItems: "center",
    },
    button: {
      marginTop: 12,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      backgroundColor: t.colors.accent,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: "bold",
      color: t.colors.onAccent,
    },
  });
