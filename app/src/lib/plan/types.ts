export type PlanStatus = 'voting' | 'revising' | 'confirmed';
export type PlanVoteDecision = 'approve' | 'revise' | 'reject' | 'pending';

export type PlanMove = {
  mode: string;
  minutes: number;
  distanceM: number;
  fareWon: number;
  source: string;
  routeUrl: string;
};

export type PlanPlace = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  openHours: string | null;
  menu: string | null;
  popularity: number;
  crowd: number;
  priceLevel: number;
  kakaoPlaceId: string | null;
  verified: boolean;
  links: { kakaoMap: string; naverMap: string };
  sources: string[];
  baseDate: string;
  checkedAt: string;
};

export type PlanReason = { memberId: string; text: string };

export type PlanItem = {
  id: string;
  startTime: string;
  title: string;
  category: string;
  costPerPerson: number;
  moveFromPrev: PlanMove | null;
  place: PlanPlace;
  forMembers: string[];
  reasons: PlanReason[];
};

export type PlanDay = { day: number; date: string; items: PlanItem[] };

export type PlanSatisfaction = { memberId: string; score: number };
export type PlanConcession = { memberId: string; gave: string; got: string };
export type PlanVote = { memberId: string; decision: PlanVoteDecision };

export type Plan = {
  id: string;
  version: number;
  status: PlanStatus;
  costPerPerson: number;
  budgetPerPerson: number;
  maxStepsPerDay: number;
  satisfaction: PlanSatisfaction[];
  concessions: PlanConcession[];
  votes: PlanVote[];
  days: PlanDay[];
};
