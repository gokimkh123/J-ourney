/** 회의 조건 (명세서 4.4 PUT /trips/{tripId}/conditions 본문과 같은 형식) */
export interface TripConditions {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: number | null;
  transport: string | null;
  rules: { aiMinSatisfaction: number; maxRounds: number };
}

/** 목적지를 코드로 바꾼 결과 (districtCodes가 비면 시·도 전체) */
export interface ResolvedDestination {
  regionCode: string;
  regionName: string;
  districtCodes: string[];
  label: string;
}
