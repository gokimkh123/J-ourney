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
