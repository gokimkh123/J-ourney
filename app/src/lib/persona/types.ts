export type ScaleAxis = 'EI' | 'SN' | 'TF' | 'JP';

export type ScaleQuestion = {
  id: string;
  order: number;
  type: 'scale';
  axis: ScaleAxis;
  text: string;
  left: string;
  right: string;
};

export type MultiQuestion = {
  id: string;
  order: number;
  type: 'multi';
  text: string;
  options: { id: string; text: string }[];
};

export type TextQuestion = {
  id: string;
  order: number;
  type: 'text';
  text: string;
  required: boolean;
  maxLength: number;
};

export type Question = ScaleQuestion | MultiQuestion | TextQuestion;

export type Answer =
  | { type: 'scale'; value: number }
  | { type: 'multi'; optionIds: string[] }
  | { type: 'text'; text: string };

export type AnswerState = Record<string, Answer>;

export type SubmitAnswer =
  | { questionId: string; value: number }
  | { questionId: string; optionIds: string[] }
  | { questionId: string; text: string };

export type PersonaAxis = {
  pair: ScaleAxis;
  letter: string;
  percent: number;
};

export type Persona = {
  memberId: string;
  mbti: string;
  title: string;
  summary: string;
  speechStyle: string;
  axes: PersonaAxis[];
  interests: string[];
  mustDo: string[];
  dealBreakers: string[];
  source: 'llm' | 'template';
};

export type TripStatus = 'preparing' | 'meeting' | 'voting' | 'confirmed';

export type Trip = {
  id: string;
  title: string;
  inviteCode: string;
  status: TripStatus;
};

export type Member = {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  personaReady: boolean;
  mbti: string | null;
};

export type SessionResponse = {
  trip: Trip;
  member: Member;
  token: string;
};

export type InviteInfo = {
  trip: Trip;
  members: Member[];
};
