import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { parseBody } from '../lib/validate.js';
import { CHOOSE, type PlanService } from '../meeting/choose.js';
import { ID_MAX } from './meetings.js';

/** 시연 모드에서 방장이 다른 구성원 몫을 대신 낼 때만 */
const memberId = z.string().max(ID_MAX).optional();
const choiceBody = z.object({ planId: z.string().min(1).max(ID_MAX), memberId });
const voteBody = z.object({ decision: z.enum(['approve', 'reject']), memberId });
/** 고치기: 고른 값만 (일정 항목 id·장소 id·날짜 번호, 0부터). 글은 받지 않음 */
const day = z.number().int().min(0).max(30);
const editBody = z.object({
  edits: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('remove'), itemId: z.string().min(1).max(ID_MAX) }),
        z.object({ type: z.literal('add'), placeId: z.string().min(1).max(ID_MAX), day }),
        z.object({ type: z.literal('move'), itemId: z.string().min(1).max(ID_MAX), day }),
        z.object({ type: z.literal('reorder'), day, itemIds: z.array(z.string().min(1).max(ID_MAX)).min(1).max(30) }),
        z.object({ type: z.literal('meal'), itemId: z.string().min(1).max(ID_MAX), placeId: z.string().min(1).max(ID_MAX).nullable() }),
      ]),
    )
    .min(1)
    .max(CHOOSE.editsPerRequest),
});

/**
 * 13–15단계 API (명세서 4.5, v2.3): 회의가 끝난 뒤 사람이 A·B 중 고르고(14) 고친 안을 모두 찬성해 확정함(15)
 * GET /plan 지금 상태 · POST /plan/choice 고르기 · /plan/choice/close 방장이 정하기 · GET /plan/options 고칠 때 보기 · POST /plan/edits 고치기 · /plan/confirm 확정 투표 시작(방장) · /plan/votes 확정 투표
 */
export function planRoutes({ db, plans }: { db: Db; plans: PlanService }) {
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);
  r.get('/trips/:tripId/plan', auth, async (c) => c.json(await plans.view(c.req.param('tripId'), c.get('member'))));
  r.post('/trips/:tripId/plan/choice', auth, async (c) => c.json(await plans.choose(c.req.param('tripId'), c.get('member'), await parseBody(c, choiceBody))));
  r.post('/trips/:tripId/plan/choice/close', auth, async (c) => c.json(await plans.closeChoice(c.req.param('tripId'), c.get('member'))));
  r.get('/trips/:tripId/plan/options', auth, async (c) => c.json(await plans.options(c.req.param('tripId'), c.get('member'))));
  r.post('/trips/:tripId/plan/edits', auth, async (c) => c.json(await plans.edit(c.req.param('tripId'), c.get('member'), (await parseBody(c, editBody)).edits)));
  r.post('/trips/:tripId/plan/confirm', auth, async (c) => c.json(await plans.requestConfirm(c.req.param('tripId'), c.get('member'))));
  r.post('/trips/:tripId/plan/votes', auth, async (c) => c.json(await plans.vote(c.req.param('tripId'), c.get('member'), await parseBody(c, voteBody))));
  return r;
}
