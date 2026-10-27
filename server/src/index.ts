import { serve } from '@hono/node-server';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { createApp } from './app.js';
import { config } from './config.js';
import { checkpointPool, connectDb } from './db/client.js';
import { createLangChainLlm, type LlmClient, type ModelSpec, parseModelSpec, withFallbacks } from './llm/client.js';
import { liveSocketServer } from './meeting/live.js';
import { failInterruptedMeetings, pruneMeetingCheckpoints } from './meeting/runs.js';
import { createTourClient } from './tour/client.js';
import { tryConsumeTourCall } from './tour/usage.js';
import { kakaoQuota, kakaoRouter, pruneRouteCache } from './meeting/route.js';

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

// 6단계 길찾기 호출기: 카카오 기능별 하루 상한을 tour_api_usage 표로 셈 (무료 한도 안, 결제 수단 연결 안 함). 키가 없으면 저장된 길찾기만 씀
const routeClient =
  db && config.kakaoRestKey
    ? kakaoRouter({
        restKey: config.kakaoRestKey,
        mapBase: config.kakaoMapBase,
        naviBase: config.kakaoNaviBase,
        timeoutMs: config.kakaoTimeoutMs,
        beforeCall: kakaoQuota(db, { transit: config.kakaoTransitDailyLimit, walk: config.kakaoWalkDailyLimit, car: config.kakaoCarDailyLimit }),
      })
    : null;
console.log(`카카오 길찾기: ${routeClient ? '켬' : '없음 (저장된 길찾기만 씀)'}`);

// 회의 단계 저장: LangGraph 체크포인트를 별도 스키마(langgraph)에 둠 (우리 표와 섞이지 않게)
// 하루 한 번 정리: 끝난 지 오래된 회의 기록 · 보관 날 수가 지난 길찾기 (서버 시작을 늦추지 않게 기다리지 않음)
const CHECKPOINT_SCHEMA = 'langgraph';
const DAY_MS = 86400000;
let checkpointer: PostgresSaver | undefined;
if (db && config.databaseUrl) {
  checkpointer = new PostgresSaver(checkpointPool(config.databaseUrl, config.checkpointPoolMax), undefined, { schema: CHECKPOINT_SCHEMA });
  await checkpointer.setup();
  const saver = checkpointer;
  const prune = async () => {
    await pruneMeetingCheckpoints(db, saver, config.meetingKeepDays, CHECKPOINT_SCHEMA).catch((err) => console.warn('회의 기록 정리 실패:', err instanceof Error ? err.message : err));
    await pruneRouteCache(db).catch((err) => console.warn('길찾기 정리 실패:', err instanceof Error ? err.message : err));
  };
  void prune();
  setInterval(prune, DAY_MS).unref();
  // 서버가 꺼질 때 실행 중이던 회의는 이어서 돌 수 없어 실패로 바꿈 (사람 확인을 기다리던 회의는 체크포인트로 이어서 진행)
  const failed = await failInterruptedMeetings(db);
  if (failed) console.warn(`서버가 꺼져 끊긴 회의 ${failed}개를 실패로 바꿈`);
}

const app = createApp({
  db,
  crowdClient,
  routeClient,
  checkpointer,
  meetingLlm,
  devUi: config.devUi,
  devUiTunnel: config.devUiTunnel,
  llm,
  llmReplay: config.llmReplay,
  llmDailyLimit: config.llmDailyLimit,
  llmCardsPerMember: config.llmCardsPerMember,
  llmPerIpDaily: config.llmPerIpDaily,
  ipHashSecret: config.ipHashSecret,
  rateLimitPerMinute: config.rateLimitPerMinute,
  accessKeys: config.accessKeys,
  accessReplay: config.accessReplay,
});

// 실시간 연결(WebSocket): 같은 포트에서 /api/v1/trips/{tripId}/ws로 받음 (Hono Node 서버의 내장 기능 + ws)
const server = serve({ fetch: app.fetch, port: config.port, websocket: { server: liveSocketServer() } }, (info) => {
  console.log(`J-ourney 서버 실행 중: http://localhost:${info.port}/api/v1/health`);
  if (config.llmReplay === 'only') console.log('LLM_REPLAY 켜짐: LLM을 부르지 않고 녹화된 답·지난 결과(지난 회의의 AI 고르기, 같은 응답의 AI 카드)만 씀');
  if (config.llmReplay === 'fill') console.log('LLM_REPLAY=fill: 녹화된 답·지난 결과는 다시 쓰고, 없는 요청만 LLM을 불러 녹화함');
  // 키 이름·횟수만 적음 (키·해시는 로그에 넣지 않음)
  if (config.accessKeys.length) console.log(`접근 키 ${config.accessKeys.map((k) => `${k.label}(${k.quota}회)`).join(', ')}: 터널 요청은 키를 낸 경우만 회의·AI 카드 (키 LLM: ${config.accessReplay})`);
  if (config.devUi) console.log(`백엔드 시험 화면: http://localhost:${info.port}/dev/ · 회의 엔진: http://localhost:${info.port}/dev/meeting`);
  if (config.devUi && config.devUiTunnel && !config.accessKeys.length) console.warn('DEV_UI_TUNNEL=true인데 ACCESS_KEYS가 없어 터널 요청의 시험 경로는 열지 않음');
  if (config.llmReplay !== 'only' && !config.accessKeys.length) console.warn(`LLM_REPLAY=${config.llmReplay}이고 ACCESS_KEYS가 없음: 터널로 들어온 회의도 실제 LLM을 부를 수 있음`);
});
// WebSocket 인증(DB 조회)을 기다리는 동안에는 소켓 오류를 받는 곳이 없어(Node가 업그레이드 때 떼어 냄) 연결이 끊기면 서버가 꺼질 수 있음 → 오류는 버림 (연결은 Node·ws가 닫음)
server.on('connection', (socket) => socket.on('error', () => {}));
