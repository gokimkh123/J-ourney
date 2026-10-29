/** 오류 코드별 HTTP 상태 (명세서 3장 오류 코드 표) */
const STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  ACCESS_KEY_REQUIRED: 403,
  NOT_FOUND: 404,
  TRIP_FULL: 409,
  PERSONA_REQUIRED: 409,
  NOT_ENOUGH_MEMBERS: 409,
  MEETING_IN_PROGRESS: 409,
  MEETING_LIMIT: 409,
  ACCESS_QUOTA_EXCEEDED: 409,
  VOTE_CLOSED: 409,
  REVIEW_CLOSED: 409,
  REVISE_LIMIT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  /** AI가 필요한 확인을 지금 할 수 없음 (하루 AI 상한·오류·AI 0번 모드에 녹화 없음·접근 키 없는 바깥 요청) — 잠시 뒤 다시 */
  AI_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof STATUS;

/** { "error": { "code", "message" } } 형식으로 응답할 오류 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: (typeof STATUS)[ErrorCode];

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
  }
}
