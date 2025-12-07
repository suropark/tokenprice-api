import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config();

// .env의 DATABASE_URL에서 ?schema=public 같은 쿼리 파라미터 제거
// postgres 패키지는 이 파라미터를 인식하지 못함
const databaseUrl = process.env.DATABASE_URL!; // 쿼리 파라미터 제거

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
