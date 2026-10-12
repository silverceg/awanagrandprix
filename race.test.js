import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, mutate, currentRound, lanesFor, standings, parseTime, bestOf } from '../lib/race.js';
function fixture(count = 20, division = 'open') {
  const state = freshState();
  mutate(state, 'participants', { division, entries: Array.from({ length: count }, (_, i) => ({ name: `선수${i + 1}`, car: String(i + 1) })) });
  mutate(state, 'start', { division });
  return { state, d: state.divisions[division], division };
}
function fill(f, times = i => [(3000 + i), (5000 + i)]) {
  const r = currentRound(f.d);
  r.entrantIds.forEach((id, i) => { r.results[id].times = times(i); });
  return r;
}
test('최고 기록 한 번으로 순위 결정 (평균과 반대인 사례)', () => {
  const f = fixture(), r = fill(f);
  r.results[r.entrantIds[0]].times = [2000, 9000];
  r.results[r.entrantIds[1]].times = [2100, 2200];
  assert.equal(standings(f.d)[0].id, r.entrantIds[0]);
  assert.equal(standings(f.d)[0].best, 2000);
  assert.equal(bestOf(['DNF', 2500]), 2500);
  assert.equal(bestOf(['DNF', 'DNF']), Infinity);
  assert.equal(bestOf([2000, null]), null);
});
test('40~45명 및 18~20명 편성: 중복 없이 3~4명, 2회 다른 레인', () => {
  for (const count of [40, 41, 42, 43, 44, 45, 18, 19, 20]) {
    const f = fixture(count, count > 20 ? 'awana' : 'open'), r = currentRound(f.d);
    assert.equal(new Set(r.groups.flat()).size, count);
    assert.ok(r.groups.every(g => g.length >= 3 && g.length <= 4));
    r.groups.forEach((group, h) => group.forEach(id => {
      const lane1 = lanesFor(r, h, 0).indexOf(id), lane2 = lanesFor(r, h, 1).indexOf(id);
      assert.equal(lane2, (lane1 + 2) % 4);
    }));
  }
});
test('진출과 새 점수 0 초기화, 이전 라운드 기록 유지, 종료 중복 방지', () => {
  const f = fixture(45, 'awana'), r = fill(f), before = structuredClone(r.results);
  mutate(f.state, 'finish', { division: f.division, roundId: r.id });
  assert.equal(currentRound(f.d).entrantIds.length, 16);
  assert.deepEqual(r.results, before);
  for (const rec of Object.values(currentRound(f.d).results)) assert.deepEqual(rec, { times: [null, null], scoreMs: 0, tieBreak: null });
  assert.throws(() => mutate(f.state, 'finish', { division: f.division, roundId: r.id }));
  assert.throws(() => mutate(f.state, 'records', { division: f.division, roundId: r.id, heat: 0, run: 0, records: {} }));
});
test('최고 기록이 같은 진출선 동점은 다른 주행 기록으로 가르지 않음', () => {
  const f = fixture(), r = fill(f);
  const ids = r.entrantIds;
  r.results[ids[7]].times = [4000, 8000];
  r.results[ids[8]].times = [4000, 4500];
  for (let i = 9; i < ids.length; i++) r.results[ids[i]].times = [5000 + i, 6000 + i];
  const finish = () => mutate(f.state, 'finish', { division: 'open', roundId: r.id });
  assert.throws(finish, /진출선 동점/);
  mutate(f.state, 'tiebreak', { division: 'open', roundId: r.id, id: ids[7], time: '3.1', reason: '동점 재경기' });
  assert.throws(finish, /진출선 동점/);
  mutate(f.state, 'tiebreak', { division: 'open', roundId: r.id, id: ids[8], time: '3.2', reason: '동점 재경기' });
  finish();
  assert.ok(r.advancedIds.includes(ids[7]));
  assert.ok(!r.advancedIds.includes(ids[8]));
});
test('미입력·유효 참가자 부족·잘못된 기록 차단', () => {
  const f = fixture(), r = currentRound(f.d);
  assert.throws(() => mutate(f.state, 'finish', { division: 'open', roundId: r.id }), /모든 참가자/);
  fill(f, () => ['DNF', 'DNF']);
  assert.throws(() => mutate(f.state, 'finish', { division: 'open', roundId: r.id }), /미만/);
  for (const t of ['', '0', '-2', 'NaN', 'Infinity', '2.1234', '1e3', '1000', 3.2]) assert.throws(() => parseTime(t));
  assert.equal(parseTime('3.001'), 3001);
  assert.equal(parseTime('DNF'), 'DNF');
});
test('재경기도 동점이면 결승 확정 차단', () => {
  const f = fixture(8), a = fill(f);
  mutate(f.state, 'finish', { division: 'open', roundId: a.id });
  const b = fill(f); mutate(f.state, 'finish', { division: 'open', roundId: b.id });
  const final = fill(f, () => [3000, 4000]);
  assert.throws(() => mutate(f.state, 'finish', { division: 'open', roundId: final.id }), /결승 동점/);
  final.entrantIds.forEach((id, i) => mutate(f.state, 'tiebreak', { division: 'open', roundId: final.id, id, time: (3 + i / 10).toFixed(3), reason: '결승 재경기' }));
  mutate(f.state, 'finish', { division: 'open', roundId: final.id });
  assert.equal(final.winnerId, final.entrantIds[0]);
});

