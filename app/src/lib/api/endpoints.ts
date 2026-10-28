import type { ApiClient } from './client.ts';
import { parseEvents, parseMeeting, parseMeetingStart } from '../meeting/serverMeeting.ts';
import type { MeetingStart, ReviewChoice, ServerMeeting } from '../meeting/serverMeeting.ts';
import type { ServerEvent } from '../meeting/types.ts';
import { parseSavedConditions, toServerConditions } from '../trip/serverConditions.ts';
import type { SavedConditions } from '../trip/serverConditions.ts';
import type { ConditionsBody } from '../trip/conditions.ts';
import {
  parseInviteInfo,
  parsePersona,
  parseQuestions,
  parseSessionResponse,
} from '../persona/questions.ts';
import type {
  InviteInfo,
  Persona,
  Question,
  SessionResponse,
  SubmitAnswer,
} from '../persona/types.ts';

export type Endpoints = {
  createTrip(title: string, nickname: string, demoMode: boolean): Promise<SessionResponse>;
  getInvite(code: string): Promise<InviteInfo>;
  joinInvite(code: string, nickname: string): Promise<SessionResponse>;
  getTrip(id: string): Promise<InviteInfo>;
  getQuestions(): Promise<Question[]>;
  submitPersona(answers: SubmitAnswer[]): Promise<Persona>;
  getPersona(): Promise<Persona>;
  /** 회의 조건 저장 (방장, 회의 시작 전) */
  saveConditions(tripId: string, body: ConditionsBody): Promise<SavedConditions>;
  /** AI 회의 시작 (방장). 서버는 바로 202를 주고 뒤에서 진행한다 */
  startMeeting(tripId: string): Promise<MeetingStart>;
  getMeeting(meetingId: string): Promise<ServerMeeting>;
  /** 사람 확인: 안건마다 남김·뺌. memberId는 시연 모드에서 방장이 다른 구성원 몫을 대신 낼 때만 */
  submitReview(meetingId: string, choices: ReviewChoice[], memberId?: string): Promise<ServerMeeting>;
  /** 사람 확인 마감 (방장 '진행') */
  closeReview(meetingId: string): Promise<ServerMeeting>;
  /** 놓친 이벤트 조회 (WebSocket과 같은 형식) */
  getEvents(tripId: string, afterSeq: number): Promise<ServerEvent[]>;
};

export function createEndpoints(client: ApiClient): Endpoints {
  return {
    async createTrip(title, nickname, demoMode) {
      const json = await client.post('/trips', { title, nickname, demoMode }, { auth: false });
      return parseSessionResponse(json);
    },
    async getInvite(code) {
      const json = await client.get(`/invites/${encodeURIComponent(code)}`, { auth: false });
      return parseInviteInfo(json);
    },
    async joinInvite(code, nickname) {
      const json = await client.post(
        `/invites/${encodeURIComponent(code)}/join`,
        { nickname },
        { auth: false },
      );
      return parseSessionResponse(json);
    },
    async getTrip(id) {
      return parseInviteInfo(await client.get(`/trips/${id}`));
    },
    async getQuestions() {
      return parseQuestions(await client.get('/persona/questions', { auth: false }));
    },
    async submitPersona(answers) {
      return parsePersona(await client.post('/me/persona', { answers }, { timeoutMs: 20000 }));
    },
    async getPersona() {
      return parsePersona(await client.get('/me/persona'));
    },
    async saveConditions(tripId, body) {
      const json = await client.put(`/trips/${encodeURIComponent(tripId)}/conditions`, toServerConditions(body));
      return parseSavedConditions(json);
    },
    async startMeeting(tripId) {
      return parseMeetingStart(await client.post(`/trips/${encodeURIComponent(tripId)}/meetings`));
    },
    async getMeeting(meetingId) {
      return parseMeeting(await client.get(`/meetings/${encodeURIComponent(meetingId)}`));
    },
    async submitReview(meetingId, choices, memberId) {
      const body = memberId === undefined ? { choices } : { memberId, choices };
      return parseMeeting(await client.post(`/meetings/${encodeURIComponent(meetingId)}/review`, body));
    },
    async closeReview(meetingId) {
      return parseMeeting(await client.post(`/meetings/${encodeURIComponent(meetingId)}/review/close`));
    },
    async getEvents(tripId, afterSeq) {
      return parseEvents(await client.get(`/trips/${encodeURIComponent(tripId)}/events`, { query: { afterSeq } }));
    },
  };
}
