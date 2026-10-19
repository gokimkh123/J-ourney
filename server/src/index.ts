import { serve } from '@hono/node-server';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db/client.js';
import { createLangChainLlm, type LlmClient, type ModelSpec, parseModelSpec, withFallbacks } from './llm/client.js';
import { pruneMeetingCheckpoints } from './meeting/runs.js';
import { createTourClient } from './tour/client.js';
import { tryConsumeTourCall } from './tour/usage.js';

if (!config.databaseUrl) console.warn('DATABASE_URL이 없어 DB 없이 실행함 (/health만 동작)');
const db = config.databaseUrl ? await connectDb(config.databaseUrl) : null;

// 기본 모델(LLM_PROVIDER·LLM_MODEL) 다음에 예비 모델(LLM_FALLBACKS)을 순서대로 엶. 열지 못한 모델은 건너뜀
const specs: ModelSpec[] = config.llmModel ? [{ provider: config.llmProvider, model: config.llmModel }] : [];
for (const spec of config.llmFallbacks) {
  const parsed = parseModelSpec(spec);
  if (parsed) specs.push(parsed);
  else console.warn(`LLM_FALLBACKS 형식이 틀려 건너뜀 (공급자:모델): ${spec}`);
}
// 성향 카드(화면이 기다림)와 회의(실시간 전송)는 응답 대기 시간만 다르게 엶
async function openLlm(timeoutMs: number): Promise<LlmClient | null> {
  const clients: LlmClient[] = [];
  for (const spec of specs) {
    try {
      clients.push(await createLangChainLlm({ ...spec, timeoutMs, callTokenLimit: config.llmCallTokenLimit, maxOutputTokens: config.llmMaxOutputTokens }));
    } catch (err) {
      console.warn(`LLM ${spec.provider}:${spec.model}을 열지 못해 건너뜀:`, err instanceof Error ? err.message : err);
    }
  }
  return clients.length ? withFallbacks(clients) : null;
}
const llm = await openLlm(config.llmTimeoutMs);
const meetingLlm = await openLlm(config.meetingLlmTimeoutMs);
console.log(`LLM: ${llm ? llm.name : '없음 (규칙 카드만 만듦)'}`);
if (!process.env.IP_HASH_SECRET) console.warn('IP_HASH_SECRET이 없어 임시 값을 씀 (서버를 다시 켜면 IP별 AI 횟수가 초기화됨)');

// 집중률 예측 호출기: 기능별 하루 상한을 tour_api_usage 표로 셈 (회의 후보 찾기에서 구·군마다 하루 1회)
const crowdClient =
  db && config.dataGoKrKey
    ? createTourClient({
        baseUrl: config.tourCrowdBase,
        serviceKey: config.dataGoKrKey,
        mobileApp: config.tourMobileApp,
        beforeAttempt: (operation) => tryConsumeTourCall(db, `TatsCnctrRateService/${operation}`, config.tourDailyLimit),
      })
    : null;

// 회의 단계 저장: LangGraph 체크포인트를 별도 스키마(langgraph)에 둠 (우리 표와 섞이지 않게). 끝난 지 오래된 회의 기록은 하루 한 번 지움
const CHECKPOINT_SCHEMA = 'langgraph';
const DAY_MS = 86400000;
let checkpointer: PostgresSaver | undefined;
if (db && config.databaseUrl) {
  checkpointer = new PostgresSaver(new pg.Pool({ connectionString: config.databaseUrl, max: config.checkpointPoolMax }), undefined, { schema: CHECKPOINT_SCHEMA });
  await checkpointer.setup();
  const prune = () =>
    pruneMeetingCheckpoints(db, checkpointer!, config.meetingKeepDays).catch((err) => console.warn('회의 기록 정리 실패:', err instanceof Error ? err.message : err));
  await prune();
  setInterval(prune, DAY_MS).unref();
}

const app = createApp({
  db,
  crowdClient,
  checkpointer,
  meetingLlm,
  devUi: config.devUi,
  devUiTunnel: config.devUiTunnel,
  llm,
  llmDailyLimit: config.llmDailyLimit,
  llmCardsPerMember: config.llmCardsPerMember,
  llmPerIpDaily: config.llmPerIpDaily,
  ipHashSecret: config.ipHashSecret,
  rateLimitPerMinute: config.rateLimitPerMinute,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`J-ourney 서버 실행 중: http://localhost:${info.port}/api/v1/health`);
  if (config.devUi) console.log(`백엔드 시험 화면: http://localhost:${info.port}/dev/ · 회의 엔진: http://localhost:${info.port}/dev/meeting`);
});
