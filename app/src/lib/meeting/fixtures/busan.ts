import type { AgentInfo, MeetingEvent } from '../types.ts';

export const busanAgents: AgentInfo[] = [
  {
    agentId: 'agt_01',
    memberId: 'mem_01',
    nickname: '민수',
    title: '민수의 일정 총괄 AI',
    chips: [
      { label: '계획형', emoji: '📋' },
      { label: '부지런형', emoji: '🏃' },
    ],
    color: '#F97316',
  },
  {
    agentId: 'agt_02',
    memberId: 'mem_02',
    nickname: '지은',
    title: '지은의 감성 탐험 AI',
    chips: [
      { label: '활기형', emoji: '🎉' },
      { label: '탐험형', emoji: '🧭' },
    ],
    color: '#EC4899',
  },
  {
    agentId: 'agt_03',
    memberId: 'mem_03',
    nickname: '현우',
    title: '현우의 동선 관리 AI',
    chips: [
      { label: '계획형', emoji: '📋' },
      { label: '절약형', emoji: '🐷' },
    ],
    color: '#0EA5E9',
  },
  {
    agentId: 'agt_04',
    memberId: 'mem_04',
    nickname: '서연',
    title: '서연의 여유 휴식 AI',
    chips: [
      { label: '느긋형', emoji: '🐢' },
      { label: '한적형', emoji: '🌿' },
      { label: '늦잠형', emoji: '😴' },
    ],
    color: '#10B981',
  },
];

type Data<T extends MeetingEvent['type']> = Extract<MeetingEvent, { type: T }>['data'];
type ReactionKind = Data<'board.updated'>['candidates'][number]['reactions'][number]['kind'];
type VoteRow = [agentId: string, vote: 'yes' | 'no', score: number];

const TRIP_ID = 'trp_8f3k2';
const START_MS = Date.parse('2026-10-24T14:00:00+09:00');
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const STEP_MS = 3000;

const events: MeetingEvent[] = [];

// seq와 at(+09:00)을 자동으로 붙여 events에 쌓는다.
function ev<T extends MeetingEvent['type']>(type: T, data: Data<T>): void {
  const seq = events.length + 1;
  const at = new Date(START_MS + seq * STEP_MS + KST_OFFSET_MS).toISOString().replace('Z', '+09:00');
  events.push({ type, tripId: TRIP_ID, seq, at, data } as MeetingEvent);
}

// 부산 전역 1박 2일 예시. 좌표는 대략적인 값이다(통계청 구역 경계로 구·군 안에 드는지만 확인함).
const places = [
  { placeId: 'plc_01', name: '국제시장·깡통시장', lat: 35.1007, lng: 129.0285, proposedBy: ['agt_01', 'agt_03'] },
  { placeId: 'plc_02', name: '자갈치시장', lat: 35.0967, lng: 129.0305, proposedBy: ['agt_01'] },
  { placeId: 'plc_03', name: '광안리 해변과 야경', lat: 35.1532, lng: 129.1186, proposedBy: ['agt_02', 'agt_03'] },
  { placeId: 'plc_04', name: '흰여울문화마을', lat: 35.0786, lng: 129.0446, proposedBy: ['agt_04'] },
  { placeId: 'plc_05', name: '청사포 다릿돌전망대', lat: 35.1595, lng: 129.192, proposedBy: ['agt_04', 'agt_02'] },
  { placeId: 'plc_06', name: '해운대 해수욕장', lat: 35.1587, lng: 129.1604, proposedBy: ['agt_02'] },
  { placeId: 'plc_07', name: '다대포 꿈의낙조분수', lat: 35.0472, lng: 128.9658, proposedBy: ['agt_02'] },
  { placeId: 'plc_08', name: '감천문화마을', lat: 35.0975, lng: 129.0106, proposedBy: ['agt_02'] },
  { placeId: 'plc_09', name: '대변항', lat: 35.2263, lng: 129.2272, proposedBy: ['agt_03'] },
  { placeId: 'plc_10', name: '해동용궁사', lat: 35.1883, lng: 129.2233, proposedBy: ['agt_04', 'agt_01'] },
  // 일정에는 못 들어가는 후보 둘: 감천과 시간이 겹치고(케이블카), 북쪽으로 너무 멀다(범어사)
  { placeId: 'plc_11', name: '송도해상케이블카', lat: 35.0763, lng: 129.0176, proposedBy: ['agt_02'] },
  { placeId: 'plc_12', name: '범어사', lat: 35.2823, lng: 129.0679, proposedBy: ['agt_04'] },
];

