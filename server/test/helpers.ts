import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type AppOptions, createApp } from '../src/app.js';
import { migrationsFolder } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

/** 메모리 안의 PostgreSQL(PGlite)에 실제 마이그레이션을 적용한 시험용 서버 */
export async function createTestApp(options: Omit<AppOptions, 'db'> = {}) {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  // 시험은 요청이 많으므로 요청 제한을 넉넉히 둠 (제한 자체는 따로 시험함)
  return { app: createApp({ db, rateLimitPerMinute: 1000, destinationLlm: destinationLlm(), ...options }), db };
}

type TestApp = ReturnType<typeof createApp>;

/** JSON 요청을 보내고 상태 코드와 본문을 돌려줌 */
export async function call(app: TestApp, method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** 시험용 가짜 LLM: respond가 돌려준 값을 스키마로 검사해 돌려줌 (system: LLM에 보낸 지시문, schema: 응답 형식) */
export function fakeLlm(respond: (input: any, call: number, system: string, schema: import('zod').ZodType) => unknown) {
  const fake = {
    name: 'fake',
    calls: 0,
    async generateJson<T extends import('zod').ZodType>(req: import('../src/llm/client.js').JsonRequest<T>) {
      fake.calls++;
      return req.schema.parse(await respond(req.input, fake.calls, req.system, req.schema)) as import('zod').infer<T>;
    },
    /** 글자 단위 받기: 같은 응답을 세 조각으로 나눠 보냄 */
    async streamJson<T extends import('zod').ZodType>(req: import('../src/llm/client.js').JsonRequest<T>, onText: (text: string) => void) {
      const value = await fake.generateJson(req);
      const text = JSON.stringify(value);
      for (const end of [Math.ceil(text.length / 3), Math.ceil((text.length * 2) / 3), text.length]) onText(text.slice(0, end));
      return { value, model: 'fake', text, usage: { input: 100, output: 50 }, ms: 1 };
    },
  };
  return fake;
}

/**
 * 시험용 이름 맞추기 LLM 답 (2단계 place_names 요청): 목록 줄에서 이름에 그 말이 든 곳(음식은 메뉴 칸도)을 2곳까지 고름
 * 실제 LLM을 흉내 내는 시험 안에서만 글자를 비교함 (서버 코드는 글자로 맞추지 않음)
 */
export function nameAnswer(input: { rules: string[]; places: string }) {
  const lines = input.places ? input.places.split('\n').map((l) => l.split('|')) : [];
  const flat = (v: string | undefined) => (v ?? '').replace(/\s+/g, '');
  return {
    matches: input.rules.map((r, i) => {
      const [, target, keyword] = r.split('|');
      const k = flat(keyword);
      const hit = lines.filter((c) => flat(c[1]).includes(k) || (target === '음식' && (c[4] ?? '').startsWith('메뉴:') && flat(c[4]).includes(k)));
      return { rule: i + 1, evidence: hit.length ? '이름이나 메뉴에 있음' : '없음', places: hit.slice(0, 2).map((c) => c[0]) };
    }),
  };
}

/**
 * 시험용 지역 맞추기 LLM 답 (2단계 place_areas 요청): 사람이 쓴 말에 구·군 이름(시·군·구를 뗀 이름)이 있으면 그 구·군, 없으면 이름이 들어 있는 장소
 * 실제 LLM을 흉내 내는 시험 안에서만 글자를 비교함 (서버 코드는 글자로 맞추지 않음)
 */
export function areaAnswer(input: { rules: string[]; areas: string; places: string }) {
  const split = (t: string) => (t ? t.split('\n').map((l) => l.split('|')) : []);
  const flat = (v: string | undefined) => (v ?? '').replace(/\s+/g, '');
  const areas = split(input.areas);
  const places = split(input.places);
  return {
    matches: input.rules.map((r, i) => {
      const said = flat(r.split('|').slice(2).join('|'));
      const area = areas.find(([, name]) => flat(name).length > 1 && said.includes(flat(name).replace(/(시|군|구)$/, '')));
      const place = area ? undefined : places.find((c) => said.includes(flat(c[1])));
      return { rule: i + 1, evidence: area || place ? '말에 있음' : '없음', pick: area?.[0] ?? place?.[0] ?? '' };
    }),
  };
}

/**
 * 시험용 여행지 확인 LLM (조건 저장 때 destination 요청): 설명문 맨 아래 지역 표에서 방장 글과 이름이 맞는 곳의 번호를 고름
 * 예전 코드 규칙을 시험 안에서만 흉내 냄 (서버 코드는 글자로 맞추지 않음). createTestApp이 기본으로 끼움
 */
export function destinationLlm() {
  return fakeLlm((input, _call, system) => destinationAnswer(String(input.destination), system));
}
export function destinationAnswer(text: string, system: string) {
  const table = system
    .slice(system.lastIndexOf('regions:\n') + 'regions:\n'.length)
    .split('\n')
    .map((l) => l.split('|'));
  const flat = (v: string) => v.replace(/\s+/g, '');
  const short = (name: string) => {
    const m = name.match(/^(경상|충청|전라)(남|북)도$/);
    return m ? m[1][0] + m[2] : name.replace(/(통합특별시|특별자치시|특별자치도|특별시|광역시|도)$/, '');
  };
  const districtHit = (word: string, name: string) => {
    const w = flat(word);
    const n = flat(name);
    return w === n || w === n.replace(/(시|군|구)$/, '') || (w.length >= 2 && n.startsWith(w));
  };
  const answer = (picks: string[], candidates: string[] = []) => ({ evidence: picks.length || candidates.length ? '목록에 있음' : '없음', picks, candidates });
  const whole = table.filter((r) => r[2] === '전체');
  const parts = table.filter((r) => r[2] !== '전체');
  const [first, ...rest] = text.split(' ');
  const exact = whole.filter((r) => first === r[1] || first === short(r[1]));
  const regionHit = exact.length ? exact : whole.filter((r) => first.length >= 2 && short(r[1]).includes(first));
  if (regionHit.length === 1) {
    const region = regionHit[0];
    if (!rest.length) {
      const elsewhere = exact.length ? [] : parts.filter((r) => r[1] !== region[1] && districtHit(first, r[2]));
      return elsewhere.length ? answer([], [region[0], ...elsewhere.map((r) => r[0])]) : answer([region[0]]);
    }
    return answer(parts.filter((r) => r[1] === region[1] && districtHit(rest.join(' '), r[2])).map((r) => r[0]));
  }
  const hits = parts.filter((r) => districtHit(text, r[2]));
  if (new Set(hits.map((r) => r[1])).size > 1) return answer([], hits.map((r) => r[0]));
  return answer(hits.map((r) => r[0]));
}

/** 15문항 응답 만들기: scale은 q1–q12 점수 */
export function answersOf(scale: number[], likes: string[], dislikes: string[], text?: string) {
  return [
    ...scale.map((value, i) => ({ questionId: `q${i + 1}`, value })),
    { questionId: 'q13', optionIds: likes },
    { questionId: 'q14', optionIds: dislikes },
    ...(text === undefined ? [] : [{ questionId: 'q15', text }]),
  ];
}

/** 서연형: 느긋형·한적형·늦잠형 */
export const SEOYEON = [5, 2, 2, 5, 2, 5, 5, 9, 8, 6, 7, 5];
/** 민수형: 계획형·부지런형·명소형 (부지런형·명소형·아침형이 동점) */
export const MINSU = [9, 8, 6, 3, 8, 7, 2, 3, 5, 8, 3, 4];
