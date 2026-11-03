import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDefaultHighWaterMark, setDefaultHighWaterMark} from 'node:stream';
import {createApp} from '../server.js';
import {lanesFor} from '../lib/race.js';
import {scheduledRace} from '../public/race-format.js';

test('39명+18명 큰 상태도 같은 SSE 연결에서 연속 기록 저장 3회 수신', {timeout: 15000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awana-event-stream-'));
  const previousWaterMark = getDefaultHighWaterMark(false);
  // Reproduce the 16 KiB transport buffer used on the event's Windows host.
  setDefaultHighWaterMark(false, 16384);
  let app, reader;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10000);
  try {
    app = createApp({dataDir: dir, pin: '', production: false});
    const act = (action, body) => app.store.update(action, {revision: app.store.read().revision, ...body});
    for (const [division, count] of [['awana', 39], ['open', 18]]) {
      act('participants', {division, entries: Array.from({length: count}, (_, i) => ({
        name: `대회참가선수${division === 'awana' ? '어와나' : '일반부'}${i + 1}`,
        car: String(i + (division === 'awana' ? 1 : 41)), carName: `행복한꿈을싣고달리는자동차${i + 1}`
      }))});
      act(division === 'awana' ? 'start-number-draw' : 'start', {division});
    }
    assert.ok(Buffer.byteLength(JSON.stringify(app.store.read()), 'utf8') > 16384, '정상 대회 상태가 전송 버퍼보다 커야 합니다.');
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const response = await fetch(base + '/api/events', {signal: abort.signal});
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    async function readState() {
      while (true) {
        const boundary = pending.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          if (frame.startsWith('event: state\n')) return JSON.parse(frame.slice('event: state\ndata: '.length));
          continue;
        }
        const chunk = await reader.read();
        assert.equal(chunk.done, false, '정상적인 큰 상태 전송 후에도 SSE 연결이 유지되어야 합니다.');
        pending += decoder.decode(chunk.value, {stream: true});
      }
    }
    let state = await readState();
    assert.equal(state.revision, app.store.read().revision);
    for (let step = 0; step < 3; step++) {
      const task = scheduledRace(state), round = state.divisions[task.division].rounds[0];
      const result = await fetch(base + '/api/records', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: abort.signal,
        body: JSON.stringify({revision: state.revision, division: task.division, roundId: round.id,
          heat: task.heat, run: task.run, advance: true,
          records: Object.fromEntries(lanesFor(round, task.heat, task.run).filter(Boolean).map(id => [id, '3.123']))})
      });
      const saved = await result.json();
      assert.equal(result.status, 200, JSON.stringify(saved));
      state = await readState();
      assert.deepEqual(state, saved);
      assert.equal(state.meeting.cursor, step + 1);
    }
  } finally {
    clearTimeout(timeout);
    if (reader) await reader.cancel().catch(() => {});
    abort.abort();
    if (app) await app.close();
    setDefaultHighWaterMark(false, previousWaterMark);
    rmSync(dir, {recursive: true, force: true});
  }
});
