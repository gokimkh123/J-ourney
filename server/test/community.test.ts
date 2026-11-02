import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { categories, meetingEvents, meetings, placeReviews, places, regions } from '../src/db/schema.js';
import { call, createTestApp } from './helpers.js';

/** 관광공사 장소 한 줄 (시험용) */
const place = (id: string, title: string, regionCode: string, lcls3: string, o: Partial<typeof places.$inferInsert> = {}) => ({
  contentId: id,
  contentTypeId: 12,
  title,
  regionCode,
  districtCode: '500',
  lcls1: lcls3.slice(0, 2),
  lcls3,
  lat: 35.15,
  lng: 129.1,
  visible: true,
  listRaw: {},
  ...o,
});

async function setup() {
  const t = await createTestApp();
  await t.db.insert(regions).values([{ regionCode: '26', regionName: '부산광역시', districtCode: '500', districtName: '수영구' }]);
  await t.db.insert(categories).values([
    { code: 'NA020900', name1: '자연관광', name2: '자연경관(하천‧해양)', name3: '해변. 해수욕장' },
    { code: 'FD050100', name1: '음식', name2: '카페/ 찻집', name3: '카페' },
    { code: 'SH020100', name1: '쇼핑', name2: '시장', name3: '상설시장' },
  ]);
  await t.db.insert(places).values([
    place('p_beach', '광안리해수욕장', '26', 'NA020900', { image: 'http://tong.visitkorea.or.kr/a.jpg', imageCopyright: 'Type3', introRaw: { usetime: '09:00~18:00', restdate: '연중무휴' } }),
    place('p_cafe', '바다카페', '26', 'FD050100', { introRaw: { opentimefood: '10:00~22:00', restdatefood: '매주 월요일' } }),
    place('p_market', '수영시장', '26', 'SH020100'),
    place('p_seoul', '서울 장소', '11', 'NA020900'),
    place('p_none', '아무도 안 고른 곳', '26', 'NA020900'),
  ]);
  const host = await call(t.app, 'POST', '/trips', { title: '부산', nickname: '민수' });
  const guest = await call(t.app, 'POST', `/invites/${host.body.trip.inviteCode}/join`, { nickname: '지은' });
  const tripId = host.body.trip.id as string;
  // AI가 고른 곳 알림: 회의 2번 · 같은 회의의 같은 AI가 같은 곳을 두 번 알려도 한 번으로 셈
  await t.db.insert(meetings).values([
    { id: 'mtg_c1', tripId, runNo: 1, status: 'done' },
    { id: 'mtg_c2', tripId, runNo: 2, status: 'done' },
  ]);
  const pick = (seq: number, meetingId: string, agentId: string, placeId: string) => ({ tripId, seq, meetingId, type: 'research.progress', data: { agentId, stage: 'picking', tool: null, focus: null, foundCount: 1, placeId, reason: '좋아요' } });
  await t.db.insert(meetingEvents).values([
    pick(1, 'mtg_c1', 'agt_a', 'plc_p_beach'),
    pick(2, 'mtg_c1', 'agt_a', 'plc_p_beach'),
    pick(3, 'mtg_c1', 'agt_b', 'plc_p_beach'),
    pick(4, 'mtg_c2', 'agt_a', 'plc_p_beach'),
    pick(5, 'mtg_c1', 'agt_a', 'plc_p_cafe'),
    pick(6, 'mtg_c1', 'agt_a', 'plc_p_seoul'),
    { tripId, seq: 7, meetingId: 'mtg_c1', type: 'research.progress', data: { agentId: 'agt_a', stage: 'searching', tool: 'tourSearch', focus: null, foundCount: 9 } },
  ]);
  return { ...t, host, guest, tripId };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('커뮤니티: AI가 많이 고른 장소 + 리뷰 (v2.4)', () => {
  it('목록: AI가 고른 곳·리뷰가 있는 곳을 공식 대분류로 묶어 AI가 많이 고른 순서로 (같은 회의의 같은 AI는 한 번), 다른 시·도와 아무도 안 고른 곳은 빼고, 사진은 https', async () => {
    // 2026-11-02(월) 12:00 한국 시각: 해변 09–18시 → 엶 · 카페는 월요일 휴무 → 닫음 · 시장은 시간 모름
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T03:00:00Z'));
    const { app, guest } = await setup();
    await call(app, 'PUT', '/community/places/plc_p_market/review', { rating: 4, text: '구경하기 좋아요' }, guest.body.token);
    const res = await call(app, 'GET', '/community/places?regionCode=26');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ regionCode: '26', regionName: '부산광역시', baseDate: '2026-11-02' });
    expect(res.body.sections.map((s: { group: string; aiPicks: number }) => [s.group, s.aiPicks])).toEqual([
      ['자연관광', 3],
      ['음식', 1],
      ['쇼핑', 0],
    ]);
    const [beach] = res.body.sections[0].places;
    expect(beach).toMatchObject({ placeId: 'plc_p_beach', name: '광안리해수욕장', category: '해변. 해수욕장', imageUrl: 'https://tong.visitkorea.or.kr/a.jpg', imageCredit: '한국관광공사', imageCopyright: 'Type3', aiPicks: 3, rating: { average: null, count: 0 }, openNow: true });
    expect(res.body.sections[1].places[0]).toMatchObject({ placeId: 'plc_p_cafe', openNow: false, imageUrl: null, imageCredit: null });
    expect(res.body.sections[2].places[0]).toMatchObject({ placeId: 'plc_p_market', aiPicks: 0, rating: { average: 4, count: 1 }, openNow: null });
    const all = res.body.sections.flatMap((s: { places: { placeId: string }[] }) => s.places.map((p) => p.placeId));
    expect(all).not.toContain('plc_p_seoul');
    expect(all).not.toContain('plc_p_none');
    // 지역 없이 부르면 전국 · 형식이 틀린 지역 코드는 400
    expect((await call(app, 'GET', '/community/places')).body.sections.flatMap((s: { places: { placeId: string }[] }) => s.places.map((p) => p.placeId))).toContain('plc_p_seoul');
    expect((await call(app, 'GET', '/community/places?regionCode=busan')).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('리뷰: 여행 참여자는 장소마다 1개(다시 쓰면 덮어씀)·지우기, 토큰을 보내면 내 리뷰에 mine, 나가도 리뷰는 그때 닉네임으로 남음', async () => {
    const { app, db, host, guest, tripId } = await setup();
    const put = (body: unknown, token?: string, placeId = 'plc_p_beach') => call(app, 'PUT', `/community/places/${placeId}/review`, body, token);
    expect((await put({ rating: 5 })).status).toBe(401);
    expect((await put({ rating: 6 }, host.body.token)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await put({ rating: 5, text: '가'.repeat(301) }, host.body.token)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await put({ rating: 5 }, host.body.token, 'plc_없는곳')).status).toBe(404);
    expect((await put({ rating: 5 }, host.body.token, 'trp_x')).status).toBe(404);
    const first = await put({ rating: 3, text: '  사람이 많아요  ' }, host.body.token);
    expect(first.status).toBe(200);
    expect(first.body.review).toMatchObject({ nickname: '민수', rating: 3, text: '사람이 많아요', mine: true });
    const again = await put({ rating: 5, text: '밤바다가 예뻐요' }, host.body.token);
    expect(again.body.review).toMatchObject({ reviewId: first.body.review.reviewId, rating: 5, text: '밤바다가 예뻐요' });
    await put({ rating: 4 }, guest.body.token);
    // 상세: 카드 + 소개글 + 리뷰(최근 것부터), 평균 4.5
    const view = (token?: string) => call(app, 'GET', '/community/places/plc_p_beach', undefined, token);
    let detail = await view(guest.body.token);
    expect(detail.body.place).toMatchObject({ placeId: 'plc_p_beach', aiPicks: 3, rating: { average: 4.5, count: 2 } });
    expect(detail.body.reviews.map((x: { nickname: string; mine: boolean }) => [x.nickname, x.mine])).toEqual([
      ['지은', true],
      ['민수', false],
    ]);
    expect((await view()).body.reviews.every((x: { mine: boolean }) => !x.mine)).toBe(true);
    // 지은이 나가도 리뷰는 남음 (그때 닉네임, 이제 누구의 것도 아님)
    expect((await call(app, 'DELETE', `/trips/${tripId}/members/me`, undefined, guest.body.token)).status).toBe(204);
    detail = await view();
    expect(detail.body.reviews.map((x: { nickname: string }) => x.nickname)).toEqual(['지은', '민수']);
    // 내 리뷰 지우기 (없어도 204)
    expect((await call(app, 'DELETE', '/community/places/plc_p_beach/review', undefined, host.body.token)).status).toBe(204);
    expect((await call(app, 'DELETE', '/community/places/plc_p_beach/review', undefined, host.body.token)).status).toBe(204);
    expect((await view()).body.reviews.map((x: { nickname: string }) => x.nickname)).toEqual(['지은']);
    expect(await db.select().from(placeReviews).where(eq(placeReviews.placeId, 'p_beach'))).toHaveLength(1);
    expect((await call(app, 'GET', '/community/places/plc_없는곳')).status).toBe(404);
  });
});
