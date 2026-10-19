import { defineConfig } from 'drizzle-kit';

// 테이블 정의(src/db/schema.ts)를 바꾼 뒤 npm run db:generate로 마이그레이션 SQL을 만듦
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
