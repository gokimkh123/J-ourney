// 성향 칩 → 캐릭터 소품. react 의존 없는 순수 함수라 노드 테스트로 확인한다.
// 소품 그림 자체는 Bean.tsx에 있고, 여기서는 "어떤 소품을 쓸지"만 고른다.

export type PropKey =
  | 'cap'
  | 'beanie'
  | 'phones'
  | 'bucket'
  | 'glasses'
  | 'sleepy'
  | 'bag'
  | 'scarf'
  | 'clover'
  | 'camera'
  | 'compass'
  | 'book'
  | 'plane';

export type PropSlot = 'head' | 'face' | 'body' | 'hand';

/** 자리마다 소품 하나. */
export type CharacterProps = Partial<Record<PropSlot, PropKey>>;

export const PROP_SLOT: Record<PropKey, PropSlot> = {
  cap: 'head',
  beanie: 'head',
  phones: 'head',
  bucket: 'head',
  glasses: 'face',
  sleepy: 'face',
  bag: 'body',
  scarf: 'body',
  clover: 'body',
  camera: 'hand',
  compass: 'hand',
  book: 'hand',
  plane: 'hand',
};

/** 칩 label → 소품. 여기 없는 칩("상관없음" 등)은 그리지 않는다. */
export const CHIP_PROP: Record<string, PropKey> = {
  계획형: 'glasses',
  즉흥형: 'plane',
  부지런형: 'cap',
  느긋형: 'beanie',
  활기형: 'phones',
  한적형: 'book',
  명소형: 'camera',
  탐험형: 'compass',
  아침형: 'bucket',
  늦잠형: 'sleepy',
  절약형: 'bag',
  투자형: 'scarf',
  '뭐든 좋아': 'clover',
};

/**
 * chips는 강한 순서로 온다. 자리(머리·얼굴·몸통·손)마다 앞쪽 칩 하나만 쓴다.
 * 예: [계획형, 부지런형, 절약형] → 얼굴 안경, 머리 캡, 몸통 크로스백.
 */
export function selectProps(chips: readonly { label: string }[]): CharacterProps {
  const picked: CharacterProps = {};
  for (const chip of chips) {
    if (!Object.hasOwn(CHIP_PROP, chip.label)) continue;
    const key = CHIP_PROP[chip.label];
    const slot = PROP_SLOT[key];
    if (picked[slot] === undefined) picked[slot] = key;
  }
  return picked;
}
