// 6단계 동선 × 14단계 고치기 시뮬레이션 (11/2 점검): 무작위 여행(항공편·예약한 곳·꼭 지킬 곳·밤 행사 포함)마다 무작위 고치기를 이어 하며 규칙을 매번 검사 (가짜 길찾기, LLM 0 · 카카오 0)
// 찾은 것: 다른 날에 사람이 고른 식당을 앞 날에 또 씀 · 끼니 자리를 정한 날에 점심이 저녁 뒤 · 저녁에 여는 예약 장소가 조용히 빠짐
import { describe, expect, it } from 'vitest';
import { categories, places, regions } from '../src/db/schema.js';
import type { Candidate, MemberInput, RetrieveResult } from '../src/meeting/retrieve.js';
import type { RouteClient } from '../src/meeting/route.js';
import { type HumanEdit, type PlanProposal, type ScheduleInput, editPlan, schedulePlans } from '../src/meeting/schedule.js';
import { distanceKm } from '../src/meeting/travel.js';
import type { Board } from '../src/meeting/types.js';
import type { MustKeepRule, PersonaProfile } from '../src/persona/types.js';
import { createTestApp } from './helpers.js';

const router: RouteClient = {
  async car(a, b) { const km = distanceKm(a, b); return { minutes: Math.max(1, Math.round(km * 2 + 3)), distanceM: Math.round(km * 1300), taxiFare: Math.round(4800 + km * 1300), toll: 0 }; },
  async transit(a, b) { const km = distanceKm(a, b); return { minutes: Math.round(km * 5 + 10), distanceM: Math.round(km * 1300), fare: 1550, transfers: 0, type: 'BUS', lines: ['1003'], url: 'https://map.kakao.com/test' }; },
  async walk(a, b) { const km = distanceKm(a, b); return { minutes: Math.max(1, Math.round(((km * 1.3) / 4.5) * 60)), distanceM: Math.round(km * 1300), url: null }; },
};
let s = 20261102;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const profile = (p: Partial<PersonaProfile>): PersonaProfile => ({ placesPerDay: [3, 4], maxSteps: 15000, startTime: '09:30', endTime: null, freeMinutes: 30, weights: { price: 0, crowd: 0, popularity: 0 }, maxMoveMinutes: null, maxCrowd: null, maxMealPrice: null, budgetPerPerson: null, avoidQueue: false, includes: [], avoids: [], likes: [], ...p });
const rule = (label: string, booked?: 'place'): MustKeepRule => ({ type: 'include', label, quote: label, keyword: label, target: 'place', codes: [], start: null, end: null, amount: null, ...(booked ? { booked } : {}) });
let seq = 0;

function checkPlan(p: PlanProposal, arrival: string | null, departure: string | null, where: string): string[] {
  const bad: string[] = [];
  const ids = p.route.flatMap((d) => d.stops.filter((x) => x.kind !== 'lodging').map((x) => x.placeId));
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) bad.push(`${where} 같은 곳 두 번 ${[...new Set(dup)].map((id) => p.route.flatMap((d) => d.stops.filter((x) => x.placeId === id).map((x) => `${d.day}일째 ${x.kind}${x.meal ? '/' + x.meal : ''}`)).join('·') + ' ' + id).join(' | ')}`);
  for (const [i, d] of p.route.entries()) {
    const k = d.stops.map((x) => (x.meal ? x.meal : x.night ? 'night' : x.kind));
    const L = k.indexOf('lunch'), D = k.indexOf('dinner'), N = k.indexOf('night');
    if (k.filter((x) => x === 'lunch').length > 1 || k.filter((x) => x === 'dinner').length > 1) bad.push(`${where} ${i + 1}일째 끼니 중복`);
    if (L >= 0 && D >= 0 && L > D) bad.push(`${where} ${i + 1}일째 점심이 저녁 뒤`);
    if (N >= 0 && D >= 0 && N < D) bad.push(`${where} ${i + 1}일째 야경이 저녁 앞`);
    if (i === 0 && arrival && toMin(arrival) + 60 >= 810 && L >= 0) bad.push(`${where} 늦은 도착인데 점심`);
    if (i === p.route.length - 1 && departure && toMin(departure) - 120 <= 1050 && (D >= 0 || N >= 0)) bad.push(`${where} 이른 출발인데 저녁·야경`);
  }
  return bad;
}

