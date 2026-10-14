import type { Chip } from './types.js';

interface FallbackText {
  title: string;
  catchphrase: string;
  tmi: string;
}

/** LLM이 실패하거나 하루 상한을 넘었을 때 쓰는 규칙 문장 (가장 강한 성향 칩 기준) */
const BY_CHIP: Record<string, FallbackText> = {
  계획형: { title: '꼼꼼한 플래너', catchphrase: '일정표는 제가 챙길게요!', tmi: '여행 체크리스트가 세 장 넘음' },
  즉흥형: { title: '자유로운 모험가', catchphrase: '일단 가 보고 정해요~', tmi: '지도 앱보다 감을 더 믿음' },
  부지런형: { title: '부지런한 탐방가', catchphrase: '하나라도 더 보고 가요!', tmi: '여행 첫날 만 보는 기본' },
  느긋형: { title: '느긋한 힐러', catchphrase: '천천히 가도 괜찮아요~', tmi: '숙소 침대와 금방 친해짐' },
  활기형: { title: '신나는 분위기메이커', catchphrase: '사람 많은 곳이 신나요!', tmi: '축제 소식엔 귀가 쫑긋' },
  한적형: { title: '조용한 산책가', catchphrase: '조용한 곳으로 가요~', tmi: '한적한 골목을 귀신같이 찾음' },
  탐험형: { title: '숨은 길 탐험가', catchphrase: '아무도 모르는 곳 찾아봐요!', tmi: '골목 끝까지 가 봐야 직성이 풀림' },
  명소형: { title: '인증샷 수집가', catchphrase: '유명한 곳은 꼭 가 봐야죠!', tmi: '인증샷 각도 연구가 취미' },
  아침형: { title: '새벽 일출러', catchphrase: '아침 일찍 출발해요!', tmi: '알람보다 먼저 일어남' },
  늦잠형: { title: '느지막한 여행자', catchphrase: '아침은 천천히 시작해요~', tmi: '아침 9시는 새벽이라고 생각함' },
  투자형: { title: '통 큰 여행자', catchphrase: '여행에선 아끼지 말아요!', tmi: '맛있으면 비싸도 괜찮음' },
  절약형: { title: '알뜰 여행자', catchphrase: '가성비 좋은 곳 찾아올게요!', tmi: '할인 쿠폰 모으는 게 취미' },
};
const ANYTHING: FallbackText = { title: '뭐든 좋은 여행자', catchphrase: '다 좋아요, 같이 정해요!', tmi: '어디든 함께라면 즐거움' };

export function fallbackText(chips: Chip[]): FallbackText {
  return BY_CHIP[chips[0]?.label ?? ''] ?? ANYTHING;
}