test('어와나 45명과 일반부 18명 교차 진행: 다음 라운드 참가자·조 자동 편성', () => {
  const state = freshState();
  for (const [division, count] of [['awana', 45], ['open', 18]]) {
    mutate(state, 'participants', { division, entries: Array.from({length: count}, (_, i) => ({name: `선수${i + 1}`, car: String(i + 1)})) });
  }
  mutate(state, 'start', {division: 'awana'});
  assert.equal(currentRound(state.divisions.awana).groups.length, 12);
  const schedule = [['awana',16,4], ['open',8,2], ['awana',8,2], ['open',4,1], ['awana',4,1], ['open',0,1], ['awana',0,1]];
  for (const [division, nextCount, groupCount] of schedule) {
    const d = state.divisions[division], other = state.divisions[division === 'awana' ? 'open' : 'awana'];
    const untouched = structuredClone(other);
    if (!currentRound(d)) mutate(state, 'start', {division});
    const r = currentRound(d);
    if (division === 'open' && r.index === 0) assert.equal(r.groups.length, 5);
    mutate(state, 'display', {division, heat: 0, run: 0, mode: 'race'});
    assert.equal(state.display.division, division);
    for (let heat = 0; heat < r.groups.length; heat++) for (let run = 0; run < 2; run++) {
      const records = Object.fromEntries(lanesFor(r, heat, run).filter(Boolean).map(id => [id, ((3000 + r.entrantIds.indexOf(id) * 10 + run * 100) / 1000).toFixed(3)]));
      mutate(state, 'records', {division, roundId: r.id, heat, run, records});
    }
    const previous = structuredClone(r.results), expected = standings(d).slice(0,nextCount).map(p => p.id);
    mutate(state, 'finish', {division, roundId: r.id});
    assert.deepEqual(r.results, previous);
    assert.deepEqual(other, untouched);
    assert.equal(r.status, 'completed');
    const next = currentRound(d);
    assert.equal(next.groups.length, groupCount);
    if (nextCount) {
      const appearanceOrder = r.groups.flat().filter(id => expected.includes(id));
      assert.deepEqual(next.entrantIds, appearanceOrder);
      assert.deepEqual(new Set(next.groups.flat()), new Set(expected));
      assert.ok(next.groups.every(g => g.length === 4));
      for (const rec of Object.values(next.results)) assert.deepEqual(rec, {times: [null,null], scoreMs: 0, tieBreak: null});
      assert.deepEqual(next.groups, Array.from({length: groupCount}, (_,i) => appearanceOrder.slice(i*4,i*4+4)));
    } else assert.equal(next.winnerId, next.entrantIds[0]);
  }
});
