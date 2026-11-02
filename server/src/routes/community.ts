import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { categories, meetingEvents, members, placeReviews, places, regions } from '../db/schema.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { hashToken, newId } from '../lib/ids.js';
import { nowKst, todayKst } from '../lib/time.js';
import { parseBody } from '../lib/validate.js';
import { closedOn, hoursLabel, hoursOn } from '../meeting/hours.js';
import { HOURS_KEYS, REST_KEYS, intro } from '../meeting/retrieve.js';
import { placeIdOf } from '../meeting/runs.js';
import { maskPersonal } from '../persona/write.js';

/**
 * 커뮤니티 (v2.4, 11/2 사용자 '트립어드바이저처럼 AI가 많이 고른 장소 + 사람들 리뷰')
 * AI가 고른 수 = 회의마다 3단계에서 AI(에이전트)가 그곳을 고른 수 (같은 회의·같은 AI는 한 번). 리뷰 글은 화면 표시만 하고 서버 코드는 읽지 않음 (연락처·식별번호만 가림)
 */
export const COMMUNITY = {
  /** 묶음(관광공사 공식 대분류)마다 보여 줄 장소 수 */
  perSection: 10,
  /** 장소 하나에 보여 줄 리뷰 수 (최근 것부터) */
  reviewsMax: 50,
  /** 리뷰 글 길이 상한 */
  textMax: 300,
  /** 공식 분류가 없는 장소의 묶음 이름 (코드가 붙이는 표시) */
  otherGroup: '기타',
  /** 사진 출처 표시 (관광공사 사진은 공공누리: imageCopyright Type1 출처 표시 · Type3 출처 표시·변경 금지) */
  imageCredit: '한국관광공사',
} as const;

const listQuery = z.object({
  regionCode: z.string().regex(/^\d{2}$/, '시·도 코드 2자리').optional(),
  districtCode: z.string().regex(/^\d{3,5}$/, '시·군·구 코드').optional(),
});
const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().max(COMMUNITY.textMax).optional(),
});

/** plc_{관광공사 콘텐츠 id} → 콘텐츠 id (형식이 다르면 404) */
const contentIdOf = (placeId: string) => {
  const m = /^plc_([0-9A-Za-z_-]{1,40})$/.exec(placeId);
  if (!m) throw new ApiError('NOT_FOUND', '장소를 찾을 수 없음');
  return m[1];
};

