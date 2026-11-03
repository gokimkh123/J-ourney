import { buildRulePersona } from '../persona/scoring.ts';
import type { AnswerState, Chip, Member, Persona, Trip } from '../persona/types.ts';
import { memberColors } from '../theme.ts';
import type { MockRoute } from './mock.ts';
import { MOCK_QUESTIONS } from './mockQuestions.ts';
import { MOCK_COMMUNITY_PLACES, MOCK_COMMUNITY_REGION, MOCK_COMMUNITY_REVIEWS } from '../community/mockCommunity.ts';

type MockResult = ReturnType<MockRoute['handler']>;

type TripRecord = { trip: Trip; members: Member[]; demo: boolean };

/**
 * 회의·일정 API를 실서버처럼 답하는 가짜 서버(lib/meeting/fakeServer.ts)가 이 모양을 갖춘다.
 * 없으면(테스트처럼) 회의·일정 API는 만들지 않는다.
 */
export type MockMeetingBackend = {
  setTrip(
    tripId: string,
    members: { id: string; nickname: string; color: string; isHost: boolean; title?: string | null; chips?: Chip[] }[],
    demo: boolean,
  ): void;
  tripStatus(tripId: string): Trip['status'] | null;
  start(tripId: string, callerId: string): MockResult;
  meeting(meetingId: string, callerId: string): MockResult;
  review(meetingId: string, callerId: string, body: unknown): MockResult;
  closeReview(meetingId: string, callerId: string): MockResult;
  events(tripId: string, afterSeq: number): MockResult;
  plan(tripId: string, callerId: string): MockResult;
  choose(tripId: string, callerId: string, body: unknown): MockResult;
  closeChoice(tripId: string, callerId: string): MockResult;
  options(tripId: string, callerId: string): MockResult;
  edits(tripId: string, callerId: string, body: unknown): MockResult;
};
type Session = { tripId: string; member: Member; no: number };

const API_PREFIX = '/api/v1';
const MAX_MEMBERS = 4;
const FIRST_INVITE_CODE = 'BSN482';
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// 실서버의 AI 한도를 흉내 낸다: 구성원당 이 횟수까지만 source가 'llm'이다.
const LLM_LIMIT = 2;

// 시연 친구. 칩은 회의 예시(부산)의 AI 칩과 맞춘다.
const SEEDS = [
  { nickname: '지은', title: '반짝반짝 탐험가', chips: [{ label: '활기형', emoji: '🎉' }, { label: '탐험형', emoji: '🧭' }] },
  { nickname: '현우', title: '꼼꼼한 맛집 플래너', chips: [{ label: '계획형', emoji: '📋' }, { label: '절약형', emoji: '🐷' }] },
  { nickname: '서연', title: '느긋한 힐러', chips: [{ label: '느긋형', emoji: '🐢' }, { label: '한적형', emoji: '🌿' }, { label: '늦잠형', emoji: '😴' }] },
];

function error(status: number, code: string, message: string): MockResult {
  return { status, body: { error: { code, message } } };
}

function unauthorized(): MockResult {
  return error(401, 'UNAUTHORIZED', '인증이 필요합니다. 여행에 다시 참여해 주세요.');
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

// 공백을 뺀 길이가 1~max이면 공백을 뺀 문자열, 아니면 null.
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const length = Array.from(text).length;
  return length >= 1 && length <= max ? text : null;
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// 현재 시각을 한국 시간(+09:00) ISO 8601 문자열로 만든다. 예: 2026-10-14T21:30:00+09:00
/** 가짜 로그인 토큰을 쓰는 기간(실서버와 같은 30일) */
const LOGIN_DAYS = 30;

function nowKst(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs + KST_OFFSET_MS);
  const two = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  return `${date}T${time}+09:00`;
}

