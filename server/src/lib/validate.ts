import type { Context } from 'hono';
import { z } from 'zod';
import { ApiError } from './errors.js';

z.config(z.locales.ko());

/** JSON 본문을 검사하고, 형식이 틀리면 VALIDATION_ERROR(400)로 응답함 */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw: unknown = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || '요청 본문';
    throw new ApiError('VALIDATION_ERROR', `${field}: ${issue?.message ?? '형식이 올바르지 않음'}`);
  }
  return result.data;
}
