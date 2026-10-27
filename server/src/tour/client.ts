/** TourAPI 응답의 항목 한 개 (값은 모두 문자열로 옴) */
export type TourItem = Record<string, string>;

export interface TourPage {
  items: TourItem[];
  totalCount: number;
}

export interface TourClient {
  call(operation: string, params: Record<string, string | number>): Promise<TourPage>;
}

/** fetch와 같은 모양 (시험에서는 가짜를 넣음) */
export type TourFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * fatal: 키·한도 문제라 더 불러도 소용없음 (실행을 멈춤)
 * budget: 우리 쪽 하루 상한에 닿아 부르지 않음 (실행을 멈춤)
 * item: 이 요청만 실패함 (다음 장소로 넘어감)
 */
export class TourApiError extends Error {
  constructor(
    readonly kind: 'fatal' | 'budget' | 'item',
    message: string,
    /** 연결 실패·시간 초과처럼 다시 부르면 될 수도 있는 오류 */
    readonly transient = false,
  ) {
    super(message);
    this.name = 'TourApiError';
  }
}

/** 공공데이터포털 공통 오류 중 키·한도 문제 (20 접근 거부, 22 하루 한도 초과, 30 미등록 키, 31 기한 만료, 32 미등록 IP, 33 서명 안 된 호출) */
const FATAL_CODES = new Set(['20', '22', '30', '31', '32', '33']);
const OK_CODES = new Set(['0000', '00', '0']);

export interface TourClientOptions {
  baseUrl: string;
  serviceKey: string;
  mobileApp: string;
  fetch?: TourFetch;
  timeoutMs?: number;
  /** 실제로 부르기 직전마다 실행함 (다시 시도할 때도 포함). false면 부르지 않고 budget 오류를 냄 */
  beforeAttempt?: (operation: string) => Promise<boolean>;
}

/** TourAPI 호출기. 오류 문구에는 키와 요청 주소를 넣지 않음 */
export function createTourClient(opts: TourClientOptions): TourClient {
  const doFetch: TourFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 20000;
  // 키 원문과 주소에 넣은 형태(퍼센트 인코딩) 모두 가림
  const mask = (text: string) => text.split(opts.serviceKey).join('***').split(encodeURIComponent(opts.serviceKey)).join('***');

  async function once(operation: string, params: Record<string, string | number>): Promise<TourPage> {
    if (opts.beforeAttempt && !(await opts.beforeAttempt(operation))) throw new TourApiError('budget', '오늘 TourAPI 호출 상한에 닿음');
    const query = new URLSearchParams({ serviceKey: opts.serviceKey, MobileOS: 'ETC', MobileApp: opts.mobileApp, _type: 'json' });
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    let res: Awaited<ReturnType<TourFetch>>;
    let text: string;
    try {
      res = await doFetch(`${opts.baseUrl}/${operation}?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
      text = await res.text();
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? '시간 초과' : '연결 실패';
      throw new TourApiError('item', `${operation} ${reason}`, true);
    }
    return parse(operation, res.status, text, mask);
  }

  return {
    async call(operation, params) {
      try {
        return await once(operation, params);
      } catch (err) {
        // 연결 실패·시간 초과·읽을 수 없는 응답만 한 번 다시 시도함
        if (err instanceof TourApiError && err.transient) return once(operation, params);
        throw err;
      }
    },
  };
}

function parse(operation: string, status: number, text: string, mask: (t: string) => string): TourPage {
  const body = text.trim();
  // 공공데이터포털 공통 오류는 _type=json을 보내도 XML로 옴
  if (body.startsWith('<')) {
    const code = body.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/)?.[1] ?? body.match(/<resultCode>\s*(\d+)\s*<\/resultCode>/)?.[1];
    const msg = body.match(/<returnAuthMsg>\s*([^<]+?)\s*<\/returnAuthMsg>/)?.[1] ?? body.match(/<resultMsg>\s*([^<]+?)\s*<\/resultMsg>/)?.[1] ?? '';
    if (!code) throw new TourApiError('item', `${operation} 응답을 읽지 못함 (HTTP ${status})`, true);
    throw new TourApiError(FATAL_CODES.has(code) ? 'fatal' : 'item', `${operation} 오류 ${code} ${mask(msg)}`.trim());
  }
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new TourApiError('item', `${operation} 응답을 읽지 못함 (HTTP ${status})`, true);
  }
  // 정상: { response: { header, body } }, 기관 오류: { resultCode, resultMsg }
  const header = json?.response?.header ?? json;
  const code = String(header?.resultCode ?? '');
  if (!OK_CODES.has(code)) {
    throw new TourApiError(FATAL_CODES.has(code) ? 'fatal' : 'item', `${operation} 오류 ${code || status} ${mask(String(header?.resultMsg ?? ''))}`.trim());
  }
  const b = json?.response?.body ?? {};
  const raw = b.items && typeof b.items === 'object' ? b.items.item : undefined;
  const items: TourItem[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { items, totalCount: Number(b.totalCount ?? items.length) };
}