// 조사 중에 후보가 하나씩 보드에 올라오는 순서(지도에 핀이 하나씩 꽂힌다). 동서남북이 번갈아 나오게 섞었다.
const REVEAL_ORDER = [
  'plc_06', 'plc_01', 'plc_09', 'plc_04', 'plc_05', 'plc_03',
  'plc_07', 'plc_10', 'plc_02', 'plc_12', 'plc_08', 'plc_11',
];

function place(placeId: string) {
  const found = places.find((p) => p.placeId === placeId);
  if (found === undefined) throw new Error(`unknown place ${placeId}`);
  return found;
}

function say(agentId: string, round: number, text: string): void {
  ev('agent.message', { agentId, round, text });
}

function check(agentId: string, name: string, openHours: string | null, popularity: number, crowd: number): void {
  const q = encodeURIComponent(name);
  ev('place.checked', {
    agentId,
    place: {
      name,
      openHours,
      popularity,
      crowd,
      links: { kakaoMap: `https://map.kakao.com/link/search/${q}`, naverMap: `https://map.naver.com/p/search/${q}` },
    },
  });
}

type ReactionRow = [placeId: string, agentId: string, kind: ReactionKind, reason: string];

function board(reactions: ReactionRow[], agenda: { placeId: string; text: string }[]): void {
  ev('board.updated', {
    candidates: places.map((p) => ({
      ...p,
      reactions: reactions
        .filter((r) => r[0] === p.placeId)
        .map(([, agentId, kind, reason]) => ({ agentId, kind, reason })),
    })),
    agenda,
  });
}

function propose(planId: string, version: number, day1: string[], day2: string[]): void {
  const stops = (ids: string[]) =>
    ids.map((id) => {
      const p = place(id);
      return { itemId: `itm_${id.slice(4)}`, name: p.name, lat: p.lat, lng: p.lng };
    });
  ev('plan.proposed', {
    planId,
    version,
    route: [
      { day: 1, stops: stops(day1) },
      { day: 2, stops: stops(day2) },
    ],
  });
}

function vote(planId: string, rows: VoteRow[]): void {
  for (const [agentId, v, score] of rows) ev('vote.cast', { planId, agentId, vote: v, score });
}

function confirm(planId: string, decisions: ('approve' | 'revise' | 'reject')[]): void {
  busanAgents.forEach((agent, i) => {
    ev('confirm.cast', { planId, memberId: agent.memberId, decision: decisions[i] ?? 'approve' });
  });
}

ev('meeting.started', { meetingId: 'mtg_01', kind: 'meeting', maxRounds: 3, agents: busanAgents });

// AI별 조사: planning → searching(각자 다른 방향으로 걸어감) → picking → 후보 하나씩 올림 → done
const research: [agentId: string, tool: 'tourSearch' | 'tourRank' | 'distance' | 'crowd', placeId: string, found: number][] = [
  ['agt_01', 'tourSearch', 'plc_01', 12], // 도심(중구)
  ['agt_02', 'tourRank', 'plc_06', 9], // 동쪽(해운대)
  ['agt_03', 'distance', 'plc_03', 14], // 동남쪽(광안리)
  ['agt_04', 'crowd', 'plc_04', 7], // 남쪽(영도)
];
for (const stage of ['planning', 'searching', 'picking'] as const) {
  for (const [agentId, tool, placeId, found] of research) {
    const p = place(placeId);
    if (stage === 'planning') ev('research.progress', { agentId, stage, foundCount: 0 });
    else if (stage === 'searching') {
      ev('research.progress', { agentId, stage, tool, focus: { lat: p.lat, lng: p.lng, label: p.name }, foundCount: found });
    } else ev('research.progress', { agentId, stage, foundCount: found });
  }
  // 조사 중에도 AI가 한마디씩 한다(round 0 = 회의 전). 실서버에서는 서버가 같은 형식으로 보낸다.
  if (stage === 'searching') {
    say('agt_01', 0, '도심 시장부터 훑어볼게요. 먹거리 후보를 찾아볼게요.');
    say('agt_02', 0, '저는 동쪽 바다 쪽부터 가 볼게요. 야경 명소도 찾아볼게요!');
    say('agt_03', 0, '이동 거리가 짧은 곳 위주로 볼게요. 광안리 근처부터요.');
    say('agt_04', 0, '붐비지 않는 조용한 곳을 먼저 찾아볼게요.');
  }
}
// 후보가 하나씩 올라온다: 올라온 것까지만 담은 보드를 매번 보낸다(반응은 아직 없음).
for (let n = 1; n <= REVEAL_ORDER.length; n += 1) {
  const shown = new Set(REVEAL_ORDER.slice(0, n));
  ev('board.updated', {
    candidates: places.filter((p) => shown.has(p.placeId)).map((p) => ({ ...p, reactions: [] })),
    agenda: [],
  });
  if (n === 7) say('agt_02', 0, '다대포 일몰도 후보에 올렸어요!');
  if (n === 10) say('agt_04', 0, '범어사 같은 조용한 절도 올려 둘게요.');
}
for (const [agentId, , , found] of research) ev('research.progress', { agentId, stage: 'done', foundCount: found });

