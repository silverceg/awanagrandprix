import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, mutate, standings } from '../lib/race.js';
import { rows, rankedRows } from '../public/common.js';

function fixture(division, values) {
  const state = freshState();
  mutate(state, 'participants', { division, entries: values.map((_, i) => ({ name: `선수 ${i + 1}`, car: String(i + 1) })) });
  const d = state.divisions[division];
  mutate(state, 'start', { division, groups: Array.from({ length: Math.ceil(values.length / 4) }, (_, i) => d.participants.slice(i * 4, i * 4 + 4).map(p => p.id)) });
  const r = d.rounds.at(-1);
  r.entrantIds.forEach((id, i) => { r.results[id].times = [values[i], null, null, null]; });
  return { state, d, r };
}

test('어와나 본선 3·4위는 공동 3위, 5위부터 기존 순위 · 서버와 모든 화면 동일', () => {
  const { state, d, r } = fixture('awana', [3000, 3100, 3200, 3300, 3400, 'DNF', null]);
  const before = structuredClone(state);
  for (const calculate of [() => standings(d), () => rows(d), () => rankedRows(state, 'awana')]) {
    const list = calculate();
    assert.deepEqual(list.map(p => p.rank), [1, 2, 3, 3, 5, null, null]);
    assert.deepEqual(list.slice(0, 5).map(p => p.best), [3000, 3100, 3200, 3300, 3400]);
  }
  assert.deepEqual(state, before, 'Display rules must not modify stored records');
  r.results[r.entrantIds[3]].times[1] = 2900;
  assert.deepEqual(rows(d).map(p => [p.car, p.rank]), [['4', 1], ['1', 2], ['2', 3], ['3', 3], ['5', 5], ['6', null], ['7', null]]);
});

test('동일 최고 기록의 공동 순위는 보존하며 일반부 및 예전 2회 경기에는 규칙을 적용하지 않음', () => {
  const awana = fixture('awana', [3000, 3000, 3200, 3300, 3400]);
  assert.deepEqual(rows(awana.d).map(p => p.rank), [1, 1, 3, 3, 5]);
  assert.deepEqual(standings(awana.d).map(p => p.rank), [1, 1, 3, 3, 5]);
  const open = fixture('open', [3000, 3100, 3200, 3300, 3400]);
  assert.deepEqual(rows(open.d).map(p => p.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(standings(open.d).map(p => p.rank), [1, 2, 3, 4, 5]);
  delete awana.r.format;
  awana.r.entrantIds.forEach((id, i) => { awana.r.results[id].times = [3000 + i * 100, 4000]; });
  assert.deepEqual(rows(awana.d).map(p => p.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(standings(awana.d).map(p => p.rank), [1, 2, 3, 4, 5]);
});
