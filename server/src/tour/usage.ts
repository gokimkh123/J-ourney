import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tourApiUsage } from '../db/schema.js';
import { todayKst } from '../lib/time.js';

/** 오늘 기능별 TourAPI 호출 수 */
export async function tourCallsByOperation(db: Db, day = todayKst()): Promise<Record<string, number>> {
  const rows = await db.select({ operation: tourApiUsage.operation, count: tourApiUsage.count }).from(tourApiUsage).where(eq(tourApiUsage.day, day));
  return Object.fromEntries(rows.map((r) => [r.operation, r.count]));
}

/** 오늘 TourAPI 호출 수 (모든 기능 합계, 보고용) */
export async function tourCallsToday(db: Db, day = todayKst()): Promise<number> {
  return Object.values(await tourCallsByOperation(db, day)).reduce((a, b) => a + b, 0);
}

/**
 * 이 기능의 오늘 호출 수가 상한보다 적으면 1 올리고 true (공공데이터포털 한도는 기능마다 따로임)
 * 한 번의 INSERT … ON CONFLICT라 여러 곳에서 동시에 불러도 상한을 넘지 않음
 */
export async function tryConsumeTourCall(db: Db, operation: string, perOperationLimit: number, day = todayKst()): Promise<boolean> {
  if (perOperationLimit <= 0) return false;
  const rows = await db
    .insert(tourApiUsage)
    .values({ day, operation, count: 1 })
    .onConflictDoUpdate({
      target: [tourApiUsage.day, tourApiUsage.operation],
      set: { count: sql`${tourApiUsage.count} + 1` },
      setWhere: sql`${tourApiUsage.count} < ${perOperationLimit}`,
    })
    .returning({ count: tourApiUsage.count });
  return rows.length > 0;
}
