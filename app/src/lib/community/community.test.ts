import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient } from '../api/client.ts';
import { createEndpoints } from '../api/endpoints.ts';
import { ApiError } from '../api/errors.ts';
import { createMockFetch } from '../api/mock.ts';
import { createMockRoutes } from '../api/mockRoutes.ts';
import {
  districtOf,
  districtsOf,
  filterByDistrict,
  kakaoMapUrl,
  parseCommunityList,
  parseCommunityPlace,
  plainOverview,
  ratingWord,
  regionName,
  reviewDate,
} from './community.ts';

const card = (placeId: string, address: string | null, aiPicks = 1) => ({
  placeId,
  name: placeId,
  group: '자연',
  category: null,
  imageUrl: null,
  imageCredit: null,
  address,
  lat: 35,
  lng: 129,
  aiPicks,
  rating: { average: null, count: 0 },
  openNow: null,
  hours: null,
});

test('목록 응답: 모양이 다른 장소는 건너뛰고 빈 묶음은 뺀다', () => {
  const list = parseCommunityList({
    regionCode: '26',
    regionName: '부산광역시',
    sections: [
      { group: '자연', aiPicks: 3, places: [card('plc_1', '부산광역시 영도구 전망로 24'), { name: '아이디 없음' }] },
      { group: '음식', aiPicks: 0, places: [{ nope: true }] },
      null,
    ],
  });
  assert.equal(list.sections.length, 1);
  assert.equal(list.sections[0]!.places.length, 1);
  assert.equal(list.regionName, '부산광역시');
  assert.deepEqual(parseCommunityList(null), { regionCode: null, regionName: null, sections: [] });
});

test('장소 응답: 소개글과 후기를 읽고, 장소가 없으면 오류', () => {
  const d = parseCommunityPlace({
    place: { ...card('plc_1', null), overview: '소개' },
    reviews: [{ reviewId: 'rvw_1', nickname: '지은', rating: 5, text: '좋아요', mine: true, updatedAt: '2026-10-28T10:00:00+09:00' }, { bad: 1 }],
  });
  assert.equal(d.place.overview, '소개');
  assert.equal(d.reviews.length, 1);
  assert.equal(d.reviews[0]!.mine, true);
  assert.throws(() => parseCommunityPlace({ reviews: [] }));
});

test('주소에서 구·군을 뽑고, 목록을 구·군으로 거른다', () => {
  assert.equal(districtOf('부산광역시 해운대구 우동 1'), '해운대구');
  assert.equal(districtOf('경기도 수원시 팔달구'), '수원시');
  assert.equal(districtOf('세종특별자치시 한누리대로'), null);
  assert.equal(districtOf(null), null);
  const list = parseCommunityList({
    sections: [
      { group: '자연', aiPicks: 9, places: [card('a', '부산광역시 영도구 x', 5), card('b', '부산광역시 해운대구 y', 4)] },
      { group: '음식', aiPicks: 2, places: [card('c', '부산광역시 해운대구 z', 2)] },
    ],
  });
  assert.deepEqual(districtsOf(list), ['영도구', '해운대구']);
  const yd = filterByDistrict(list, '영도구');
  assert.deepEqual(yd.sections.map((s) => [s.group, s.aiPicks, s.places.length]), [['자연', 5, 1]]);
  assert.equal(filterByDistrict(list, null), list);
});

test('화면 문장: 지역 이름, 별점 말, 날짜, 소개글 줄바꿈, 카카오맵 링크', () => {
  assert.equal(regionName(null), '전국');
  assert.equal(regionName('26'), '부산');
  assert.equal(regionName('99'), '전국');
  assert.equal(ratingWord(4), '좋았어요');
  assert.equal(ratingWord(0), '');
  assert.equal(reviewDate('2026-10-28T15:20:00+09:00'), '10월 28일');
  assert.equal(reviewDate(''), '');
  assert.equal(plainOverview('첫 줄<br>둘째 줄<br />'), '첫 줄\n둘째 줄');
  assert.equal(plainOverview('<b> </b>'), null);
  assert.equal(kakaoMapUrl({ name: '태종대', lat: 35.05, lng: 129.08 }), 'https://map.kakao.com/link/map/%ED%83%9C%EC%A2%85%EB%8C%80,35.05,129.08');
});

test('가짜 서버: 목록·상세, 구성원 토큰으로 후기 쓰기·고치기·지우기, 내 후기 표시', async () => {
  let token: string | null = null;
  const api = createEndpoints(createApiClient({ baseUrl: 'http://mock.local', fetchFn: createMockFetch(createMockRoutes()), getToken: () => token }));
  const all = await api.getCommunityPlaces();
  assert.ok(all.sections.length > 0);
  assert.equal((await api.getCommunityPlaces('51')).sections.length, 0);
  const placeId = all.sections[0]!.places[0]!.placeId;

  const made = await api.createTrip('부산', '민수', false);
  token = made.token;
  // 커뮤니티는 파티 밖에서 쓰므로 토큰을 직접 넘긴다(지금 세션 토큰이 아니어도 된다).
  const anon = await api.getCommunityPlace(placeId);
  assert.equal(anon.reviews.some((r) => r.mine), false);

  await api.putCommunityReview(placeId, 4, '  좋았어요  ', made.token);
  await api.putCommunityReview(placeId, 5, '다시 와도 좋아요', made.token);
  const mine = await api.getCommunityPlace(placeId, made.token);
  const my = mine.reviews.filter((r) => r.mine);
  assert.equal(my.length, 1);
  assert.equal(my[0]!.rating, 5);
  assert.equal(my[0]!.nickname, '민수');
  assert.equal((await api.getCommunityPlace(placeId)).reviews.some((r) => r.mine), false);

  await api.deleteCommunityReview(placeId, made.token);
  assert.equal((await api.getCommunityPlace(placeId, made.token)).reviews.some((r) => r.mine), false);
  await assert.rejects(api.putCommunityReview(placeId, 6, '', made.token), (e: unknown) => e instanceof ApiError && e.status === 400);
  await assert.rejects(api.putCommunityReview(placeId, 3, '', 'tok_없음'), (e: unknown) => e instanceof ApiError && e.status === 401);
});
