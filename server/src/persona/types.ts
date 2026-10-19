/** 여행 성향 6가지 (명세서 v1.5 4.3) */
export type TraitKey = 'plan' | 'pace' | 'vibe' | 'place' | 'start' | 'budget';

/** 0–3 low · 3 초과 7 미만 neutral · 7–10 high */
export type TraitLevel = 'low' | 'neutral' | 'high';

export interface TraitResult {
  key: TraitKey;
  name: string;
  score: number;
  level: TraitLevel;
  label: string;
  emoji: string;
}

export interface Chip {
  label: string;
  emoji: string;
}

/** 15번에서 뽑은 '꼭 지킬 것' — 코드가 일정안을 검사할 때 씀 */
export type RuleType = 'include' | 'avoid' | 'time' | 'budget' | 'steps' | 'move';

/**
 * include·avoid가 가리키는 것 (성향 LLM이 정함, 코드는 낱말을 해석하지 않음)
 * category: 장소·음식의 종류 → 공식 분류 코드로 찾음 / food: 특정 음식 → 음식점 메뉴·이름
 * place: 특정 장소 → 같은 이름 / area: 시·군·구 → 법정동 코드
 */
export const RULE_TARGETS = ['category', 'food', 'place', 'area'] as const;
export type RuleTarget = (typeof RULE_TARGETS)[number];

export interface MustKeepRule {
  type: RuleType;
  label: string;
  quote: string;
  keyword: string | null;
  /** include·avoid만 값이 있음 (이 필드가 생기기 전에 만든 규칙은 없음) */
  target?: RuleTarget | null;
  /** target이 category일 때 한국관광공사 공식 분류 코드 (예: 온천 → EX050100) */
  codes?: string[];
  start: string | null;
  end: string | null;
  amount: number | null;
}

/** 화면에 보이지 않는 회의용 값 (일정 배치·만족도 계산에 씀) */
export interface PersonaProfile {
  placesPerDay: [number, number];
  maxSteps: number;
  startTime: string;
  endTime: string | null;
  freeMinutes: number;
  weights: { price: number; crowd: number; popularity: number };
  maxMoveMinutes: number | null;
  maxCrowd: number | null;
  maxMealPrice: number | null;
  budgetPerPerson: number | null;
  avoidQueue: boolean;
  includes: string[];
  avoids: string[];
  likes: string[];
}

/** 검사를 마친 설문 응답 */
export interface PersonaAnswers {
  scale: Record<string, number>;
  likes: string[];
  dislikes: string[];
  mustKeepText: string | null;
}
