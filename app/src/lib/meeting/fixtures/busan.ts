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

const places = [
  { placeId: 'plc_01', name: '○○ 돼지국밥', lat: 35.1262, lng: 129.034, proposedBy: ['agt_01', 'agt_03'] },
  { placeId: 'plc_02', name: '자갈치시장', lat: 35.0967, lng: 129.0305, proposedBy: ['agt_01'] },
  { placeId: 'plc_03', name: '광안리 회센터', lat: 35.1555, lng: 129.1345, proposedBy: ['agt_02'] },
  { placeId: 'plc_04', name: '흰여울문화마을', lat: 35.0786, lng: 129.0446, proposedBy: ['agt_04'] },
  { placeId: 'plc_05', name: '○○ 카페', lat: 35.07, lng: 129.066, proposedBy: ['agt_02', 'agt_04'] },
  { placeId: 'plc_06', name: '해운대 해돋이', lat: 35.1592, lng: 129.159, proposedBy: ['agt_02'] },
  { placeId: 'plc_07', name: '○○ 온천', lat: 35.219, lng: 129.089, proposedBy: ['agt_02', 'agt_04'] },
  { placeId: 'plc_08', name: '감천문화마을', lat: 35.0975, lng: 129.0106, proposedBy: ['agt_02'] },
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

// AI별 조사: planning → searching → picking → done
const research: [agentId: string, tool: 'tourSearch' | 'tourRank' | 'distance' | 'crowd', placeId: string, found: number][] = [
  ['agt_01', 'tourSearch', 'plc_01', 12],
  ['agt_02', 'tourRank', 'plc_06', 9],
  ['agt_03', 'distance', 'plc_03', 14],
  ['agt_04', 'crowd', 'plc_04', 7],
];
for (const stage of ['planning', 'searching', 'picking', 'done'] as const) {
  for (const [agentId, tool, placeId, found] of research) {
    const p = place(placeId);
    if (stage === 'planning') ev('research.progress', { agentId, stage, foundCount: 0 });
    else if (stage === 'searching') {
      ev('research.progress', { agentId, stage, tool, focus: { lat: p.lat, lng: p.lng, label: p.name }, foundCount: found });
    } else ev('research.progress', { agentId, stage, foundCount: found });
  }
}

const base: ReactionRow[] = [
  ['plc_04', 'agt_04', 'like', '붐비지 않고 바다를 보며 걷기 좋아요'],
  ['plc_07', 'agt_02', 'like', '여행 마지막에 쉬어 가기 좋아요'],
  ['plc_03', 'agt_03', 'like', '저녁 회가 가성비 좋아요'],
  ['plc_02', 'agt_03', 'warn', '주말엔 사람이 많아 이동이 느려요'],
  ['plc_06', 'agt_01', 'block', '일출 시간 때문에 일정이 너무 빡빡해요'],
];
const agenda = [{ placeId: 'plc_06', text: '해돋이를 넣을지 정하기' }];
board(base, agenda);

// 1라운드
ev('round.started', { round: 1, maxRounds: 3 });
say('agt_01', 1, '첫날은 돼지국밥으로 시작해서 자갈치시장, 감천문화마을까지 묶어 볼게요.');
check('agt_01', '○○ 돼지국밥', '09:00-21:00', 82, 55);
say('agt_02', 1, '둘째 날은 광안리 회센터에서 저녁, 해돋이도 꼭 넣고 싶어요!');
say('agt_03', 1, '자갈치시장은 붐비니까 동선을 짧게 잡는 게 좋겠어요.');
check('agt_03', '자갈치시장', '05:00-22:00', 91, 78);
say('agt_04', 1, '너무 빡빡해요. 흰여울문화마을에서 여유롭게 걷고 싶어요.');
check('agt_04', '흰여울문화마을', null, 64, 35);
const r1: ReactionRow[] = [
  ...base.filter((r) => r[0] !== 'plc_06'),
  ['plc_06', 'agt_01', 'warn', '새벽 이동이 부담돼요'],
  ['plc_01', 'agt_03', 'like', '가격이 합리적이에요'],
];
board(r1, agenda);
propose('pln_01', 1, ['plc_01', 'plc_02', 'plc_08'], ['plc_03', 'plc_06']);
vote('pln_01', [['agt_01', 'yes', 8], ['agt_02', 'yes', 7], ['agt_03', 'no', 5], ['agt_04', 'no', 4]]);

// 2라운드
ev('round.started', { round: 2, maxRounds: 3 });
say('agt_04', 2, '첫날 일정이 길어요. 흰여울문화마을을 넣고 감천은 빼면 어떨까요?');
say('agt_02', 2, '온천도 넣으면 마지막 날 쉬는 시간이 생겨요.');
check('agt_02', '○○ 온천', '06:00-21:00', 70, 40);
say('agt_01', 2, '시간표만 지켜지면 좋아요. 카페는 이동 사이에 넣죠.');
say('agt_03', 2, '이동 거리는 줄어들었으니 괜찮아요.');
const r2: ReactionRow[] = [
  ...r1.filter((r) => r[0] !== 'plc_07'),
  ['plc_07', 'agt_02', 'like', '여행 마지막에 쉬어 가기 좋아요'],
  ['plc_07', 'agt_04', 'like', '조용히 쉬기 좋아요'],
  ['plc_05', 'agt_04', 'like', '오후에 앉아서 쉴 수 있어요'],
];
board(r2, agenda);
propose('pln_02', 2, ['plc_01', 'plc_02', 'plc_04'], ['plc_05', 'plc_03', 'plc_07']);
vote('pln_02', [['agt_01', 'yes', 8], ['agt_02', 'yes', 8], ['agt_03', 'yes', 7], ['agt_04', 'no', 5]]);

// 3라운드
ev('round.started', { round: 3, maxRounds: 3 });
say('agt_04', 3, '둘째 날 일정이 아직 많아요. 하나만 줄이면 찬성할게요.');
say('agt_01', 3, '자갈치시장 순서를 바꾸면 이동이 줄어요. 양보할게요.');
say('agt_02', 3, '해돋이는 포기할게요. 대신 카페를 오후에 넣어요.');
say('agt_03', 3, '동선이 이제 깔끔해요.');
const r3: ReactionRow[] = [
  ...r2.filter((r) => r[0] !== 'plc_06'),
  ['plc_06', 'agt_02', 'warn', '이번에는 양보할게요'],
  ['plc_04', 'agt_03', 'like', '동선이 짧아요'],
];
board(r3, [{ placeId: 'plc_05', text: '오후 카페 휴식 포함' }]);
propose('pln_03', 3, ['plc_01', 'plc_04', 'plc_02'], ['plc_05', 'plc_03', 'plc_07']);
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
    { memberId: 'mem_02', gave: '해운대 해돋이', got: '오후 카페' },
    { memberId: 'mem_01', gave: '빡빡한 시간표', got: '돼지국밥 첫 일정' },
  ],
});

