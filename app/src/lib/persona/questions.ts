import type {
  Chip,
  InviteInfo,
  Member,
  MustKeep,
  Persona,
  PickedOption,
  Question,
  SessionResponse,
  Trait,
  TraitLevel,
  Trip,
  TripStatus,
} from './types.ts';

const STATUSES: readonly string[] = ['preparing', 'meeting', 'voting', 'confirmed'];
const LEVELS: readonly string[] = ['low', 'neutral', 'high'];

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

// 값이 없으면(undefined·null) 빈 문자열로 받는다.
function optStr(o: Obj, key: string, label: string): string {
  const value = o[key];
  if (value === undefined || value === null) return '';
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

function parseOption(value: unknown, label: string): PickedOption {
  const o = obj(value, label);
  return {
    id: str(o, 'id', label),
    text: str(o, 'text', label),
    emoji: optStr(o, 'emoji', label),
  };
}

function parseQuestion(value: unknown, index: number): Question {
  const label = `${index + 1}번째 문항`;
  const o = obj(value, label);
  const id = str(o, 'id', label);
  const order = int(o, 'order', label);
  const text = str(o, 'text', label);
  const type = o.type;

  if (type === 'scale') {
    const min = int(o, 'min', label);
    const max = int(o, 'max', label);
    if (min >= max) return fail(`${label}의 min·max 범위가 올바르지 않습니다.`);
    return {
      id,
      order,
      type: 'scale',
      text,
      min,
      max,
      minLabel: str(o, 'minLabel', label),
      maxLabel: str(o, 'maxLabel', label),
    };
  }
  if (type === 'multi') {
    const minSelect = int(o, 'minSelect', label);
    const maxSelect = int(o, 'maxSelect', label);
    if (minSelect < 0 || minSelect > maxSelect) {
      return fail(`${label}의 minSelect·maxSelect 범위가 올바르지 않습니다.`);
    }
    const raw = arr(o, 'options', label);
    if (raw.length === 0) return fail(`${label}의 options가 비어 있습니다.`);
    const options = raw.map((item) => parseOption(item, `${label}의 선택지`));
    return { id, order, type: 'multi', text, minSelect, maxSelect, options };
  }
  if (type === 'text') {
    const maxLength = num(o, 'maxLength', label);
    if (!Number.isInteger(maxLength) || maxLength <= 0) {
      return fail(`${label}의 maxLength 값이 양의 정수가 아닙니다.`);
    }
    return {
      id,
      order,
      type: 'text',
      text,
      required: bool(o, 'required', label),
      maxLength,
      placeholder: optStr(o, 'placeholder', label),
    };
  }
  return fail(`${label}의 type 값을 알 수 없습니다: ${String(type)}`);
}

export function parseQuestions(json: unknown): Question[] {
  const list = arr(obj(json, '문항 응답'), 'questions', '문항 응답');
  return list.map(parseQuestion).sort((a, b) => a.order - b.order);
}

function parseChip(value: unknown, index: number): Chip {
  const label = `${index + 1}번째 칩`;
  const o = obj(value, label);
  return { label: str(o, 'label', label), emoji: str(o, 'emoji', label) };
}

function parseTrait(value: unknown, index: number): Trait {
  const label = `${index + 1}번째 성향`;
  const o = obj(value, label);
  const level = str(o, 'level', label);
  if (!LEVELS.includes(level)) return fail(`${label}의 level 값이 올바르지 않습니다: ${level}`);
  return {
    key: str(o, 'key', label),
    name: str(o, 'name', label),
    score: num(o, 'score', label),
    level: level as TraitLevel,
    label: str(o, 'label', label),
    emoji: str(o, 'emoji', label),
  };
}

function parseMustKeep(value: unknown, index: number): MustKeep {
  const label = `${index + 1}번째 mustKeep 항목`;
  const o = obj(value, label);
  return { type: str(o, 'type', label), label: str(o, 'label', label) };
}

// 문자열은 그대로, { label } 또는 { text } 객체는 그 문자열 값으로 받는다.
function parseWish(value: unknown, index: number): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const o = value as Obj;
    if (typeof o.label === 'string') return o.label;
    if (typeof o.text === 'string') return o.text;
  }
  return fail(`페르소나의 ${index + 1}번째 wishes 항목 형식이 올바르지 않습니다.`);
}

export function parsePersona(json: unknown): Persona {
  const root = obj(json, '페르소나 응답');
  if (!('persona' in root)) return fail('페르소나 응답에 persona가 없습니다.');
  const label = '페르소나';
  const o = obj(root.persona, label);
  const source = o.source;
  if (source !== 'llm' && source !== 'rule') {
    return fail(`페르소나의 source 값이 올바르지 않습니다: ${String(source)}`);
  }
  return {
    memberId: str(o, 'memberId', label),
    nickname: str(o, 'nickname', label),
    color: str(o, 'color', label),
    no: int(o, 'no', label),
    title: str(o, 'title', label),
    catchphrase: str(o, 'catchphrase', label),
    tmi: str(o, 'tmi', label),
    chips: arr(o, 'chips', label).map(parseChip),
    traits: arr(o, 'traits', label).map(parseTrait),
    likes: arr(o, 'likes', label).map((item) => parseOption(item, '페르소나의 likes 항목')),
    dislikes: arr(o, 'dislikes', label).map((item) => parseOption(item, '페르소나의 dislikes 항목')),
    mustKeep: arr(o, 'mustKeep', label).map(parseMustKeep),
    wishes: arr(o, 'wishes', label).map(parseWish),
    source,
    updatedAt: str(o, 'updatedAt', label),
  };
}

export function parseMember(json: unknown): Member {
  const o = obj(json, '구성원');
  const title = o.title;
  if (title !== null && typeof title !== 'string') {
    return fail('구성원의 title 값이 문자열 또는 null이 아닙니다.');
  }
  return {
    id: str(o, 'id', '구성원'),
    nickname: str(o, 'nickname', '구성원'),
    color: str(o, 'color', '구성원'),
    isHost: bool(o, 'isHost', '구성원'),
    personaReady: bool(o, 'personaReady', '구성원'),
    title,
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
