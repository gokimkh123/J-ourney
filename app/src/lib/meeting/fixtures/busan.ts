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

export const busanEvents: MeetingEvent[] = [
  {
    type: 'meeting.started',
    tripId: 'trp_8f3k2',
    seq: 1,
    at: '2026-10-24T14:00:00+09:00',
    data: { meetingId: 'mtg_01', kind: 'meeting', maxRounds: 3, agents: busanAgents },
  },
];