// 반응 문구는 실제로는 서버(AI)가 만든다. 여기 글은 흉내 낸 예시다.
const base: ReactionRow[] = [
  ['plc_01', 'agt_03', 'like', '먹거리가 많은데 가격이 합리적이에요'],
  ['plc_02', 'agt_03', 'warn', '주말엔 사람이 많아 이동이 느려요'],
  ['plc_03', 'agt_02', 'like', '야경을 보며 하루를 마무리하기 좋아요'],
  ['plc_04', 'agt_04', 'like', '붐비지 않고 바다를 보며 걷기 좋아요'],
  ['plc_07', 'agt_01', 'block', '일몰 시간에 맞추면 이동이 너무 길어요'],
];
const agenda = [{ placeId: 'plc_07', text: '다대포 일몰을 넣을지 정하기' }];
board(base, agenda);

// 1라운드
ev('round.started', { round: 1, maxRounds: 3 });
say('agt_01', 1, '첫날은 국제시장에서 시작해서 자갈치시장 점심, 감천문화마을까지 묶어 볼게요.');
check('agt_01', '국제시장·깡통시장', '09:00-20:00', 85, 70);
say('agt_02', 1, '일몰은 다대포가 예뻐요! 저녁엔 광안리에서 야경도 보고 싶어요.');
say('agt_03', 1, '다대포는 감천에서도 한참 가야 해요. 동선이 길어질 것 같아요.');
check('agt_03', '자갈치시장', '05:00-22:00', 91, 78);
say('agt_04', 1, '너무 빡빡해요. 흰여울문화마을에서 여유롭게 쉬고 싶어요.');
check('agt_04', '흰여울문화마을', null, 64, 35);
const r1: ReactionRow[] = [
  ...base.filter((r) => r[0] !== 'plc_07'),
  ['plc_07', 'agt_01', 'warn', '이동 시간이 길어 부담돼요'],
  ['plc_09', 'agt_03', 'like', '멸치회가 가성비 좋아요'],
];
board(r1, agenda);
propose('pln_01', 1, ['plc_01', 'plc_02', 'plc_08', 'plc_07', 'plc_03'], ['plc_06', 'plc_09']);
vote('pln_01', [['agt_01', 'yes', 8], ['agt_02', 'yes', 7], ['agt_03', 'no', 5], ['agt_04', 'no', 4]]);

// 2라운드
ev('round.started', { round: 2, maxRounds: 3 });
say('agt_04', 2, '첫날이 너무 길어요. 다대포는 빼고 흰여울에서 천천히 쉬면 어떨까요?');
say('agt_02', 2, '다대포 일몰은 꼭 보고 싶어요. 대신 케이블카는 포기할게요.');
check('agt_02', '다대포 꿈의낙조분수', null, 72, 50);
say('agt_01', 2, '시간표만 지켜지면 좋아요. 감천은 오후 일찍 넣으면 일몰에 맞출 수 있어요.');
say('agt_03', 2, '서쪽에서 동쪽으로 한 방향이면 이동이 줄어요.');
const r2: ReactionRow[] = [
  ...r1,
  ['plc_05', 'agt_04', 'like', '한적하게 바다를 보며 쉬기 좋아요'],
  ['plc_10', 'agt_01', 'like', '대변항에서 가까워 이동이 짧아요'],
  ['plc_11', 'agt_02', 'warn', '다대포 일몰을 위해 양보할게요'],
];
board(r2, agenda);
propose('pln_02', 2, ['plc_01', 'plc_02', 'plc_04', 'plc_08', 'plc_03'], ['plc_06', 'plc_05', 'plc_09', 'plc_10']);
vote('pln_02', [['agt_01', 'yes', 8], ['agt_02', 'no', 5], ['agt_03', 'yes', 8], ['agt_04', 'yes', 7]]);

