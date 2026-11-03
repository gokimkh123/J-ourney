import type { ApiClient } from './client.ts';
import { parseEvents, parseMeeting, parseMeetingStart } from '../meeting/serverMeeting.ts';
import type { MeetingStart, ReviewChoice, ServerMeeting } from '../meeting/serverMeeting.ts';
import type { ServerEvent } from '../meeting/types.ts';
import { parseSavedConditions, toServerConditions } from '../trip/serverConditions.ts';
import type { SavedConditions } from '../trip/serverConditions.ts';
import type { ConditionsBody } from '../trip/conditions.ts';
import type { PlanEdit, PlanVoteDecision } from '../plan/planEdit.ts';
import { parseMyTripIds, toLogin, type Login } from '../auth/login.ts';
import { parseCommunityList, parseCommunityPlace, parseReview } from '../community/community.ts';
import type { CommunityList, CommunityPlaceDetail, CommunityReview } from '../community/community.ts';
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
  /** 파티 나가기(v2.4, 방장 아님·회의 시작 전). 방장 403, 회의 시작 뒤 409 */
  leaveTrip(tripId: string): Promise<void>;
  /** 파티 없애기(v2.4, 방장·되돌릴 수 없음). 회의 도는 중 409 */
  deleteTrip(tripId: string): Promise<void>;
  /** 카카오 로그인(v2.5): 카카오 액세스 토큰 → 우리 로그인 토큰. 앱은 브라우저 로그인을 쓰므로 가짜 데이터 모드에서만 부른다 */
  loginKakao(accessToken: string): Promise<Login>;
  /** 로그아웃: 이 기기의 로그인 토큰만 지운다 */
  logout(): Promise<void>;
  /** 이 계정으로 만들거나 참여한 여행 id(최근 것부터) */
  getMyTripIds(): Promise<string[]>;
  /** 내 여행의 구성원 토큰 다시 받기. 예전 토큰과 그 기기의 연결은 끊긴다 */
  reissueTripToken(tripId: string): Promise<SessionResponse>;
  /** 커뮤니티 장소 목록(v2.4, 인증 불필요). regionCode 없으면 전국 */
  getCommunityPlaces(regionCode?: string): Promise<CommunityList>;
  /** 장소 하나 + 후기. 구성원 토큰을 주면 내 후기에 mine */
  getCommunityPlace(placeId: string, memberToken?: string): Promise<CommunityPlaceDetail>;
  /** 후기 쓰기·고치기(장소마다 1개, 구성원 토큰 필요) */
  putCommunityReview(placeId: string, rating: number, text: string, memberToken: string): Promise<CommunityReview>;
  /** 내 후기 지우기(없어도 204) */
  deleteCommunityReview(placeId: string, memberToken: string): Promise<void>;
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
  /** baseVersion(v2.4): 보고 있던 일정 version. 서버 version과 다르면 아무것도 안 고치고 409 PLAN_LOCKED */
  editPlan(tripId: string, edits: PlanEdit[], baseVersion?: number): Promise<unknown>;
  /** 방장: 확정 투표 시작 */
  requestConfirm(tripId: string): Promise<unknown>;
  /** 확정 투표 */
  votePlan(tripId: string, decision: PlanVoteDecision, memberId?: string): Promise<unknown>;
};

export function createEndpoints(client: ApiClient): Endpoints {
  return {
    async createTrip(title, nickname, demoMode) {
      // 로그인했으면 로그인 토큰을 같이 보내 그 자리를 계정에 묶는다(v2.5).
      const json = await client.post('/trips', { title, nickname, demoMode }, { auth: false, login: true });
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
        { auth: false, login: true },
      );
      return parseSessionResponse(json);
    },
    async getTrip(id) {
      return parseInviteInfo(await client.get(`/trips/${id}`));
    },
    async leaveTrip(tripId) {
      await client.request('DELETE', `/trips/${encodeURIComponent(tripId)}/members/me`);
    },
    async deleteTrip(tripId) {
      await client.request('DELETE', `/trips/${encodeURIComponent(tripId)}`);
    },
    async loginKakao(accessToken) {
      const json = (await client.post('/auth/kakao', { accessToken }, { auth: false })) as { token?: unknown; expiresAt?: unknown } | null;
      const login = toLogin(json);
      if (login === null) throw new Error('로그인 응답 모양이 올바르지 않습니다.');
      return login;
    },
    async logout() {
      await client.request('DELETE', '/auth/session', { login: true });
    },
    async getMyTripIds() {
      return parseMyTripIds(await client.get('/users/me/trips', { login: true }));
    },
    async reissueTripToken(tripId) {
      return parseSessionResponse(await client.post(`/users/me/trips/${encodeURIComponent(tripId)}/token`, undefined, { login: true }));
    },
    async getCommunityPlaces(regionCode) {
      return parseCommunityList(await client.get('/community/places', { auth: false, query: { regionCode } }));
    },
    async getCommunityPlace(placeId, memberToken) {
      const path = `/community/places/${encodeURIComponent(placeId)}`;
      return parseCommunityPlace(await client.get(path, memberToken === undefined ? { auth: false } : { token: memberToken }));
    },
    async putCommunityReview(placeId, rating, text, memberToken) {
      const json = (await client.put(`/community/places/${encodeURIComponent(placeId)}/review`, { rating, text }, { token: memberToken })) as { review?: unknown } | null;
      const review = parseReview(json?.review);
      if (review === null) throw new Error('후기 응답 모양이 올바르지 않습니다.');
      return review;
    },
    async deleteCommunityReview(placeId, memberToken) {
      await client.request('DELETE', `/community/places/${encodeURIComponent(placeId)}/review`, { token: memberToken });
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
    async editPlan(tripId, edits, baseVersion) {
      // 고칠 때마다 서버가 길찾기로 다시 짜서 오래 걸릴 수 있다.
      return client.post(`/trips/${encodeURIComponent(tripId)}/plan/edits`, baseVersion === undefined ? { edits } : { edits, baseVersion }, { timeoutMs: 30000 });
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
