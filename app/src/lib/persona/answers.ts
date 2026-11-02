import type {
  AnswerState,
  ListQuestion,
  MultiQuestion,
  Question,
  ScaleQuestion,
  SingleQuestion,
  SubmitAnswer,
  TextQuestion,
} from './types.ts';

function selectedIds(state: AnswerState, questionId: string): string[] {
  const answer = state[questionId];
  return answer?.type === 'multi' ? answer.optionIds : [];
}

// multi 문항의 '기타' 글(앞뒤 공백 뺌). 기타 칸이 없는 문항이면 빈 글.
function otherText(state: AnswerState, question: MultiQuestion): string {
  const answer = state[question.id];
  if (question.other === undefined || answer?.type !== 'multi') return '';
  return (answer.other ?? '').trim();
}

function clip(text: string, maxLength: number): string {
  return Array.from(text).slice(0, maxLength).join('');
}

function multiAnswer(optionIds: string[], other: string | undefined) {
  return other === undefined ? { type: 'multi' as const, optionIds } : { type: 'multi' as const, optionIds, other };
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
  const current = state[question.id];
  const other = current?.type === 'multi' ? current.other : undefined;
  if (selected.includes(optionId)) {
    const optionIds = selected.filter((id) => id !== optionId);
    return { ...state, [question.id]: multiAnswer(optionIds, other) };
  }
  if (selected.length >= question.maxSelect) return state;
  return { ...state, [question.id]: multiAnswer([...selected, optionId], other) };
}

/** multi 문항의 '기타' 글을 넣는다. 빈 글이면 기타를 지운다. 고른 보기는 그대로 둔다. */
export function setOther(state: AnswerState, question: MultiQuestion, text: string): AnswerState {
  if (question.other === undefined) throw new Error(`${question.order}번 문항에는 기타 입력이 없습니다.`);
  const optionIds = selectedIds(state, question.id);
  const clipped = clip(text, question.other.maxLength);
  return { ...state, [question.id]: multiAnswer(optionIds, clipped === '' ? undefined : clipped) };
}

/** list 문항(가고 싶은 곳)의 글 목록을 통째로 바꾼다. maxItems개·한 줄 maxLength자로 자른다. 빈 줄은 입력 중일 수 있어 남긴다. */
export function setTexts(state: AnswerState, question: ListQuestion, texts: string[]): AnswerState {
  const clipped = texts.slice(0, question.maxItems).map((text) => clip(text, question.maxLength));
  return { ...state, [question.id]: { type: 'list', texts: clipped } };
}

/** single 문항(이번 여행 속도)에서 하나를 고른다. */
export function setSingle(state: AnswerState, question: SingleQuestion, optionId: string): AnswerState {
  if (!question.options.some((option) => option.id === optionId)) {
    throw new Error(`${question.order}번 문항에 없는 선택지입니다: ${optionId}`);
  }
  return { ...state, [question.id]: { type: 'single', optionId } };
}

// list 문항에서 실제로 보낼 글: 앞뒤 공백을 빼고 빈 줄·같은 글은 한 번만
function listTexts(state: AnswerState, questionId: string): string[] {
  const answer = state[questionId];
  if (answer?.type !== 'list') return [];
  return [...new Set(answer.texts.map((text) => text.trim()).filter((text) => text !== ''))];
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
    // 기타를 적으면 하나로 센다(최소 개수만). 최대 개수는 보기만 센다(서버 규칙).
    const withOther = count + (otherText(state, question) !== '' ? 1 : 0);
    return withOther >= question.minSelect && count <= question.maxSelect;
  }
  if (question.type === 'list') return !question.required || listTexts(state, question.id).length > 0;
  if (question.type === 'single') return !question.required || answer?.type === 'single';
  if (!question.required) return true;
  return answer?.type === 'text' && answer.text.trim() !== '';
}

/** 무엇이든 적거나 골랐는지. 선택 문항이 비어 있으면 화면 버튼이 "건너뛰기"가 된다. */
export function hasContent(question: Question, state: AnswerState): boolean {
  const answer = state[question.id];
  if (question.type === 'multi') return selectedIds(state, question.id).length > 0 || otherText(state, question) !== '';
  if (question.type === 'list') return listTexts(state, question.id).length > 0;
  if (question.type === 'text') return answer?.type === 'text' && answer.text.trim() !== '';
  return answer?.type === question.type;
}

/** 화면에 보일 list 문항의 글(입력 중인 빈 칸 포함, 자르기 전) */
export function listDraft(state: AnswerState, questionId: string): string[] {
  const answer = state[questionId];
  return answer?.type === 'list' ? answer.texts : [];
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
      const other = otherText(state, question);
      // minSelect가 0인 문항은 고르지 않아도 빈 배열로 보낸다. 기타 글이 있으면 text로 같이 보낸다.
      if (other !== '') {
        answers.push({ questionId: question.id, optionIds: [...optionIds], text: other });
      } else if (optionIds.length > 0 || question.minSelect === 0) {
        answers.push({ questionId: question.id, optionIds: [...optionIds] });
      }
    } else if (question.type === 'list') {
      const texts = listTexts(state, question.id);
      if (texts.length > 0) answers.push({ questionId: question.id, texts });
    } else if (question.type === 'single') {
      if (answer?.type === 'single') answers.push({ questionId: question.id, optionIds: [answer.optionId] });
    } else if (answer?.type === 'text' && answer.text !== '') {
      answers.push({ questionId: question.id, text: answer.text });
    }
  }
  return { answers };
}
