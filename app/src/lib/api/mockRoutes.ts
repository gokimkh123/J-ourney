import { buildRulePersona } from '../persona/scoring.ts';
import type { AnswerState, Member, Persona, Trip } from '../persona/types.ts';
import { memberColors } from '../theme.ts';
import type { MockRoute } from './mock.ts';
import { MOCK_QUESTIONS } from './mockQuestions.ts';

type MockResult = ReturnType<MockRoute['handler']>;

type TripRecord = { trip: Trip; members: Member[] };
type Session = { tripId: string; member: Member; no: number };

const API_PREFIX = '/api/v1';
const MAX_MEMBERS = 4;
const FIRST_INVITE_CODE = 'BSN482';
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// 실서버의 AI 한도를 흉내 낸다: 구성원당 이 횟수까지만 source가 'llm'이다.
const LLM_LIMIT = 2;

const SEEDS = [
  { nickname: '지은', title: '반짝반짝 탐험가' },
  { nickname: '현우', title: '꼼꼼한 맛집 플래너' },
  { nickname: '서연', title: '느긋한 힐러' },
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
function nowKst(): string {
  const d = new Date(Date.now() + KST_OFFSET_MS);
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
      if (ids.length < question.minSelect || ids.length > question.maxSelect) {
        return `${n}번 문항은 ${question.minSelect}~${question.maxSelect}개를 골라 주세요.`;
      }
      state[question.id] = { type: 'multi', optionIds: ids };
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

export function createMockRoutes(): MockRoute[] {
  const trips = new Map<string, TripRecord>();
  const tripIdByCode = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const personas = new Map<string, Persona>();
  const submitCounts = new Map<string, number>();
  let tripCount = 0;
  let memberCount = 0;

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

  function addMember(record: TripRecord, nickname: string, title: string | null = null): Member {
    memberCount += 1;
    const member: Member = {
      id: `mem_${String(memberCount).padStart(2, '0')}`,
      nickname,
      color: memberColors[record.members.length],
      isHost: record.members.length === 0,
      personaReady: title !== null,
      title,
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

  function authenticate(headers: Record<string, string>): Session | null {
    const match = /^Bearer (.+)$/.exec(headers.authorization ?? '');
    return match ? (sessions.get(match[1]) ?? null) : null;
  }

  return [
    {
      method: 'POST',
      path: `${API_PREFIX}/trips`,
      handler: ({ body }) => {
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
        };
        trips.set(record.trip.id, record);
        tripIdByCode.set(inviteCode, record.trip.id);
        const host = addMember(record, nickname);
        if (o.demoMode === true) {
          for (const seed of SEEDS) addMember(record, seed.nickname, seed.title);
        }
        return issue(record, host);
      },
    },
    {
      method: 'POST',
      path: `${API_PREFIX}/invites/:inviteCode/join`,
      handler: ({ params, body }) => {
        const record = findByCode(params.inviteCode);
        if (!record) return error(404, 'NOT_FOUND', '초대 코드를 찾을 수 없습니다.');
        const nickname = cleanText(asObject(body).nickname, 20);
        if (nickname === null) {
          return error(400, 'VALIDATION_ERROR', '닉네임은 1~20자로 입력해 주세요.');
        }
        if (record.members.length >= MAX_MEMBERS) {
          return error(409, 'TRIP_FULL', `여행 인원이 가득 찼습니다. (최대 ${MAX_MEMBERS}명)`);
        }
        return issue(record, addMember(record, nickname));
      },
    },
    {
      method: 'GET',
      path: `${API_PREFIX}/invites/:inviteCode`,
      handler: ({ params }) => {
        const record = findByCode(params.inviteCode);
        if (!record) return error(404, 'NOT_FOUND', '초대 코드를 찾을 수 없습니다.');
        return { status: 200, body: { trip: record.trip, members: record.members } };
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
          body: { trip: record.trip, members: record.members, conditions: null },
        };
      },
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
  ];
}
