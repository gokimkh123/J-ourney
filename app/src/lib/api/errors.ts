export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const UNKNOWN_MESSAGE = '알 수 없는 오류가 발생했습니다.';
const SERVER_MESSAGE = '서버에서 오류가 발생했습니다.';
const NETWORK_MESSAGE = '네트워크에 연결할 수 없습니다. 연결 상태를 확인해 주세요.';
const TIMEOUT_MESSAGE = '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';

export function parseApiError(status: number, bodyText: string): ApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const error = (parsed as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (typeof code === 'string' && typeof message === 'string') {
        return new ApiError(status, code, message);
      }
    }
  }

  if (status >= 500) {
    return new ApiError(status, 'INTERNAL_ERROR', SERVER_MESSAGE);
  }
  return new ApiError(status, 'UNKNOWN_ERROR', UNKNOWN_MESSAGE);
}

export function createNetworkError(): ApiError {
  return new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
}

export function createTimeoutError(): ApiError {
  return new ApiError(0, 'TIMEOUT', TIMEOUT_MESSAGE);
}