/** 관광공사 사진 주소는 http·https가 섞여 있어 https로 줌 (앱이 암호화 안 된 주소를 막는 경우) */
const secureUrl = (url: string | null) => (url ? url.replace(/^http:\/\//, 'https://') : null);

/** 지금(한국 시각) 여는지: 오늘 쉬면 false, 영업시간을 읽었으면 그 안인지, 모르면 null */
function openNow(introRaw: Record<string, string> | null, now: Date) {
  const ymd = todayKst(now);
  const month = Number(ymd.slice(5, 7));
  if (closedOn(intro(introRaw, ...REST_KEYS), ymd) === 'closed') return false;
  const h = hoursOn(intro(introRaw, ...HOURS_KEYS), month);
  if (!h) return null;
  const t = nowKst(now).slice(11, 16);
  const at = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return h.close > h.open ? at >= h.open && at < h.close : at >= h.open || at < h.close;
}

export function communityRoutes(db: Db) {
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);

  // AI가 고른 수: 회의 이벤트(3단계 고른 곳 알림)에서 셈
  const picks = db.$with('picks').as(
    db
      .select({
        pid: sql<string>`${meetingEvents.data}->>'placeId'`.as('pid'),
        n: sql<number>`count(distinct (${meetingEvents.meetingId}, ${meetingEvents.data}->>'agentId'))::int`.as('n'),
      })
      .from(meetingEvents)
      .where(and(eq(meetingEvents.type, 'research.progress'), sql`${meetingEvents.data}->>'stage' = 'picking'`, sql`${meetingEvents.data}->>'placeId' is not null`))
      .groupBy(sql`1`),
  );
  const rated = db.$with('rated').as(
    db
      .select({ cid: placeReviews.placeId, avg: sql<number>`avg(${placeReviews.rating})::float`.as('avg'), cnt: sql<number>`count(*)::int`.as('cnt') })
      .from(placeReviews)
      .groupBy(placeReviews.placeId),
  );
  const rows = (where: ReturnType<typeof and>) =>
    db
      .with(picks, rated)
      .select({
        cid: places.contentId,
        name: places.title,
        addr: places.addr,
        lat: places.lat,
        lng: places.lng,
        image: places.image,
        imageCopyright: places.imageCopyright,
        group: categories.name1,
        category: categories.name3,
        picks: sql<number>`coalesce(${picks.n}, 0)`,
        avg: rated.avg,
        cnt: sql<number>`coalesce(${rated.cnt}, 0)`,
      })
      .from(places)
      .leftJoin(picks, sql`${picks.pid} = 'plc_' || ${places.contentId}`)
      .leftJoin(rated, eq(rated.cid, places.contentId))
      .leftJoin(categories, eq(categories.code, places.lcls3))
      .where(where)
      .orderBy(sql`coalesce(${picks.n}, 0) desc`, sql`coalesce(${rated.cnt}, 0) desc`, places.contentId);
  type Row = Awaited<ReturnType<typeof rows>>[number];
  const cardOf = (p: Row, introRaw: Record<string, string> | null, now: Date) => {
    const month = Number(todayKst(now).slice(5, 7));
    return {
      placeId: placeIdOf(p.cid),
      name: p.name,
      group: p.group ?? COMMUNITY.otherGroup,
      category: p.category ?? null,
      imageUrl: secureUrl(p.image || null),
      imageCredit: p.image ? COMMUNITY.imageCredit : null,
      imageCopyright: p.image ? (p.imageCopyright ?? null) : null,
      address: p.addr ?? null,
      lat: p.lat,
      lng: p.lng,
      aiPicks: p.picks,
      rating: { average: p.cnt ? Math.round(p.avg * 10) / 10 : null, count: p.cnt },
      openNow: openNow(introRaw, now),
      hours: hoursLabel(intro(introRaw, ...HOURS_KEYS), month),
    };
  };
  /** 토큰이 있으면 그 구성원 id (리뷰의 '내 것' 표시용, 없거나 틀리면 null) */
  const viewerOf = async (header: string | undefined) => {
    const token = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
    if (!token) return null;
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.tokenHash, hashToken(token))).limit(1);
    return m?.id ?? null;
  };
  const reviewView = (x: typeof placeReviews.$inferSelect, viewer: string | null) => ({
    reviewId: x.id,
    nickname: x.nickname,
    rating: x.rating,
    text: x.text,
    mine: viewer !== null && x.memberId === viewer,
    createdAt: nowKst(x.createdAt),
    updatedAt: nowKst(x.updatedAt),
  });

  // 장소 목록: AI가 고른 곳과 리뷰가 있는 곳을 공식 대분류로 묶어 AI가 많이 고른 순서로 (인증 불필요)
  r.get('/community/places', async (c) => {
    const q = listQuery.safeParse({ regionCode: c.req.query('regionCode'), districtCode: c.req.query('districtCode') });
    if (!q.success) throw new ApiError('VALIDATION_ERROR', `${q.error.issues[0]?.path.join('.')}: ${q.error.issues[0]?.message}`);
    const { regionCode, districtCode } = q.data;
    const found = await rows(
      and(
        sql`(${picks.n} is not null or ${rated.cnt} is not null)`,
        eq(places.visible, true),
        regionCode ? eq(places.regionCode, regionCode) : undefined,
        districtCode ? eq(places.districtCode, districtCode) : undefined,
      ),
    );
    const groups = new Map<string, Row[]>();
    for (const p of found) {
      const key = p.group ?? COMMUNITY.otherGroup;
      const list = groups.get(key) ?? [];
      if (list.length < COMMUNITY.perSection) list.push(p);
      groups.set(key, list);
    }
    const shown = [...groups.values()].flat();
    const intros = shown.length ? await db.select({ cid: places.contentId, introRaw: places.introRaw }).from(places).where(inArray(places.contentId, shown.map((p) => p.cid))) : [];
    const introOf = new Map(intros.map((x) => [x.cid, x.introRaw]));
    const now = new Date();
    const sections = [...groups.entries()]
      .map(([group, list]) => ({ group, aiPicks: list.reduce((a, p) => a + p.picks, 0), places: list.map((p) => cardOf(p, introOf.get(p.cid) ?? null, now)) }))
      .sort((a, b) => b.aiPicks - a.aiPicks || a.group.localeCompare(b.group));
    const [region] = regionCode ? await db.select({ name: regions.regionName }).from(regions).where(eq(regions.regionCode, regionCode)).limit(1) : [];
    return c.json({ regionCode: regionCode ?? null, regionName: region?.name ?? null, districtCode: districtCode ?? null, sections, baseDate: todayKst(now) });
  });

  // 장소 하나: 카드 + 소개글(관광공사) + 리뷰 (인증 불필요, 토큰을 보내면 내 리뷰에 mine)
  r.get('/community/places/:placeId', async (c) => {
    const cid = contentIdOf(c.req.param('placeId'));
    const [p] = await rows(eq(places.contentId, cid));
    if (!p) throw new ApiError('NOT_FOUND', '장소를 찾을 수 없음');
    const [extra] = await db.select({ introRaw: places.introRaw, overview: places.overview }).from(places).where(eq(places.contentId, cid));
    const viewer = await viewerOf(c.req.header('Authorization'));
    const list = await db.select().from(placeReviews).where(eq(placeReviews.placeId, cid)).orderBy(desc(placeReviews.updatedAt), desc(placeReviews.id)).limit(COMMUNITY.reviewsMax);
    return c.json({ place: { ...cardOf(p, extra?.introRaw ?? null, new Date()), overview: extra?.overview ?? null }, reviews: list.map((x) => reviewView(x, viewer)) });
  });

  // 리뷰 쓰기·고치기 (여행에 참여한 사람 누구나, 장소마다 1개)
  r.put('/community/places/:placeId/review', auth, async (c) => {
    const me = c.get('member');
    const cid = contentIdOf(c.req.param('placeId'));
    const body = await parseBody(c, reviewBody);
    const [place] = await db.select({ cid: places.contentId }).from(places).where(eq(places.contentId, cid)).limit(1);
    if (!place) throw new ApiError('NOT_FOUND', '장소를 찾을 수 없음');
    // 리뷰 글은 뜻을 읽지 않고, 다른 사람에게 보이므로 연락처·식별번호만 가려 저장함 (성향 15번 글과 같은 규칙, 11/2 사용자 결정)
    const text = maskPersonal((body.text ?? '').trim());
    const [row] = await db
      .insert(placeReviews)
      .values({ id: newId('rvw'), placeId: cid, memberId: me.id, tripId: me.tripId, nickname: me.nickname, rating: body.rating, text })
      .onConflictDoUpdate({ target: [placeReviews.placeId, placeReviews.memberId], set: { rating: body.rating, text, nickname: me.nickname, updatedAt: new Date() } })
      .returning();
    return c.json({ review: reviewView(row, me.id) });
  });

  // 내 리뷰 지우기 (없어도 204)
  r.delete('/community/places/:placeId/review', auth, async (c) => {
    const me = c.get('member');
    const cid = contentIdOf(c.req.param('placeId'));
    await db.delete(placeReviews).where(and(eq(placeReviews.placeId, cid), eq(placeReviews.memberId, me.id)));
    return c.body(null, 204);
  });

  return r;
}
