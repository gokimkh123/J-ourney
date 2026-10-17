import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BUDGET,
  MAX_BUDGET,
  MIN_BUDGET,
  budgetFromRatio,
  budgetStep,
  ratioFromBudget,
  snapBudget,
  stepBudget,
} from './budget.ts';

test('눈금 크기', () => {
  assert.equal(budgetStep(10_000), 10_000);
  assert.equal(budgetStep(99_999), 10_000);
  assert.equal(budgetStep(100_000), 50_000);
  assert.equal(budgetStep(1_000_000), 500_000);
});

test('가장 가까운 눈금으로 맞추고 범위를 지킨다', () => {
  assert.equal(snapBudget(300_000), 300_000);
  assert.equal(snapBudget(312_345), 300_000);
  assert.equal(snapBudget(330_000), 350_000);
  assert.equal(snapBudget(0), MIN_BUDGET);
  assert.equal(snapBudget(99_000_000), MAX_BUDGET);
  assert.equal(snapBudget(Number.NaN), DEFAULT_BUDGET);
});

test('위치 ↔ 금액: 양 끝과 기본값', () => {
  assert.equal(budgetFromRatio(0), MIN_BUDGET);
  assert.equal(budgetFromRatio(1), MAX_BUDGET);
  assert.equal(budgetFromRatio(-3), MIN_BUDGET);
  assert.equal(budgetFromRatio(9), MAX_BUDGET);
  assert.equal(ratioFromBudget(MIN_BUDGET), 0);
  assert.ok(Math.abs(ratioFromBudget(MAX_BUDGET) - 1) < 1e-12);
  assert.equal(budgetFromRatio(ratioFromBudget(DEFAULT_BUDGET)), DEFAULT_BUDGET);
});

test('위치가 커질수록 금액은 줄지 않고 모두 눈금 위에 있다', () => {
  let prev = 0;
  for (let i = 0; i <= 200; i++) {
    const value = budgetFromRatio(i / 200);
    assert.ok(value >= prev, `${i}: ${value} < ${prev}`);
    assert.equal(snapBudget(value), value);
    prev = value;
  }
});

test('한 칸씩 올리고 내린다', () => {
  assert.equal(stepBudget(300_000, 1), 350_000);
  assert.equal(stepBudget(300_000, -1), 250_000);
  assert.equal(stepBudget(100_000, -1), 90_000);
  assert.equal(stepBudget(90_000, 1), 100_000);
  assert.equal(stepBudget(MAX_BUDGET, 1), MAX_BUDGET);
  assert.equal(stepBudget(MIN_BUDGET, -1), MIN_BUDGET);
  assert.equal(stepBudget(1_000_000, -1), 950_000);
});