// 성공하면 AnswerState, 실패하면 400 메시지 문자열을 돌려준다.
function validateAnswers(raw: unknown): AnswerState | string {
  if (!Array.isArray(raw)) return 'answers는 배열이어야 합니다.';

  const items = new Map<string, Record<string, unknown>>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return '답변 항목은 객체여야 합니다.';
    }
    const item = entry as Record<string, unknown>;
    const question = MOCK_QUESTIONS.find((q) => q.id === item.questionId);
    if (!question) return '존재하지 않는 문항입니다.';
    if (items.has(question.id)) return `${question.order}번 문항에 두 번 답했습니다.`;
    items.set(question.id, item);
  }

  const state: AnswerState = {};
  for (const question of MOCK_QUESTIONS) {
    const n = question.order;
    const item = items.get(question.id);

    if (question.type === 'scale') {
      if (item === undefined) return `${n}번 문항에 답해 주세요.`;
      const { value } = item;
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < question.min ||
        value > question.max
      ) {
        return `${n}번 문항은 ${question.min}~${question.max} 사이의 정수로 답해 주세요.`;
      }
      state[question.id] = { type: 'scale', value };
    } else if (question.type === 'multi') {
      const optionIds = item === undefined ? [] : item.optionIds;
      if (!Array.isArray(optionIds) || !optionIds.every((id) => typeof id === 'string')) {
        return `${n}번 문항은 선택지 목록(optionIds)으로 답해 주세요.`;
      }
      const ids = optionIds as string[];
      const unknown = ids.find((id) => !question.options.some((option) => option.id === id));
      if (unknown !== undefined) return `${n}번 문항에 없는 선택지입니다: ${unknown}`;
      if (new Set(ids).size !== ids.length) return `${n}번 문항에 같은 선택지가 중복되었습니다.`;
      // 기타 글(v2.4)은 최소 개수에 하나로 센다(서버 규칙).
      const other = question.other !== undefined && typeof item?.text === 'string' ? item.text.trim() : '';
      if (question.other !== undefined && Array.from(other).length > question.other.maxLength) {
        return `${n}번 문항의 기타는 ${question.other.maxLength}자 이하로 적어 주세요.`;
      }
      if (ids.length + (other !== '' ? 1 : 0) < question.minSelect || ids.length > question.maxSelect) {
        return `${n}번 문항은 ${question.minSelect}~${question.maxSelect}개를 골라 주세요.`;
      }
      state[question.id] = other !== '' ? { type: 'multi', optionIds: ids, other } : { type: 'multi', optionIds: ids };
    } else if (question.type === 'list') {
      if (item === undefined) continue;
      const { texts } = item;
      if (!Array.isArray(texts) || !texts.every((t) => typeof t === 'string')) return `${n}번 문항은 글 목록(texts)으로 답해 주세요.`;
      const kept = [...new Set((texts as string[]).map((t) => t.trim()).filter((t) => t !== ''))];
      if (kept.length > question.maxItems) return `${n}번 문항은 ${question.maxItems}개까지 적을 수 있습니다.`;
      if (kept.some((t) => Array.from(t).length > question.maxLength)) return `${n}번 문항은 한 줄 ${question.maxLength}자 이하로 적어 주세요.`;
      state[question.id] = { type: 'list', texts: kept };
    } else if (question.type === 'single') {
      // 예전 응답(고르지 않음)도 받는다(서버 v2.4와 같음).
      const optionIds = item === undefined ? [] : item.optionIds;
      if (!Array.isArray(optionIds) || optionIds.length > 1) return `${n}번 문항은 하나만 골라 주세요.`;
      if (optionIds.length === 0) continue;
      const id = optionIds[0];
      if (typeof id !== 'string' || !question.options.some((option) => option.id === id)) return `${n}번 문항에 없는 선택지입니다: ${String(id)}`;
      state[question.id] = { type: 'single', optionId: id };
    } else {
      if (item === undefined) continue;
      if (typeof item.text !== 'string') return `${n}번 문항은 문자열로 답해 주세요.`;
      const text = item.text.trim();
      if (Array.from(text).length > question.maxLength) {
        return `${n}번 문항은 ${question.maxLength}자 이하로 답해 주세요.`;
      }
      state[question.id] = { type: 'text', text };
    }
  }
  return state;
}

