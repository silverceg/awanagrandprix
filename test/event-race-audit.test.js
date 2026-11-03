import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState, mutate, lanesFor, standings} from '../lib/race.js';
import {validateBackup} from '../lib/restore.js';
import {eventSchedule, scheduledRace, laneRecords, groupNumber} from '../public/race-format.js';
import {rows} from '../public/common.js';

function fixture(count, manualEleven = false) {
  const state = freshState();
  for (const [division, size] of [['awana', count], ['open', 18]]) {
    const numbers = Array.from({length: division === 'awana' ? 40 : size}, (_, i) => i + (division === 'awana' ? 1 : 41))
      .filter(n => count === 40 || division === 'open' || n !== 2);
    mutate(state, 'participants', {division, entries: numbers.map(car => ({car: String(car), name: `선수${car}`}))});
    if (division === 'awana' && !manualEleven) mutate(state, 'start-number-draw', {division});
    else {
      const ids = state.divisions[division].participants.map(p => p.id);
      const groups = Array.from({length: Math.ceil(ids.length / 4)}, (_, h) => ids.slice(h * 4, h * 4 + 4));
      if (division === 'awana' && manualEleven) {
        const moved = groups[0][1]; groups[0][1] = null;
        groups.push([null, null, moved, null]);
      }
      mutate(state, 'start', {division, groups});
    }
  }
  return state;
}

for (const [count, manualEleven] of [[39, false], [40, false], [40, true]]) {
  test(`${count}명 ${manualEleven ? '11개 수동 조' : '번호 추첨'}: 매 경기 백업 복원·DNF·수정 뒤 4라운드 완주`, () => {
    let state = fixture(count, manualEleven);
    const original = structuredClone(state.divisions);
    const schedule = eventSchedule(state), groupCount = schedule.length / 4;
    assert.equal(groupCount, manualEleven ? 16 : 15);
    for (let run = 0; run < 4; run++) {
      const tasks = schedule.slice(run * groupCount, (run + 1) * groupCount);
      assert.deepEqual(tasks.map(t => groupNumber(state, t.division, t.heat)), Array.from({length: groupCount}, (_, i) => i + 1));
      assert.ok(tasks.every(t => t.run === run));
    }
    const visits = new Map();
    for (let step = 0; step < schedule.length; step++) {
      const task = scheduledRace(state), d = state.divisions[task.division], r = d.rounds[0];
      assert.deepEqual(task, schedule[step]);
      const ids = lanesFor(r, task.heat, task.run);
      ids.forEach((id, lane) => { if (id) visits.set(id, [...(visits.get(id) || []), lane + 1]); });
      const records = Object.fromEntries(ids.filter(Boolean).map(id => {
        const number = Number(d.participants.find(p => p.id === id).car);
        return [id, number % 7 === task.run ? 'DNF' : (3 + (number % 5) / 10 + task.run / 100).toFixed(3)];
      }));
      const body = {division: task.division, roundId: r.id, heat: task.heat, run: task.run, records};
      // Save without moving, correct an input, then advance separately as a host can do.
      mutate(state, 'records', body);
      if (step % 5 === 0) {
        const correction = {...records, [ids.find(Boolean)]: '2.999'};
        mutate(state, 'records', {...body, records: correction, reason: '스톱워치 재확인'});
      }
      mutate(state, 'next-race', body);
      const before = structuredClone(state);
      state = validateBackup({state});
      assert.deepEqual(state.divisions, before.divisions);
      assert.deepEqual(state.meeting, before.meeting);
      for (const division of ['awana', 'open']) {
        const live = state.divisions[division];
        assert.deepEqual(rows(live).map(p => [p.id, p.rank]), standings(live).map(p => [p.id, p.rank]));
      }
    }
    assert.equal(state.meeting.status, 'completed');
    assert.equal(visits.size, count + 18);
    for (const lanes of visits.values()) assert.deepEqual(lanes.sort(), [1, 2, 3, 4]);
    for (const division of ['awana', 'open']) {
      const d = state.divisions[division], r = d.rounds[0];
      assert.deepEqual(d.participants, original[division].participants);
      assert.deepEqual(r.groups, original[division].rounds[0].groups);
      assert.equal(r.status, 'completed');
      for (const id of r.entrantIds) {
        const rec = r.results[id], valid = rec.times.filter(t => typeof t === 'number');
        assert.ok(rec.times.every(t => t !== null));
        assert.equal(rec.scoreMs, valid.length ? Math.min(...valid) : 0);
        assert.deepEqual([...laneRecords(r, id)].sort(), [...rec.times].sort());
      }
    }
  });
}
