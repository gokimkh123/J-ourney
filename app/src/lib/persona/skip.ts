import { isAnswered } from './answers.ts';
import type { AnswerState, Question } from './types.ts';

/**
 * 답하지 않고 건너뛸 수 있는 문항. 이번 여행 속도(single)는 질문 목록엔 필수로 오지만
 * 서버가 고르지 않은 답도 받는다(v2.4: 속도는 2·8번 성향으로 정함).
 */
export function isSkippable(question: Question): boolean {
  return question.type === 'single';
}

/** 다음 문항으로 갈 수 있는지: 답했거나 건너뛸 수 있는 문항 */
export function canMoveOn(question: Question, state: AnswerState): boolean {
  return isAnswered(question, state) || isSkippable(question);
}

/** 제출할 수 있는지: 모든 문항이 답했거나 건너뛸 수 있다 */
export function isReadyToSubmit(questions: Question[], state: AnswerState): boolean {
  return questions.every((question) => canMoveOn(question, state));
}