// 서연의 수정 요청 → 재협상
ev('confirm.requested', { planId: 'pln_03', version: 3 });
confirm('pln_03', ['approve', 'approve', 'approve', 'revise']);
ev('meeting.started', { meetingId: 'mtg_02', kind: 'renegotiation', maxRounds: 2, agents: busanAgents });
ev('round.started', { round: 1, maxRounds: 2 });
say('agt_04', 1, '둘째 날 아침은 늦게 시작하고 싶어요. 카페를 먼저 가요.');
say('agt_01', 1, '그럼 둘째 날 순서를 카페, 온천, 회센터로 바꿀게요.');
say('agt_02', 1, '온천 뒤 저녁 회센터 좋아요!');
say('agt_03', 1, '이동 거리도 비슷해서 괜찮아요.');
propose('pln_04', 4, ['plc_01', 'plc_04', 'plc_02'], ['plc_05', 'plc_07', 'plc_03']);
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
  concessions: [{ memberId: 'mem_01', gave: '둘째 날 이른 출발', got: '일정 순서 유지' }],
});
ev('confirm.requested', { planId: 'pln_04', version: 4 });
confirm('pln_04', ['approve', 'approve', 'approve', 'approve']);
ev('plan.confirmed', { planId: 'pln_04' });

export const busanEvents: MeetingEvent[] = events;