describe('6단계 동선 × 14단계 고치기 시뮬레이션', { timeout: 120_000 }, () => {
  it('무작위 15개 여행 × 고치기 12번: 예외 없음 · 같은 곳(식당 포함)이 두 번 들어가지 않음 · 점심은 저녁 앞 · 야경은 저녁 뒤 · 늦은 도착·이른 출발 날의 끼니 · 버전은 반영할 때만 오름 · 못 넣은 예약한 곳은 메모', async () => {
    const problems: string[] = [];
    const stats = { trips: 0, edits: 0, applied: 0, skipped: 0, notes: new Map<string, number>(), exceptions: 0 };
    for (let t = 0; t < 15; t++) {
      const { db } = await createTestApp();
      await db.insert(regions).values([{ regionCode: '26', regionName: '부산광역시', districtCode: '500', districtName: '수영구' }]);
      await db.insert(categories).values([{ code: 'FD010100', name1: '음식', name2: '한식', name3: '관광식당' }]);
      const restCount = 4 + Math.floor(rnd() * 6);
      await db.insert(places).values(Array.from({ length: restCount }, (_, i) => ({ contentId: `r${t}_${i}`, contentTypeId: 39, title: `식당${i}`, regionCode: '26', districtCode: '500', lcls1: 'FD', lcls3: 'FD010100', lat: 35.15 + rnd() * 0.04, lng: 129.1 + rnd() * 0.05, visible: true, listRaw: {}, overview: null, introRaw: { opentimefood: pick(['10:00~22:00', '11:00~21:00', '17:00~23:00', '11:30~15:00']), restdatefood: pick(['연중무휴', '매주 월요일', '매주 토요일']) }, detailSyncedAt: new Date() })));
      const D = 1 + Math.floor(rnd() * 3);
      const dates = Array.from({ length: D }, (_, i) => `2026-11-${String(7 + i).padStart(2, '0')}`);
      const nMembers = 2 + Math.floor(rnd() * 3);
      const ms: MemberInput[] = Array.from({ length: nMembers }, (_, i) => ({ memberId: `m${i}`, nickname: `m${i}`, title: `m${i}`, likes: rnd() < 0.4 ? ['like_night'] : [], dislikes: [], mustKeep: [], profile: profile({ placesPerDay: pick([[2, 3], [3, 4], [5, 6]] as [number, number][]), startTime: pick(['08:30', '09:30', '10:30']), endTime: pick([null, null, '20:00', '22:00']) }) }));
      const nC = 12 + Math.floor(rnd() * 18);
      const cands: Candidate[] = Array.from({ length: nC }, (_, i) => {
        const night = rnd() < 0.08;
        const evening = !night && rnd() < 0.08;
        return {
          id: `c${++seq}`, name: `곳${i}`, type: pick([12, 12, 12, 14, 28]), category: null, popularity: Math.floor(rnd() * 100), crowd: null, hours: null,
          open: night ? { open: 600, close: 1380 } : evening ? { open: 1080, close: 1380 } : rnd() < 0.3 ? { open: 540, close: 1080 } : null,
          restUnknown: false, code: night ? 'VE010200' : 'NA020900', rest: rnd() < 0.15 ? '매주 토요일' : null, summary: '', menu: null,
          lat: 35.14 + rnd() * 0.06, lng: 129.08 + rnd() * 0.08, scores: {}, total: 0, reasons: {}, marks: {}, forMembers: [],
        };
      });
      // 꼭 지킬 곳 (사람 규칙) · 예약한 곳 (모두의 꼭 지킬 곳 + 방장 규칙)
      for (const m of ms) if (rnd() < 0.4) { const c = pick(cands); const label = `${m.memberId} 꼭 ${c.name}`; c.marks[m.memberId] = [...(c.marks[m.memberId] ?? []), { kind: 'must', label }]; m.mustKeep = [...m.mustKeep, rule(label)]; }
      const booked: Candidate[] = [];
      if (rnd() < 0.5) for (const c of [pick(cands), ...(rnd() < 0.4 ? [pick(cands)] : [])]) {
        if (booked.includes(c)) continue;
        const label = `예약한 곳: ${c.name}`;
        for (const m of ms) c.marks[m.memberId] = [...(c.marks[m.memberId] ?? []), { kind: 'must', label }];
        ms[0].mustKeep = [...ms[0].mustKeep, rule(label, 'place')];
        c.booked = true;
        booked.push(c);
      }
      for (const m of ms) for (const c of cands) if (rnd() < 0.2) c.marks[m.memberId] = [...(c.marks[m.memberId] ?? []), { kind: 'like', label: '바다' }];
      const board: Board = { candidates: cands.map((c) => ({ placeId: `plc_${c.id}`, name: c.name, lat: c.lat, lng: c.lng, proposedBy: rnd() < 0.3 ? ['agt_m0'] : [], reactions: rnd() < 0.1 ? [{ agentId: 'agt_m1', kind: 'block' as const, reason: '시험' }] : [] })), agenda: [] };
      const lodgings: Candidate[] = D > 1 ? [{ ...cands[0], id: `h${++seq}`, name: '호텔', type: 32, code: 'AC010100', open: null, rest: null, marks: {} }] : [];
      const pool: RetrieveResult = { destination: { regionCode: '26', regionName: '부산광역시', districtCodes: ['500'], label: '부산 수영구' }, dates, candidates: cands, nights: D - 1, lodgings, stages: [], excluded: [], popularity: { baseYm: null, matched: 0 }, crowd: { fetched: [], cached: [], matched: 0, note: null }, sources: [], baseDate: '2026-11-02', outsideRules: [], nameMatches: [], missingRules: [] };
      const arrival = rnd() < 0.5 ? hhmm(480 + Math.floor(rnd() * 12) * 60) : null;
      let departure = rnd() < 0.5 ? hhmm(780 + Math.floor(rnd() * 9) * 60) : null;
      if (D === 1 && arrival && departure && arrival >= departure) departure = null;
      const input: ScheduleInput = { meetingId: `mtg_sim${t}`, pool, board, members: ms, decision: null, moveMode: rnd() < 0.3 ? 'car' : 'transit', arrivalTime: arrival, departureTime: departure };
      let res;
      try { res = await schedulePlans(db, router, input); } catch (err) { stats.exceptions++; problems.push(`여행 ${t} 6단계 예외 ${(err as Error).message}`); continue; }
      stats.trips++;
      for (const p of res.plans) {
        problems.push(...checkPlan(p, arrival, departure, `여행 ${t} ${p.label}안`).map((x) => x));
        // 예약한 곳: 여는 날이 있으면 두 안 모두
        for (const c of booked) {
          const openSome = dates.some((d) => !(c.rest && new Date(`${d}T00:00:00Z`).getUTCDay() === 6));
          const has = p.route.some((d) => d.stops.some((x) => x.placeId === `plc_${c.id}`));
          if (openSome && !has && !p.notes.some((x) => x.startsWith(`${c.name} — 꼭 지킬 곳이지만`))) problems.push(`여행 ${t} ${p.label}안 예약한 ${c.name} 없음·메모 없음`);
        }
      }
      // 14단계 고치기 무작위 12번
      let cur = { plan: res.plans[0], state: res.states.A };
      for (let k = 0; k < 12; k++) {
        const plan = cur.plan;
        const d = Math.floor(rnd() * plan.route.length);
        const stops = plan.route[d].stops;
        const sights = stops.filter((x) => x.kind === 'sight');
        const meals = stops.filter((x) => x.kind === 'food' && x.meal);
        const inPlan = new Set(plan.route.flatMap((dd) => dd.stops.map((x) => x.placeId)));
        const free = cands.filter((c) => !inPlan.has(`plc_${c.id}`));
        const kind = pick(['remove', 'add', 'move', 'meal', 'reorder', 'reorderMeals', 'reorderMeals', 'stale']);
        let e: HumanEdit | null = null;
        if (kind === 'remove' && sights.length) e = { type: 'remove', itemId: pick(sights).itemId };
        else if (kind === 'add' && free.length) e = { type: 'add', placeId: `plc_${pick(free).id}`, day: d };
        else if (kind === 'move' && sights.length && plan.route.length > 1) e = { type: 'move', itemId: pick(sights).itemId, day: (d + 1) % plan.route.length };
        else if (kind === 'meal' && meals.length) e = { type: 'meal', itemId: pick(meals).itemId, placeId: null };
        else if (kind === 'reorder' && sights.length) e = { type: 'reorder', day: d, itemIds: [...sights].sort(() => rnd() - 0.5).map((x) => x.itemId) };
        else if (kind === 'reorderMeals' && sights.length) {
          const order = [...sights, ...meals].sort(() => rnd() - 0.5).map((x) => x.placeId);
          e = { type: 'reorder', day: d, placeIds: order };
        } else if (kind === 'stale') e = { type: 'remove', itemId: `itm_a1_none${k}` };
        if (!e) continue;
        stats.edits++;
        try {
          const out = await editPlan(db, router, input, cur, [e]);
          const r = out.results[0];
          if (r.applied) stats.applied++; else stats.skipped++;
          const key = `${e.type}${kind === 'reorderMeals' ? '+끼니' : ''}: ${r.applied ? '반영' : r.note}`;
          stats.notes.set(key, (stats.notes.get(key) ?? 0) + 1);
          if (r.applied && out.plan.version !== plan.version + 1) problems.push(`여행 ${t} 버전이 안 오름`);
          if (!r.applied && out.plan.version !== plan.version) problems.push(`여행 ${t} 반영 못 했는데 버전이 오름`);
          problems.push(...checkPlan(out.plan, arrival, departure, `여행 ${t} 고치기 ${kind}`));
          // 끼니까지 순서를 정해 반영했으면: 그날 관광지(밤 행사·야경 뒤 자리 빼고)·끼니가 사람이 정한 순서대로
          if (kind === 'reorderMeals' && r.applied && e.type === 'reorder') {
            const got = out.plan.route[d].stops.filter((x) => x.kind !== 'lodging' && !x.night).map((x) => x.placeId);
            const want = (e.placeIds ?? []).filter((id) => got.includes(id));
            const gotInWant = got.filter((id) => want.includes(id));
            const late = (id: string) => { const c = cands.find((x) => `plc_${x.id}` === id); return !!c?.open && c.open.open >= 1050; };
            const wantEarly = want.filter((id) => !late(id));
            const gotEarly = gotInWant.filter((id) => !late(id));
            if (JSON.stringify(gotEarly) !== JSON.stringify(wantEarly)) problems.push(`여행 ${t} 끼니 순서가 요청과 다름(저녁 뒤 곳 빼고) ${JSON.stringify(wantEarly)} → ${JSON.stringify(gotEarly)}`);
          }
          cur = { plan: out.plan, state: out.state };
        } catch (err) {
          stats.exceptions++;
          problems.push(`여행 ${t} 고치기 ${kind} 예외 ${(err as Error).message}`);
        }
      }
    }
    expect(stats.exceptions).toBe(0);
    expect(problems).toEqual([]);
    expect(stats.applied).toBeGreaterThan(stats.edits / 2); // 고치기 대부분이 실제로 반영됨 (검사가 헛돌지 않게)
  });
});
