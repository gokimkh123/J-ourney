import { isComplete } from '../persona/answers.ts';
import { mockPersona } from '../persona/scoring.ts';
import type {
  Answer,
  AnswerState,
  Member,
  MultiQuestion,
  Persona,
  Question,
  ScaleAxis,
  ScaleQuestion,
  Trip,
} from '../persona/types.ts';
import { memberColors } from '../theme.ts';
import type { MockRoute } from './mock.ts';

type MockResult = ReturnType<MockRoute['handler']>;

type TripRecord = { trip: Trip; members: Member[] };
type Session = { tripId: string; member: Member };

const API_PREFIX = '/api/v1';
const MAX_MEMBERS = 4;
const FIRST_INVITE_CODE = 'BSN482';
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const SEEDS = [
  { nickname: '지은', mbti: 'ENFP' },
  { nickname: '현우', mbti: 'ISTJ' },
  { nickname: '서연', mbti: 'ISFP' },
];

// left는 앞 글자(E·S·T·J), right는 뒤 글자(I·N·F·P) 쪽 문장이다.
const SCALES: [ScaleAxis, string, string, string][] = [
  ['EI', '여행 중 쉬는 시간이 생기면?', '사람들과 수다 떨며 충전해요', '혼자 조용히 쉬며 충전해요'],
  ['EI', '처음 만난 여행객과는?', '먼저 말을 걸어요', '말을 걸어 오면 대답해요'],
  ['EI', '여행 마지막 밤에는?', '다 같이 늦게까지 놀아요', '숙소에서 일찍 쉬어요'],
  ['SN', '여행지를 고를 때는?', '후기와 평점을 꼼꼼히 봐요', '분위기와 느낌을 따라가요'],
  ['SN', '맛집을 찾을 때는?', '검증된 유명한 곳이 좋아요', '숨겨진 새로운 곳이 좋아요'],
  ['SN', '여행 사진을 찍을 때는?', '있는 그대로 기록해요', '이야기가 담긴 장면을 찾아요'],
  ['TF', '일정이 꼬였을 때는?', '가장 효율적인 대안을 찾아요', '모두의 기분부터 살펴요'],
  ['TF', '숙소를 고를 때는?', '가격과 위치를 따져요', '함께 갈 사람들의 취향을 먼저 생각해요'],
  ['TF', '친구가 고른 곳이 마음에 안 들면?', '솔직하게 이유를 말해요', '친구가 좋아하면 함께 가요'],
  ['JP', '여행 일정은?', '시간 단위로 미리 짜요', '그때그때 정해요'],
  ['JP', '짐을 쌀 때는?', '목록을 만들어 미리 챙겨요', '출발 직전에 챙겨요'],
  ['JP', '계획에 없던 장소를 발견하면?', '다음 여행으로 미뤄요', '바로 들러 봐요'],
];

const INTERESTS: MultiQuestion = {
  id: 'q13',
  order: 13,
  type: 'multi',
  text: '여행에서 관심 있는 것을 모두 골라 주세요.',
  options: [
    { id: 'q13_food', text: '맛집' },
    { id: 'q13_hotspring', text: '온천' },
    { id: 'q13_sea', text: '바다' },
    { id: 'q13_walk', text: '산책' },
    { id: 'q13_cafe', text: '카페' },
    { id: 'q13_shopping', text: '쇼핑' },
    { id: 'q13_night', text: '야경' },
    { id: 'q13_activity', text: '액티비티' },
  ],
};

const DEAL_BREAKERS: MultiQuestion = {
  id: 'q14',
  order: 14,
  type: 'multi',
  text: '여행에서 절대 싫은 것을 모두 골라 주세요.',
  options: [
    { id: 'q14_early', text: '새벽 기상' },
    { id: 'q14_crowd', text: '긴 줄' },
    { id: 'q14_longwalk', text: '오래 걷기' },
    { id: 'q14_tight', text: '빡빡한 일정' },
    { id: 'q14_spicy', text: '매운 음식' },
    { id: 'q14_noisy', text: '시끄러운 곳' },
  ],
};

const QUESTIONS: Question[] = [
  ...SCALES.map(
    ([axis, text, left, right], i): ScaleQuestion => ({
      id: `q${i + 1}`,
      order: i + 1,
      type: 'scale',
      axis,
      text,
      left,
      right,
    }),
  ),
  INTERESTS,
  DEAL_BREAKERS,
  {
    id: 'q15',
    order: 15,
    type: 'text',
    text: '이번 여행에서 꼭 하고 싶은 것이 있다면 적어 주세요.',
    required: false,
    maxLength: 100,
  },
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

function toAnswer(question: Question, item: Record<string, unknown>): Answer | null {
  if (question.type === 'scale') {
    const { value } = item;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4) {
      return null;
    }
    return { type: 'scale', value };
  }
  if (question.type === 'multi') {
    const { optionIds } = item;
    if (!Array.isArray(optionIds) || !optionIds.every((id) => typeof id === 'string')) {
      return null;
    }
    return { type: 'multi', optionIds: optionIds as string[] };
  }
  const { text } = item;
  return typeof text === 'string' ? { type: 'text', text } : null;
}

function toAnswerState(answers: unknown): AnswerState | null {
  if (!Array.isArray(answers)) return null;
  const state: AnswerState = {};
  for (const raw of answers) {
    const item = asObject(raw);
    const question = QUESTIONS.find((q) => q.id === item.questionId);
    if (!question) return null;
    const answer = toAnswer(question, item);
    if (answer === null) return null;
    state[question.id] = answer;
  }
  return state;
}

export function createMockRoutes(): MockRoute[] {
  const trips = new Map<string, TripRecord>();
  const tripIdByCode = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const personas = new Map<string, Persona>();
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

  function addMember(record: TripRecord, nickname: string, mbti: string | null = null): Member {
    memberCount += 1;
    const member: Member = {
      id: `mem_${String(memberCount).padStart(2, '0')}`,
      nickname,
      color: memberColors[record.members.length],
      isHost: record.members.length === 0,
      personaReady: mbti !== null,
      mbti,
    };
    record.members.push(member);
    return member;
  }

  function issue(record: TripRecord, member: Member): MockResult {
    const token = `tok_${member.id}_${randomCode()}`;
    sessions.set(token, { tripId: record.trip.id, member });
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
          for (const seed of SEEDS) addMember(record, seed.nickname, seed.mbti);
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
      handler: () => ({ status: 200, body: { questions: QUESTIONS } }),
    },
    {
      method: 'POST',
      path: `${API_PREFIX}/me/persona`,
      handler: ({ headers, body }) => {
        const session = authenticate(headers);
        if (session === null) return unauthorized();
        const state = toAnswerState(asObject(body).answers);
        if (state === null) return error(400, 'VALIDATION_ERROR', '답변 형식이 올바르지 않습니다.');
        if (!isComplete(QUESTIONS, state)) {
          return error(400, 'VALIDATION_ERROR', '모든 필수 문항에 답해 주세요.');
        }
        const { member } = session;
        const persona = mockPersona(member.id, state, QUESTIONS);
        personas.set(member.id, persona);
        member.personaReady = true;
        member.mbti = persona.mbti;
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
