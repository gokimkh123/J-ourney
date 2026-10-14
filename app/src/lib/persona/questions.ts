import type {
  InviteInfo,
  Member,
  Persona,
  PersonaAxis,
  Question,
  ScaleAxis,
  SessionResponse,
  Trip,
  TripStatus,
} from './types.ts';

const AXES: readonly string[] = ['EI', 'SN', 'TF', 'JP'];
const STATUSES: readonly string[] = ['preparing', 'meeting', 'voting', 'confirmed'];

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function obj(value: unknown, label: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label}이(가) 객체 형식이 아닙니다.`);
  }
  return value as Obj;
}

function str(o: Obj, key: string, label: string): string {
  const value = o[key];
  if (typeof value !== 'string') return fail(`${label}의 ${key} 값이 문자열이 아닙니다.`);
  return value;
}

function bool(o: Obj, key: string, label: string): boolean {
  const value = o[key];
  if (typeof value !== 'boolean') return fail(`${label}의 ${key} 값이 true/false가 아닙니다.`);
  return value;
}

function num(o: Obj, key: string, label: string): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${label}의 ${key} 값이 숫자가 아닙니다.`);
  }
  return value;
}

function int(o: Obj, key: string, label: string): number {
  const value = num(o, key, label);
  if (!Number.isInteger(value)) return fail(`${label}의 ${key} 값이 정수가 아닙니다.`);
  return value;
}

function arr(o: Obj, key: string, label: string): unknown[] {
  const value = o[key];
  if (!Array.isArray(value)) return fail(`${label}의 ${key} 값이 배열이 아닙니다.`);
  return value;
}

function strArr(o: Obj, key: string, label: string): string[] {
  const list = arr(o, key, label);
  if (!list.every((item) => typeof item === 'string')) {
    return fail(`${label}의 ${key} 값이 문자열 배열이 아닙니다.`);
  }
  return list as string[];
}

function parseQuestion(value: unknown, index: number): Question {
  const label = `${index + 1}번째 문항`;
  const o = obj(value, label);
  const id = str(o, 'id', label);
  const order = int(o, 'order', label);
  const text = str(o, 'text', label);
  const type = o.type;

  if (type === 'scale') {
    const axis = str(o, 'axis', label);
    if (!AXES.includes(axis)) return fail(`${label}의 axis 값이 올바르지 않습니다: ${axis}`);
    return {
      id,
      order,
      type: 'scale',
      axis: axis as ScaleAxis,
      text,
      left: str(o, 'left', label),
      right: str(o, 'right', label),
    };
  }
  if (type === 'multi') {
    const raw = arr(o, 'options', label);
    if (raw.length === 0) return fail(`${label}의 options가 비어 있습니다.`);
    const options = raw.map((item) => {
      const option = obj(item, `${label}의 선택지`);
      return {
        id: str(option, 'id', `${label}의 선택지`),
        text: str(option, 'text', `${label}의 선택지`),
      };
    });
    return { id, order, type: 'multi', text, options };
  }
  if (type === 'text') {
    const maxLength = num(o, 'maxLength', label);
    if (!Number.isInteger(maxLength) || maxLength <= 0) {
      return fail(`${label}의 maxLength 값이 양의 정수가 아닙니다.`);
    }
    return { id, order, type: 'text', text, required: bool(o, 'required', label), maxLength };
  }
  return fail(`${label}의 type 값을 알 수 없습니다: ${String(type)}`);
}

export function parseQuestions(json: unknown): Question[] {
  const list = arr(obj(json, '문항 응답'), 'questions', '문항 응답');
  return list.map(parseQuestion).sort((a, b) => a.order - b.order);
}

function parseAxis(value: unknown, index: number): PersonaAxis {
  const label = `${index + 1}번째 축`;
  const o = obj(value, label);
  const pair = str(o, 'pair', label);
  if (!AXES.includes(pair)) return fail(`${label}의 pair 값이 올바르지 않습니다: ${pair}`);
  return {
    pair: pair as ScaleAxis,
    letter: str(o, 'letter', label),
    percent: num(o, 'percent', label),
  };
}

export function parsePersona(json: unknown): Persona {
  const root = obj(json, '페르소나 응답');
  if (!('persona' in root)) return fail('페르소나 응답에 persona가 없습니다.');
  const o = obj(root.persona, '페르소나');
  const source = o.source;
  if (source !== 'llm' && source !== 'template') {
    return fail(`페르소나의 source 값이 올바르지 않습니다: ${String(source)}`);
  }
  return {
    memberId: str(o, 'memberId', '페르소나'),
    mbti: str(o, 'mbti', '페르소나'),
    title: str(o, 'title', '페르소나'),
    summary: str(o, 'summary', '페르소나'),
    speechStyle: str(o, 'speechStyle', '페르소나'),
    axes: arr(o, 'axes', '페르소나').map(parseAxis),
    interests: strArr(o, 'interests', '페르소나'),
    mustDo: strArr(o, 'mustDo', '페르소나'),
    dealBreakers: strArr(o, 'dealBreakers', '페르소나'),
    source,
  };
}

export function parseMember(json: unknown): Member {
  const o = obj(json, '구성원');
  const mbti = o.mbti;
  if (mbti !== null && typeof mbti !== 'string') {
    return fail('구성원의 mbti 값이 문자열 또는 null이 아닙니다.');
  }
  return {
    id: str(o, 'id', '구성원'),
    nickname: str(o, 'nickname', '구성원'),
    color: str(o, 'color', '구성원'),
    isHost: bool(o, 'isHost', '구성원'),
    personaReady: bool(o, 'personaReady', '구성원'),
    mbti,
  };
}

function parseTrip(json: unknown): Trip {
  const o = obj(json, '여행');
  const status = str(o, 'status', '여행');
  if (!STATUSES.includes(status)) return fail(`여행의 status 값이 올바르지 않습니다: ${status}`);
  return {
    id: str(o, 'id', '여행'),
    title: str(o, 'title', '여행'),
    inviteCode: str(o, 'inviteCode', '여행'),
    status: status as TripStatus,
  };
}

export function parseSessionResponse(json: unknown): SessionResponse {
  const o = obj(json, '세션 응답');
  return {
    trip: parseTrip(o.trip),
    member: parseMember(o.member),
    token: str(o, 'token', '세션 응답'),
  };
}

export function parseInviteInfo(json: unknown): InviteInfo {
  const o = obj(json, '초대 정보');
  return {
    trip: parseTrip(o.trip),
    members: arr(o, 'members', '초대 정보').map(parseMember),
  };
}