export function createMockRoutes(meetings?: MockMeetingBackend): MockRoute[] {
  const trips = new Map<string, TripRecord>();
  const tripIdByCode = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const personas = new Map<string, Persona>();
  const submitCounts = new Map<string, number>();
  let tripCount = 0;
  let memberCount = 0;
  // 카카오 로그인(v2.5): 로그인 토큰 → 계정, 카카오 토큰 → 계정, 구성원 → 계정
  const userByLogin = new Map<string, string>();
  const userByKakao = new Map<string, string>();
  const userOfMember = new Map<string, string>();
  let userCount = 0;
  // 커뮤니티 후기: 장소 → 후기들(구성원마다 1개)
  type MockReview = { reviewId: string; memberId: string | null; nickname: string; rating: number; text: string; createdAt: string; updatedAt: string };
  const reviews = new Map<string, MockReview[]>();
  let reviewCount = 0;
  for (const [placeId, nickname, rating, text, at] of MOCK_COMMUNITY_REVIEWS) {
    reviewCount += 1;
    reviews.set(placeId, [...(reviews.get(placeId) ?? []), { reviewId: `rvw_${reviewCount}`, memberId: null, nickname, rating, text, createdAt: at, updatedAt: at }]);
  }
  function communityCard(p: (typeof MOCK_COMMUNITY_PLACES)[number]) {
    const list = reviews.get(p.id) ?? [];
    const average = list.length === 0 ? null : Math.round((list.reduce((a, r) => a + r.rating, 0) / list.length) * 10) / 10;
    return {
      placeId: p.id, name: p.name, group: p.group, category: p.category, imageUrl: null, imageCredit: null, imageCopyright: null,
      address: p.address, lat: p.lat, lng: p.lng, aiPicks: p.aiPicks, rating: { average, count: list.length }, openNow: p.openNow, hours: p.hours,
    };
  }
  function reviewView(r: MockReview, viewer: string | null) {
    return { reviewId: r.reviewId, nickname: r.nickname, rating: r.rating, text: r.text, mine: viewer !== null && r.memberId === viewer, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  function nextInviteCode(): string {
    if (tripIdByCode.size === 0) return FIRST_INVITE_CODE;
    let code: string;
    do {
      code = randomCode();
    } while (tripIdByCode.has(code));
    return code;
  }

  function findByCode(code: string): TripRecord | undefined {
    const tripId = tripIdByCode.get(code.toUpperCase());
    return tripId === undefined ? undefined : trips.get(tripId);
  }

  function addMember(record: TripRecord, nickname: string, title: string | null = null, chips?: Chip[]): Member {
    memberCount += 1;
    const member: Member = {
      id: `mem_${String(memberCount).padStart(2, '0')}`,
      nickname,
      color: memberColors[record.members.length],
      isHost: record.members.length === 0,
      personaReady: title !== null,
      title,
      ...(chips !== undefined && { chips }),
    };
    record.members.push(member);
    return member;
  }

  function issue(record: TripRecord, member: Member): MockResult {
    const token = `tok_${member.id}_${randomCode()}`;
    sessions.set(token, {
      tripId: record.trip.id,
      member,
      no: record.members.indexOf(member) + 1,
    });
    return { status: 201, body: { trip: record.trip, member, token } };
  }

  function tripOf(record: TripRecord): Trip {
    const status = meetings?.tripStatus(record.trip.id) ?? null;
    return status === null ? record.trip : { ...record.trip, status };
  }

  // 회의 서버에 지금 구성원(성향 칩 포함)을 알려 준다.
  function syncTrip(record: TripRecord): void {
    meetings?.setTrip(
      record.trip.id,
      record.members.map((m) => ({
        id: m.id,
        nickname: m.nickname,
        color: m.color,
        isHost: m.isHost,
        title: m.title,
        chips: m.chips ?? personas.get(m.id)?.chips ?? [],
      })),
      record.demo,
    );
  }

  // 로그인한 구성원이 그 여행 사람인지 보고 넘긴다.
  function withTrip(headers: Record<string, string>, tripId: string, run: (session: Session, record: TripRecord) => MockResult): MockResult {
    const session = authenticate(headers);
    if (session === null) return unauthorized();
    const record = trips.get(tripId);
    if (!record) return error(404, 'NOT_FOUND', '여행을 찾을 수 없습니다.');
    if (session.tripId !== record.trip.id) return error(403, 'FORBIDDEN', '이 여행에 접근할 권한이 없습니다.');
    syncTrip(record);
    return run(session, record);
  }

  // 회의 API는 회의 id만 오므로 로그인한 사람의 여행으로 회의 서버가 확인한다.
  function withMember(headers: Record<string, string>, run: (session: Session) => MockResult): MockResult {
    const session = authenticate(headers);
    if (session === null) return unauthorized();
    const record = trips.get(session.tripId);
    if (record) syncTrip(record);
    return run(session);
  }

  function meetingRoutes(m: MockMeetingBackend): MockRoute[] {
    return [
      {
        method: 'PUT',
        path: `${API_PREFIX}/trips/:tripId/conditions`,
        handler: ({ params, headers, body }) =>
          withTrip(headers, params.tripId, () => {
            const d = asObject(asObject(body).destination);
            const label = typeof d.label === 'string' ? d.label : '부산';
            const regionCode = typeof d.regionCode === 'string' ? d.regionCode : '26';
            return { status: 200, body: { destination: { regionCode, label } } };
          }),
      },
      {
        method: 'POST',
        path: `${API_PREFIX}/trips/:tripId/meetings`,
        handler: ({ params, headers }) => withTrip(headers, params.tripId, (session) => m.start(params.tripId, session.member.id)),
      },
      {
        method: 'GET',
        path: `${API_PREFIX}/meetings/:meetingId`,
        handler: ({ params, headers }) => withMember(headers, (session) => m.meeting(params.meetingId, session.member.id)),
      },
      {
        method: 'POST',
        path: `${API_PREFIX}/meetings/:meetingId/review`,
        handler: ({ params, headers, body }) => withMember(headers, (session) => m.review(params.meetingId, session.member.id, body)),
      },
      {
        method: 'POST',
        path: `${API_PREFIX}/meetings/:meetingId/review/close`,
        handler: ({ params, headers }) => withMember(headers, (session) => m.closeReview(params.meetingId, session.member.id)),
      },
      {
        method: 'GET',
        path: `${API_PREFIX}/trips/:tripId/events`,
        handler: ({ params, headers, query }) =>
          withTrip(headers, params.tripId, () => m.events(params.tripId, Number(query.afterSeq ?? '0') || 0)),
      },
      {
        method: 'GET',
        path: `${API_PREFIX}/trips/:tripId/plan`,
        handler: ({ params, headers }) => withTrip(headers, params.tripId, (session) => m.plan(params.tripId, session.member.id)),
      },
      {
        method: 'POST',
        path: `${API_PREFIX}/trips/:tripId/plan/choice`,
        handler: ({ params, headers, body }) => withTrip(headers, params.tripId, (session) => m.choose(params.tripId, session.member.id, body)),
      },
      {
        method: 'POST',
        path: `${API_PREFIX}/trips/:tripId/plan/choice/close`,
        handler: ({ params, headers }) => withTrip(headers, params.tripId, (session) => m.closeChoice(params.tripId, session.member.id)),
      },
      {
        method: 'GET',
        path: `${API_PREFIX}/trips/:tripId/plan/options`,
        handler: ({ params, headers }) => withTrip(headers, params.tripId, (session) => m.options(params.tripId, session.member.id)),
      },
      {
        method: 'POST',
        path: `${API_PREFIX}/trips/:tripId/plan/edits`,
        handler: ({ params, headers, body }) => withTrip(headers, params.tripId, (session) => m.edits(params.tripId, session.member.id, body)),
      },
    ];
  }

  function authenticate(headers: Record<string, string>): Session | null {
    const match = /^Bearer (.+)$/.exec(headers.authorization ?? '');
    return match ? (sessions.get(match[1]) ?? null) : null;
  }

  /** Authorization이 로그인 토큰(usr_)이면 그 계정 id */
  function userOf(headers: Record<string, string>): string | null {
    const match = /^Bearer (usr_\S+)$/.exec(headers.authorization ?? '');
    return match ? (userByLogin.get(match[1]) ?? null) : null;
  }

  /** 구성원 토큰을 새로 준다. 그 구성원의 예전 토큰은 더 쓰지 못한다(토큰 다시 받기). */
  function reissue(record: TripRecord, member: Member): MockResult {
    for (const [token, s] of sessions) if (s.member.id === member.id) sessions.delete(token);
    return issue(record, member);
  }

  return [
    {
      method: 'POST',
      path: `${API_PREFIX}/trips`,
      handler: ({ body, headers }) => {
        const o = asObject(body);
        const title = cleanText(o.title, 40);
        if (title === null) {
          return error(400, 'VALIDATION_ERROR', '여행 이름은 1~40자로 입력해 주세요.');
        }
        const nickname = cleanText(o.nickname, 20);
        if (nickname === null) {
          return error(400, 'VALIDATION_ERROR', '닉네임은 1~20자로 입력해 주세요.');
        }
        const inviteCode = nextInviteCode();
        tripCount += 1;
        const record: TripRecord = {
          trip: { id: `trp_${tripCount}`, title, inviteCode, status: 'preparing' },
          members: [],
          demo: o.demoMode === true,
        };
        trips.set(record.trip.id, record);
        tripIdByCode.set(inviteCode, record.trip.id);
        const host = addMember(record, nickname);
        const user = userOf(headers);
        if (user !== null) userOfMember.set(host.id, user);
        if (o.demoMode === true) {
          for (const seed of SEEDS) addMember(record, seed.nickname, seed.title, seed.chips);
        }
        return issue(record, host);
      },
    },
    {
      method: 'POST',
      path: `${API_PREFIX}/invites/:inviteCode/join`,
      handler: ({ params, body, headers }) => {
        const record = findByCode(params.inviteCode);
        if (!record) return error(404, 'NOT_FOUND', '초대 코드를 찾을 수 없습니다.');
        // 같은 계정이 다시 참여하면 새 자리 대신 그 자리를 돌려준다.
        const user = userOf(headers);
        const mine = user === null ? undefined : record.members.find((m) => userOfMember.get(m.id) === user);
        if (mine !== undefined) return reissue(record, mine);
        const nickname = cleanText(asObject(body).nickname, 20);
        if (nickname === null) {
          return error(400, 'VALIDATION_ERROR', '닉네임은 1~20자로 입력해 주세요.');
        }
        if (record.members.length >= MAX_MEMBERS) {
          return error(409, 'TRIP_FULL', `여행 인원이 가득 찼습니다. (최대 ${MAX_MEMBERS}명)`);
        }
        const member = addMember(record, nickname);
        if (user !== null) userOfMember.set(member.id, user);
        return issue(record, member);
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/community/places`,
      handler: ({ query }) => {
        const regionCode = query.regionCode;
        if (regionCode !== undefined && !/^\d{2}$/.test(regionCode)) return error(400, 'VALIDATION_ERROR', 'regionCode: 시·도 코드 2자리');
        const shown = regionCode === undefined || regionCode === MOCK_COMMUNITY_REGION.code ? MOCK_COMMUNITY_PLACES : [];
        const groups = new Map<string, ReturnType<typeof communityCard>[]>();
        for (const p of [...shown].sort((a, b) => b.aiPicks - a.aiPicks)) groups.set(p.group, [...(groups.get(p.group) ?? []), communityCard(p)]);
        const sections = [...groups.entries()]
          .map(([group, places]) => ({ group, aiPicks: places.reduce((a, p) => a + p.aiPicks, 0), places }))
          .sort((a, b) => b.aiPicks - a.aiPicks);
        const regionName = regionCode === MOCK_COMMUNITY_REGION.code ? MOCK_COMMUNITY_REGION.name : null;
        return { status: 200, body: { regionCode: regionCode ?? null, regionName, districtCode: null, sections, baseDate: nowKst().slice(0, 10) } };
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/community/places/:placeId`,
      handler: ({ params, headers }) => {
        const p = MOCK_COMMUNITY_PLACES.find((x) => x.id === params.placeId);
        if (!p) return error(404, 'NOT_FOUND', '장소를 찾을 수 없음');
        const viewer = authenticate(headers)?.member.id ?? null;
        const list = [...(reviews.get(p.id) ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return { status: 200, body: { place: { ...communityCard(p), overview: p.overview }, reviews: list.map((r) => reviewView(r, viewer)) } };
      },
    },
    {
      method: 'PUT',
      path: `${API_PREFIX}/community/places/:placeId/review`,
      handler: ({ params, headers, body }) =>
        withMember(headers, (session) => {
          const p = MOCK_COMMUNITY_PLACES.find((x) => x.id === params.placeId);
          if (!p) return error(404, 'NOT_FOUND', '장소를 찾을 수 없음');
          const o = asObject(body);
          const rating = o.rating;
          if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) return error(400, 'VALIDATION_ERROR', 'rating: 1~5');
          const text = typeof o.text === 'string' ? o.text.trim() : '';
          if (Array.from(text).length > 300) return error(400, 'VALIDATION_ERROR', 'text: 300자 이하');
          const list = reviews.get(p.id) ?? [];
          const now = nowKst();
          const at = list.findIndex((r) => r.memberId === session.member.id);
          let review: MockReview;
          if (at === -1) {
            reviewCount += 1;
            review = { reviewId: `rvw_${reviewCount}`, memberId: session.member.id, nickname: session.member.nickname, rating, text, createdAt: now, updatedAt: now };
            reviews.set(p.id, [...list, review]);
          } else {
            review = { ...list[at]!, rating, text, nickname: session.member.nickname, updatedAt: now };
            reviews.set(p.id, list.map((r, i) => (i === at ? review : r)));
          }
          return { status: 200, body: { review: reviewView(review, session.member.id) } };
        }),
    },
    {
      method: 'DELETE',
      path: `${API_PREFIX}/community/places/:placeId/review`,
      handler: ({ params, headers }) =>
        withMember(headers, (session) => {
          const list = reviews.get(params.placeId);
          if (list) reviews.set(params.placeId, list.filter((r) => r.memberId !== session.member.id));
          return { status: 204, body: null };
        }),
    },
    {
      method: 'POST',
      path: `${API_PREFIX}/auth/kakao`,
      handler: ({ body }) => {
        const accessToken = cleanText(asObject(body).accessToken, 4096);
        if (accessToken === null) return error(400, 'VALIDATION_ERROR', 'accessToken이 필요합니다.');
        let user = userByKakao.get(accessToken);
        if (user === undefined) {
          userCount += 1;
          user = `usr_${String(userCount).padStart(2, '0')}`;
          userByKakao.set(accessToken, user);
        }
        const token = `usr_${randomCode()}${randomCode()}`;
        userByLogin.set(token, user);
        return { status: 200, body: { user: { id: user }, token, expiresAt: nowKst(LOGIN_DAYS * 24 * 60 * 60 * 1000) } };
      },
    },
    {
      method: 'DELETE',
      path: `${API_PREFIX}/auth/session`,
      handler: ({ headers }) => {
        const match = /^Bearer (usr_\S+)$/.exec(headers.authorization ?? '');
        if (match) userByLogin.delete(match[1]);
        return { status: 204, body: null };
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/users/me/trips`,
      handler: ({ headers }) => {
        const user = userOf(headers);
        if (user === null) return error(401, 'UNAUTHORIZED', '로그인 토큰이 필요합니다.');
        const list: { trip: Trip; member: Member }[] = [];
        for (const record of trips.values()) {
          const member = record.members.find((m) => userOfMember.get(m.id) === user);
          if (member !== undefined) list.unshift({ trip: tripOf(record), member });
        }
        return { status: 200, body: { trips: list } };
      },
    },
    {
      method: 'POST',
      path: `${API_PREFIX}/users/me/trips/:tripId/token`,
      handler: ({ params, headers }) => {
        const user = userOf(headers);
        if (user === null) return error(401, 'UNAUTHORIZED', '로그인 토큰이 필요합니다.');
        const record = trips.get(params.tripId);
        const member = record?.members.find((m) => userOfMember.get(m.id) === user);
        if (record === undefined || member === undefined) return error(404, 'NOT_FOUND', '내 여행에서 찾을 수 없습니다.');
        const result = reissue(record, member);
        return { status: 200, body: { ...(result.body as object), trip: tripOf(record) } };
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/invites/:inviteCode`,
      handler: ({ params }) => {
        const record = findByCode(params.inviteCode);
        if (!record) return error(404, 'NOT_FOUND', '초대 코드를 찾을 수 없습니다.');
        return { status: 200, body: { trip: tripOf(record), members: record.members } };
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/trips/:tripId`,
      handler: ({ params, headers }) => {
        const session = authenticate(headers);
        if (session === null) return unauthorized();
        const record = trips.get(params.tripId);
        if (!record) return error(404, 'NOT_FOUND', '여행을 찾을 수 없습니다.');
        if (session.tripId !== record.trip.id) {
          return error(403, 'FORBIDDEN', '이 여행에 접근할 권한이 없습니다.');
        }
        return {
          status: 200,
          body: { trip: tripOf(record), members: record.members, conditions: null },
        };
      },
    },
    // 파티 나가기·없애기(v2.4). 서버처럼 방장은 나갈 수 없고, 나가기는 회의 시작 전에만·없애기는 회의 도는 중에는 막는다.
    {
      method: 'DELETE',
      path: `${API_PREFIX}/trips/:tripId/members/me`,
      handler: ({ params, headers }) =>
        withTrip(headers, params.tripId, (session, record) => {
          const member = record.members.find((m) => m.id === session.member.id);
          if (!member) return error(404, 'NOT_FOUND', '구성원을 찾을 수 없습니다.');
          if (member.isHost) return error(403, 'FORBIDDEN', '방장은 나갈 수 없습니다. 파티를 없애 주세요.');
          if (record.trip.status !== 'preparing') return error(409, 'CONFLICT', '회의가 시작된 뒤에는 나갈 수 없습니다.');
          record.members = record.members.filter((m) => m.id !== member.id);
          for (const [token, s] of sessions) if (s.member.id === member.id) sessions.delete(token);
          return { status: 204, body: undefined };
        }),
    },
    {
      method: 'DELETE',
      path: `${API_PREFIX}/trips/:tripId`,
      handler: ({ params, headers }) =>
        withTrip(headers, params.tripId, (session, record) => {
          if (!record.members.some((m) => m.id === session.member.id && m.isHost)) return error(403, 'FORBIDDEN', '방장만 파티를 없앨 수 있습니다.');
          if (record.trip.status === 'meeting') return error(409, 'CONFLICT', '회의가 도는 중에는 없앨 수 없습니다.');
          trips.delete(record.trip.id);
          tripIdByCode.delete(record.trip.inviteCode);
          for (const [token, s] of sessions) if (s.tripId === record.trip.id) sessions.delete(token);
          return { status: 204, body: undefined };
        }),
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/persona/questions`,
      handler: () => ({ status: 200, body: { questions: MOCK_QUESTIONS } }),
    },
    {
      method: 'POST',
      path: `${API_PREFIX}/me/persona`,
      handler: ({ headers, body }) => {
        const session = authenticate(headers);
        if (session === null) return unauthorized();
        const state = validateAnswers(asObject(body).answers);
        if (typeof state === 'string') return error(400, 'VALIDATION_ERROR', state);
        const { member } = session;
        const count = submitCounts.get(member.id) ?? 0;
        const persona = buildRulePersona({
          member: { id: member.id, nickname: member.nickname, color: member.color, no: session.no },
          answers: state,
          questions: MOCK_QUESTIONS,
          source: count < LLM_LIMIT ? 'llm' : 'rule',
          now: nowKst(),
        });
        submitCounts.set(member.id, count + 1);
        personas.set(member.id, persona);
        member.personaReady = true;
        member.title = persona.title;
        member.chips = persona.chips;
        return { status: 201, body: { persona } };
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/me/persona`,
      handler: ({ headers }) => {
        const session = authenticate(headers);
        if (session === null) return unauthorized();
        const persona = personas.get(session.member.id);
        if (!persona) return error(404, 'NOT_FOUND', '아직 만든 페르소나가 없습니다.');
        return { status: 200, body: { persona } };
      },
    },
    ...(meetings === undefined ? [] : meetingRoutes(meetings)),
  ];
}
