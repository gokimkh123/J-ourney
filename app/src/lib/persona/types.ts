export type ScaleQuestion = {
  id: string;
  order: number;
  type: 'scale';
  text: string;
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
};

export type MultiQuestion = {
  id: string;
  order: number;
  type: 'multi';
  text: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; text: string; emoji: string }[];
};

export type TextQuestion = {
  id: string;
  order: number;
  type: 'text';
  text: string;
  required: boolean;
  maxLength: number;
  placeholder: string;
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

export type Chip = {
  label: string;
  emoji: string;
};

export type TraitLevel = 'low' | 'neutral' | 'high';

export type Trait = {
  key: string;
  name: string;
  score: number;
  level: TraitLevel;
  label: string;
  emoji: string;
};

export type PickedOption = {
  id: string;
  text: string;
  emoji: string;
};

export type MustKeep = {
  type: string;
  label: string;
};

export type Persona = {
  memberId: string;
  nickname: string;
  color: string;
  no: number;
  title: string;
  catchphrase: string;
  tmi: string;
  chips: Chip[];
  traits: Trait[];
  likes: PickedOption[];
  dislikes: PickedOption[];
  mustKeep: MustKeep[];
  wishes: string[];
  source: 'llm' | 'rule';
  updatedAt: string;
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
  title: string | null;
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
