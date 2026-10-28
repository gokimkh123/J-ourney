import { ApiError } from '../api/errors.ts';

export function inviteLink(code: string): string {
  return `journey://invite/${code.toUpperCase()}`;
}

export function normalizeInviteCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const UNKNOWN_ERROR = '알 수 없는 오류가 발생했어요';

/** 같은 오류 코드라도 어디서 났는지에 따라 문구가 달라지는 경우: 참여할 때, 회의 조건·시작할 때 */
export type ErrorContext = 'join' | 'meeting';

export function describeError(error: unknown, context?: ErrorContext): string {
  if (!(error instanceof ApiError)) return UNKNOWN_ERROR;
  if (error.status === 404) return '서버에 아직 준비되지 않은 기능이에요';
  if (error.code === 'RATE_LIMITED') return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요';
  if (error.code === 'MEETING_IN_PROGRESS') {
    if (context === 'join') return '이미 회의가 시작된 여행이라 참여할 수 없어요';
    if (context === 'meeting') return '이미 회의가 진행 중이에요';
    return '회의가 시작되어 성향을 바꿀 수 없어요';
  }
  if (error.code === 'TRIP_FULL') return '여행 인원이 가득 찼어요';
  if (error.code === 'ACCESS_KEY_REQUIRED') return '접근 키가 없거나 틀려서 회의를 시작할 수 없어요. 팀 키를 확인해 주세요';
  if (error.code === 'ACCESS_QUOTA_EXCEEDED') return '이 접근 키로 시작할 수 있는 회의 횟수를 다 썼어요';
  if (error.code === 'MEETING_LIMIT') return '이 여행에서 할 수 있는 회의 횟수를 다 썼어요';
  if (error.code === 'NOT_ENOUGH_MEMBERS') return '회의는 방장 포함 2명 이상이 모여야 시작할 수 있어요';
  if (error.code === 'PERSONA_REQUIRED') return '성향 검사를 아직 안 한 사람이 있어요';
  if (error.code === 'REVIEW_CLOSED') return '사람 확인이 이미 끝났어요';
  if (error.code === 'PAYLOAD_TOO_LARGE') return '보내는 내용이 너무 커요';
  return error.message;
}

export function formatCount(n: number, max: number): string {
  return `${n}/${max}`;
}

export function traitRatio(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(1, Math.max(0, score / 10));
}

export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const clamped = Number.isNaN(alpha) ? 0 : Math.min(1, Math.max(0, alpha));
  const byte = Math.round(clamped * 255).toString(16).toUpperCase().padStart(2, '0');
  return `${hex}${byte}`;
}

export function sourceBadge(source: 'llm' | 'rule'): string {
  return source === 'llm' ? 'AI가 쓴 카드' : '기본 카드';
}

export function formatWon(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

function utcDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86400000;
}

export function nightsLabel(startDate: string, endDate: string): string {
  const nights = utcDay(endDate) - utcDay(startDate);
  if (nights === 0) return '당일';
  return `${nights}박 ${nights + 1}일`;
}

export function durationLabel(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0초';
  const total = Math.floor(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
}

const MOVE_MODE_LABELS: Record<string, string> = {
  walk: '도보',
  bus: '버스',
  subway: '지하철',
  taxi: '택시',
  car: '자동차',
};

export function moveModeLabel(mode: string): string {
  return Object.hasOwn(MOVE_MODE_LABELS, mode) ? MOVE_MODE_LABELS[mode]! : mode;
}

const CATEGORY_LABELS: Record<string, string> = {
  food: '식사',
  cafe: '카페',
  sightseeing: '관광',
  market: '시장',
  spa: '휴식',
  walk: '산책',
};

export function categoryLabel(category: string): string {
  return Object.hasOwn(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category]! : category;
}

export function crowdLabel(crowd: number): string {
  if (Number.isNaN(crowd) || crowd < 0 || crowd > 100) return '정보 없음';
  if (crowd <= 33) return '한산';
  if (crowd <= 66) return '보통';
  return '붐빔';
}
