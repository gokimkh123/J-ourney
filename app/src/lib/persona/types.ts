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
  /** '기타' 직접 입력(v2.4). 있으면 보기에 없는 것을 글로 적을 수 있고, 적으면 최소 개수를 하나 채운 것으로 친다(최대 개수는 보기만 센다). */
  other?: { maxLength: number; placeholder: string };
};

/** 여러 줄 글 입력(v2.4, 가고 싶은 곳). 한 줄씩 추가해 maxItems개까지 적는다. */
export type ListQuestion = {
  id: string;
  order: number;
  type: 'list';
  text: string;
  required: boolean;
  maxItems: number;
  maxLength: number;
  placeholder: string;
};

/** 하나 고르기(v2.4, 이번 여행 속도). 보낼 때는 optionIds에 하나만 담는다. */
export type SingleQuestion = {
  id: string;
  order: number;
  type: 'single';
  text: string;
  required: boolean;
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

export type Question = ScaleQuestion | MultiQuestion | ListQuestion | SingleQuestion | TextQuestion;

export type Answer =
  | { type: 'scale'; value: number }
  | { type: 'multi'; optionIds: string[]; other?: string }
  | { type: 'list'; texts: string[] }
  | { type: 'single'; optionId: string }
  | { type: 'text'; text: string };

export type AnswerState = Record<string, Answer>;

export type SubmitAnswer =
  | { questionId: string; value: number }
  | { questionId: string; optionIds: string[] }
  | { questionId: string; optionIds: string[]; text: string }
  | { questionId: string; texts: string[] }
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
  /** 성향 칩(캐릭터 소품용). 명세 v2.3에는 없어 서버가 보내 줄 때만 있다. */
  chips?: Chip[];
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
