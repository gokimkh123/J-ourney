import type { AnswerState, Question, SubmitAnswer, TextQuestion } from './types.ts';

export function setScale(state: AnswerState, questionId: string, value: number): AnswerState {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error('척도 답변은 1~4 사이의 정수여야 합니다.');
  }
  return { ...state, [questionId]: { type: 'scale', value } };
}

export function toggleOption(
  state: AnswerState,
  questionId: string,
  optionId: string,
): AnswerState {
  const current = state[questionId];
  const selected = current?.type === 'multi' ? current.optionIds : [];
  const optionIds = selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId];
  return { ...state, [questionId]: { type: 'multi', optionIds } };
}

export function setText(state: AnswerState, question: TextQuestion, text: string): AnswerState {
  const clipped = Array.from(text.trim()).slice(0, question.maxLength).join('');
  return { ...state, [question.id]: { type: 'text', text: clipped } };
}

export function isAnswered(question: Question, state: AnswerState): boolean {
  const answer = state[question.id];
  if (question.type === 'scale') return answer?.type === 'scale';
  if (question.type === 'multi') return answer?.type === 'multi' && answer.optionIds.length > 0;
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
    if (question.type === 'scale' && answer?.type === 'scale') {
      answers.push({ questionId: question.id, value: answer.value });
    } else if (question.type === 'multi' && answer?.type === 'multi' && answer.optionIds.length > 0) {
      answers.push({ questionId: question.id, optionIds: [...answer.optionIds] });
    } else if (question.type === 'text' && answer?.type === 'text' && answer.text !== '') {
      answers.push({ questionId: question.id, text: answer.text });
    }
  }
  return { answers };
}
