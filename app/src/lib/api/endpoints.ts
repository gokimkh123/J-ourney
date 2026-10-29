import type { ApiClient } from './client.ts';
import { parseEvents, parseMeeting, parseMeetingStart } from '../meeting/serverMeeting.ts';
import type { MeetingStart, ReviewChoice, ServerMeeting } from '../meeting/serverMeeting.ts';
import type { ServerEvent } from '../meeting/types.ts';
import { parseSavedConditions, toServerConditions } from '../trip/serverConditions.ts';
import type { SavedConditions } from '../trip/serverConditions.ts';
import type { ConditionsBody } from '../trip/conditions.ts';
import type { PlanEdit, PlanVoteDecision } from '../plan/planEdit.ts';
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
  // 명세 v2.3 회의 뒤 일정 표(14·15단계). 일정 표 모양의 응답은 동기화 장치(lib/plan/boardSync.ts)가 읽으므로 그대로 돌려준다.
  // memberId는 시연 모드에서 방장이 다른 구성원 몫을 대신 낼 때만.
  /** 일정 표 (회의가 끝나기 전에는 404 NOT_FOUND) */
  getPlan(tripId: string): Promise<unknown>;
  /** A·B 고르기. 다시 내면 덮어쓴다. 모두 고르면 서버가 정한다 */
  choosePlan(tripId: string, planId: string, memberId?: string): Promise<unknown>;
  /** 방장 '정하기': 고른 사람만으로 정한다 */
  closeChoice(tripId: string): Promise<unknown>;
  /** 고칠 때 고를 보기(넣을 관광지·끼니마다 바꿀 식당) */
  getPlanOptions(tripId: string): Promise<unknown>;
  /** 고치기. 응답은 일정 표 + results(건마다 반영 여부) */
  editPlan(tripId: string, edits: PlanEdit[]): Promise<unknown>;
  /** 방장: 확정 투표 시작 */
  requestConfirm(tripId: string): Promise<unknown>;
  /** 확정 투표 */
  votePlan(tripId: string, decision: PlanVoteDecision, memberId?: string): Promise<unknown>;
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
    async getPlan(tripId) {
      return client.get(`/trips/${encodeURIComponent(tripId)}/plan`);
    },
    async choosePlan(tripId, planId, memberId) {
      const body = memberId === undefined ? { planId } : { planId, memberId };
      return client.post(`/trips/${encodeURIComponent(tripId)}/plan/choice`, body);
    },
    async closeChoice(tripId) {
      return client.post(`/trips/${encodeURIComponent(tripId)}/plan/choice/close`);
    },
    async getPlanOptions(tripId) {
      return client.get(`/trips/${encodeURIComponent(tripId)}/plan/options`);
    },
    async editPlan(tripId, edits) {
      // 고칠 때마다 서버가 길찾기로 다시 짜서 오래 걸릴 수 있다.
      return client.post(`/trips/${encodeURIComponent(tripId)}/plan/edits`, { edits }, { timeoutMs: 30000 });
    },
    async requestConfirm(tripId) {
      return client.post(`/trips/${encodeURIComponent(tripId)}/plan/confirm`);
    },
    async votePlan(tripId, decision, memberId) {
      const body = memberId === undefined ? { decision } : { decision, memberId };
      return client.post(`/trips/${encodeURIComponent(tripId)}/plan/votes`, body);
    },
  };
}
