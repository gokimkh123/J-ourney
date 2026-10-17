import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  dateLabel,
  daysBetween,
  isSelectable,
  monthGrid,
  nextSaturday,
  pickDate,
  shiftMonth,
  todayISO,
  weekdayKo,
} from './dateRange.ts';

test('날짜 더하기는 달·해·윤일을 넘어간다', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-11-14', '2026-11-15'), 1);
});

test('요일과 날짜 글자', () => {
  assert.equal(weekdayKo('2026-11-14'), '토');
  assert.equal(weekdayKo('2026-11-15'), '일');
  assert.equal(dateLabel('2026-11-14'), '11월 14일 (토)');
  assert.equal(dateLabel('2026-12-05'), '12월 5일 (토)');
});

test('todayISO는 현지 날짜를 쓴다', () => {
  assert.equal(todayISO(new Date(2026, 9, 17, 23, 59)), '2026-10-17');
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('다음 토요일: 오늘이 토요일이어도 7일 뒤 이후', () => {
  assert.equal(nextSaturday('2026-10-17'), '2026-10-24');
  assert.equal(nextSaturday('2026-10-18'), '2026-10-31');
  assert.equal(nextSaturday('2026-10-23'), '2026-10-31');
  assert.equal(weekdayKo(nextSaturday('2026-12-30')), '토');
});

test('달력 칸: 일요일 시작, 주마다 7칸, 달 밖은 null', () => {
  const grid = monthGrid(2026, 11); // 11월 1일은 일요일
  assert.ok(grid.every((week) => week.length === 7));
  assert.equal(grid[0]![0], '2026-11-01');
  assert.equal(grid.flat().filter((c) => c !== null).length, 30);
  assert.equal(grid.at(-1)!.at(-1), null);
  const feb = monthGrid(2028, 2); // 윤년 29일, 2월 1일은 화요일
  assert.equal(feb[0]![2], '2028-02-01');
  assert.equal(feb.flat().filter((c) => c !== null).length, 29);
});

test('달 이동', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 5, 0), { year: 2026, month: 5 });
});

test('날짜 누르기: 출발 → 도착 → 다시 처음', () => {
  let range = pickDate({ start: null, end: null }, '2026-11-14');
  assert.deepEqual(range, { start: '2026-11-14', end: null });
  range = pickDate(range, '2026-11-15');
  assert.deepEqual(range, { start: '2026-11-14', end: '2026-11-15' });
  range = pickDate(range, '2026-11-20');
  assert.deepEqual(range, { start: '2026-11-20', end: null });
});

test('날짜 누르기: 이른 날은 새 출발일, 같은 날은 당일치기', () => {
  assert.deepEqual(pickDate({ start: '2026-11-14', end: null }, '2026-11-10'), { start: '2026-11-10', end: null });
  assert.deepEqual(pickDate({ start: '2026-11-14', end: null }, '2026-11-14'), { start: '2026-11-14', end: '2026-11-14' });
});

test('고를 수 있는 날: 오늘 이전 불가, 출발일만 있으면 7일 안쪽만', () => {
  const today = '2026-10-17';
  const none = { start: null, end: null };
  assert.equal(isSelectable(none, '2026-10-16', today), false);
  assert.equal(isSelectable(none, '2026-10-17', today), true);
  const half = { start: '2026-11-14', end: null };
  assert.equal(isSelectable(half, '2026-11-20', today), true); // 7일째
  assert.equal(isSelectable(half, '2026-11-21', today), false);
  assert.equal(isSelectable(half, '2026-11-10', today), true); // 이른 날은 새 출발일로 쓴다
  assert.equal(isSelectable({ start: '2026-11-14', end: '2026-11-15' }, '2027-03-01', today), true);
});
