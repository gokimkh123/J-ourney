import type {
  AnswerState,
  MultiQuestion,
  Persona,
  PersonaAxis,
  Question,
  ScaleAxis,
} from './types.ts';

const AXIS_ORDER: readonly ScaleAxis[] = ['EI', 'SN', 'TF', 'JP'];

const TITLE_EI: Record<string, string> = { E: '활기찬', I: '차분한' };
const TITLE_JP: Record<string, string> = { J: '계획형', P: '즉흥형' };

const SUMMARY: Record<string, string> = {
  E: '사람들과 함께할 때 에너지를 얻고',
  I: '조용히 쉬는 시간에 에너지를 얻고',
  S: '눈에 보이는 현실적인 정보를 중요하게 보며',
  N: '새로운 가능성과 분위기를 중요하게 보며',
  T: '논리와 효율로 판단하고',
  F: '함께하는 사람의 마음을 먼저 살피고',
  J: '미리 계획을 세워야 마음이 편한 여행자예요.',
  P: '그때그때 흐름에 맡기는 여행자예요.',
};

const SPEECH: Record<string, string> = {
  E: '먼저 의견을 꺼내며 분위기를 이끄는 말투',
  I: '차분하게 생각을 정리해서 말하는 말투',
  T: '핵심만 짚어 또렷하게 말해요.',
  F: '상대 기분을 살피며 부드럽게 말해요.',
};

function scoreAxis(questions: Question[], state: AnswerState, axis: ScaleAxis) {
  const related = questions.filter((q) => q.type === 'scale' && q.axis === axis);
  if (related.length === 0) {
    throw new Error(`${axis} 축의 척도 문항이 없습니다.`);
  }
  let sum = 0;
  for (const question of related) {
    const answer = state[question.id];
    if (answer?.type !== 'scale') {
      throw new Error(`${axis} 축의 ${question.id} 문항에 답이 없습니다.`);
    }
    sum += answer.value;
  }
  const letter = sum <= 7 ? axis[0] : axis[1];
  const percent = Math.round(50 + (Math.abs(sum - 7.5) / 4.5) * 50);
  return { pair: axis, letter, percent };
}

export function scoreAxes(
  questions: Question[],
  state: AnswerState,
): { mbti: string; axes: PersonaAxis[] } {
  const axes = AXIS_ORDER.map((axis) => scoreAxis(questions, state, axis));
  return { mbti: axes.map((axis) => axis.letter).join(''), axes };
}

function selectedTexts(question: MultiQuestion | undefined, state: AnswerState): string[] {
  if (!question) return [];
  const answer = state[question.id];
  if (answer?.type !== 'multi') return [];
  return question.options
    .filter((option) => answer.optionIds.includes(option.id))
    .map((option) => option.text);
}

export function mockPersona(
  memberId: string,
  answers: AnswerState,
  questions: Question[],
): Persona {
  const { mbti, axes } = scoreAxes(questions, answers);
  const [e, s, t, j] = mbti.split('');

  const multis = questions
    .filter((q): q is MultiQuestion => q.type === 'multi')
    .sort((a, b) => a.order - b.order);
  const interests = selectedTexts(multis[0], answers);
  const dealBreakers = selectedTexts(multis[1], answers);

  const mustDo = interests.map((text) => `${text} 꼭 해보기`);
  for (const question of questions) {
    if (question.type !== 'text') continue;
    const answer = answers[question.id];
    if (answer?.type === 'text' && answer.text.trim() !== '') mustDo.push(answer.text.trim());
  }
  if (mustDo.length === 0) {
    mustDo.push(`${mbti} 스타일에 맞는 여유로운 시간 보내기`);
  }

  const title = `${TITLE_EI[e]} ${TITLE_JP[j]} 여행자`;
  return {
    memberId,
    mbti,
    title,
    summary: `${SUMMARY[e]} ${SUMMARY[s]} ${SUMMARY[t]} ${SUMMARY[j]}`,
    speechStyle: `${SPEECH[e]}, ${SPEECH[t]}`,
    axes,
    interests,
    mustDo,
    dealBreakers,
    source: 'template',
  };
}
