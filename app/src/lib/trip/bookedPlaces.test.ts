import assert from 'node:assert/strict';
import test from 'node:test';

import { checkBookedPlaces, draftsOf, keepInRange, shortDateLabel, tripDays } from './bookedPlaces.ts';

test('짧은 날짜와 여행 기간의 날 목록', () => {
  assert.equal(shortDateLabel('2026-11-08'), '11/8(일)');
  assert.deepEqual(tripDays('2026-11-07', '2026-11-08'), [
    { iso: '2026-11-07', label: '1일차 · 11/7(토)' },
    { iso: '2026-11-08', label: '2일차 · 11/8(일)' },
  ]);
  assert.deepEqual(tripDays('2026-11-08', '2026-11-07'), []);
});

test('이름을 적은 칸은 날짜와 시각을 꼭 정해야 하고, 빈 칸은 없는 것으로 본다', () => {
  const start = '2026-11-07';
  const end = '2026-11-08';
  assert.deepEqual(checkBookedPlaces([{ name: '아쿠아리움', date: '2026-11-07', time: null }], start, end), {
    ok: false,
    error: '예약한 장소의 날짜와 시각을 정해 주세요.',
  });
  assert.deepEqual(checkBookedPlaces([{ name: '아쿠아리움', date: null, time: '14:00' }], start, end), {
    ok: false,
    error: '예약한 장소의 날짜와 시각을 정해 주세요.',
  });
  assert.deepEqual(checkBookedPlaces([{ name: '아쿠아리움', date: '2026-11-09', time: '14:00' }], start, end), {
    ok: false,
    error: '예약한 장소의 날짜는 여행 기간 안에서 골라 주세요.',
  });
  assert.deepEqual(
    checkBookedPlaces(
      [
        { name: '  아쿠아리움 ', date: '2026-11-08', time: '14:00' },
        { name: '   ', date: null, time: null },
        { name: '케이블카', date: '2026-11-07', time: '09:30' },
      ],
      start,
      end,
    ),
    {
      ok: true,
      names: ['아쿠아리움', '케이블카'],
      times: [
        { date: '2026-11-08', time: '14:00' },
        { date: '2026-11-07', time: '09:30' },
      ],
    },
  );
  assert.deepEqual(checkBookedPlaces([], start, end), { ok: true, names: [], times: [] });
});

test('여행 날짜를 바꾸면 기간 밖 예약 날짜만 비운다', () => {
  const drafts = [
    { name: 'a', date: '2026-11-07', time: '10:00' },
    { name: 'b', date: '2026-11-09', time: '11:00' },
    { name: 'c', date: null, time: null },
  ];
  assert.deepEqual(
    keepInRange(drafts, '2026-11-07', '2026-11-08').map((d) => d.date),
    ['2026-11-07', null, null],
  );
});

test('저장해 둔 이름과 날짜·시각으로 칸을 다시 만든다(모르면 비움)', () => {
  assert.deepEqual(draftsOf(['a', 'b'], [{ date: '2026-11-07', time: '10:00' }]), [
    { name: 'a', date: '2026-11-07', time: '10:00' },
    { name: 'b', date: null, time: null },
  ]);
  assert.deepEqual(draftsOf(undefined, undefined), []);
});