// 3라운드
ev('round.started', { round: 3, maxRounds: 3 });
say('agt_04', 3, '다대포까지 넣으면 첫날이 길어요. 흰여울에서 쉬는 시간을 넉넉히 주면 찬성할게요.');
say('agt_01', 3, '자갈치 점심을 30분 줄여서 시간을 맞출게요. 양보할게요.');
say('agt_02', 3, '흰여울에서 천천히 쉬어 가요. 대신 일몰은 놓치지 않을게요!');
say('agt_03', 3, '첫날 동선이 서쪽에서 동쪽으로 한 방향이라 깔끔해요.');
const r3: ReactionRow[] = [
  ...r2.filter((r) => r[0] !== 'plc_07'),
  ['plc_07', 'agt_01', 'warn', '이동이 길지만 시간표를 맞출게요'],
  ['plc_04', 'agt_03', 'like', '자갈치시장에서 가까워 동선이 짧아요'],
];
board(r3, [{ placeId: 'plc_04', text: '흰여울 카페 휴식 포함' }]);
propose('pln_03', 3, ['plc_01', 'plc_02', 'plc_04', 'plc_08', 'plc_07', 'plc_03'], ['plc_09', 'plc_10', 'plc_05', 'plc_06']);
vote('pln_03', [['agt_01', 'yes', 8], ['agt_02', 'yes', 8], ['agt_03', 'yes', 7], ['agt_04', 'yes', 9]]);
ev('meeting.agreed', {
  planId: 'pln_03',
  round: 3,
  durationSec: 154,
  proposalCount: 3,
  editCount: 5,
  satisfaction: [
    { memberId: 'mem_01', score: 8 },
    { memberId: 'mem_02', score: 8 },
    { memberId: 'mem_03', score: 7 },
    { memberId: 'mem_04', score: 9 },
  ],
  concessions: [
    { memberId: 'mem_02', gave: '송도해상케이블카', got: '다대포 일몰' },
    { memberId: 'mem_04', gave: '범어사', got: '흰여울 카페 시간' },
  ],
});

// 서연의 수정 요청 → 재협상
ev('confirm.requested', { planId: 'pln_03', version: 3 });
confirm('pln_03', ['approve', 'approve', 'approve', 'revise']);
ev('meeting.started', { meetingId: 'mtg_02', kind: 'renegotiation', maxRounds: 2, agents: busanAgents });
ev('round.started', { round: 1, maxRounds: 2 });
say('agt_04', 1, '둘째 날 아침은 늦게 시작하고 싶어요. 해운대에서 천천히 걷는 걸로 시작해요.');
say('agt_01', 1, '그럼 둘째 날 순서를 해운대, 청사포, 대변항, 해동용궁사로 바꿀게요.');
say('agt_02', 1, '대변항에서 점심 먹고 용궁사 가는 코스 좋아요!');
say('agt_03', 1, '동쪽으로 한 방향이라 이동도 줄어요.');
propose('pln_04', 4, ['plc_01', 'plc_02', 'plc_04', 'plc_08', 'plc_07', 'plc_03'], ['plc_06', 'plc_05', 'plc_09', 'plc_10']);
vote('pln_04', [['agt_01', 'yes', 8], ['agt_02', 'yes', 9], ['agt_03', 'yes', 8], ['agt_04', 'yes', 9]]);
ev('meeting.agreed', {
  planId: 'pln_04',
  round: 1,
  durationSec: 41,
  proposalCount: 1,
  editCount: 1,
  satisfaction: [
    { memberId: 'mem_01', score: 8 },
    { memberId: 'mem_02', score: 9 },
    { memberId: 'mem_03', score: 8 },
    { memberId: 'mem_04', score: 9 },
  ],
  concessions: [{ memberId: 'mem_01', gave: '둘째 날 이른 출발', got: '동쪽 한 방향 동선' }],
});
ev('confirm.requested', { planId: 'pln_04', version: 4 });
confirm('pln_04', ['approve', 'approve', 'approve', 'approve']);
ev('plan.confirmed', { planId: 'pln_04' });

export const busanEvents: MeetingEvent[] = events;
