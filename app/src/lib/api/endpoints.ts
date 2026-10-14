import type { ApiClient } from './client.ts';
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
      return parsePersona(await client.post('/me/persona', { answers }));
    },
    async getPersona() {
      return parsePersona(await client.get('/me/persona'));
    },
  };
}
