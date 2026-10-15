import type {
  AnswerState,
  MultiQuestion,
  Question,
  ScaleQuestion,
  SubmitAnswer,
  TextQuestion,
} from './types.ts';

function selectedIds(state: AnswerState, questionId: string): string[] {
  const answer = state[questionId];
  return answer?.type === 'multi' ? answer.optionIds : [];
}

export function setScale(state: AnswerState, question: ScaleQuestion, value: number): AnswerState {
  if (!Number.isInteger(value) || value < question.min || value > question.max) {
    throw new Error(
      `${question.order}번 문항은 ${question.min}~${question.max} 사이의 정수로 답해 주세요.`,
    );
  }
  return { ...state, [question.id]: { type: 'scale', value } };
}

export function toggleOption(
  state: AnswerState,
  question: MultiQuestion,
  optionId: string,
): AnswerState {
  if (!question.options.some((option) => option.id === optionId)) {
    throw new Error(`${question.order}번 문항에 없는 선택지입니다: ${optionId}`);
  }
  const selected = selectedIds(state, question.id);
  if (selected.includes(optionId)) {
    const optionIds = selected.filter((id) => id !== optionId);
    return { ...state, [question.id]: { type: 'multi', optionIds } };
  }
  if (selected.length >= question.maxSelect) return state;
  return { ...state, [question.id]: { type: 'multi', optionIds: [...selected, optionId] } };
}

export function setText(state: AnswerState, question: TextQuestion, text: string): AnswerState {
  const clipped = Array.from(text.trim()).slice(0, question.maxLength).join('');
  return { ...state, [question.id]: { type: 'text', text: clipped } };
}

export function isAnswered(question: Question, state: AnswerState): boolean {
  const answer = state[question.id];
  if (question.type === 'scale') return answer?.type === 'scale';
  if (question.type === 'multi') {
    const count = selectedIds(state, question.id).length;
    return count >= question.minSelect && count <= question.maxSelect;
  }
  if (!question.required) return true;
  return answer?.type === 'text' && answer.text.trim() !== '';
}

export function isComplete(questions: Question[], state: AnswerState): boolean {
  return questions.every((question) => isAnswered(question, state));
}

export function firstUnanswered(questions: Question[], state: AnswerState): number | null {
  const index = questions.findIndex((question) => !isAnswered(question, state));
  return index === -1 ? null : index;
}

export function progress(
  questions: Question[],
  state: AnswerState,
): { answered: number; total: number } {
  return {
    answered: questions.filter((question) => isAnswered(question, state)).length,
    total: questions.length,
  };
}

export function buildSubmitBody(
  questions: Question[],
  state: AnswerState,
): { answers: SubmitAnswer[] } {
  const answers: SubmitAnswer[] = [];
  for (const question of [...questions].sort((a, b) => a.order - b.order)) {
    const answer = state[question.id];
    if (question.type === 'scale') {
      if (answer?.type === 'scale') answers.push({ questionId: question.id, value: answer.value });
    } else if (question.type === 'multi') {
      const optionIds = selectedIds(state, question.id);
      // minSelect가 0인 문항은 고르지 않아도 빈 배열로 보낸다.
      if (optionIds.length > 0 || question.minSelect === 0) {
        answers.push({ questionId: question.id, optionIds: [...optionIds] });
      }
    } else if (answer?.type === 'text' && answer.text !== '') {
      answers.push({ questionId: question.id, text: answer.text });
    }
  }
  return { answers };
}
