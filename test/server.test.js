import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { lanesFor } from '../lib/race.js';
const pin = 'test-password-9281';
test('기록 수정 사유·조 전체 원자적 저장·재경기 무효화', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awana-test-'));
  const app = createApp({ dataDir: dir, pin });
  try {
    const store = app.store;
    const act = (action, body) => store.update(action, { revision: store.read().revision, division: 'open', ...body });
    act('participants', { entries: Array.from({ length: 8 }, (_, i) => ({ name: `선수${i}` })) });
    const s = act('start', {}), r = s.divisions.open.rounds[0], ids = lanesFor(r, 0, 0).filter(Boolean);
    const records = Object.fromEntries(ids.map(id => [id, '3.200']));
    const before = store.read();
    assert.throws(() => act('records', { roundId: r.id, heat: 0, run: 0, records: { ...records, [ids.at(-1)]: '0' } }));
    assert.deepEqual(store.read(), before);
    act('records', { roundId: r.id, heat: 0, run: 0, records });
    assert.throws(() => act('records', { roundId: r.id, heat: 0, run: 0, records }), /수정 사유/);
    act('records', { roundId: r.id, heat: 0, run: 1, records });
    act('tiebreak', { roundId: r.id, id: ids[0], time: '3.100', reason: '동점 재경기' });
    const changed = act('records', { roundId: r.id, heat: 0, run: 0, records: { ...records, [ids[0]]: '3.050' }, reason: '원본 기록 재확인' });
    assert.equal(changed.divisions.open.rounds[0].results[ids[0]].scoreMs, 3050);
    assert.ok(Object.values(changed.divisions.open.rounds[0].results).every(rec => rec.tieBreak === null));
    assert.match(store.audit()[0].detail, /원본 기록 재확인/);
  } finally { app.server.close(); app.store.close(); rmSync(dir, { recursive: true, force: true }); }
});
async function start(dir) {
  const app = createApp({ dataDir: dir, pin, production: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const get = path => fetch(base + path, { headers: { cookie } });
  async function post(action, body, auth = true, headers = {}) {
    const res = await fetch(base + '/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  }
  return { app, base, get, post };
}
test('HTTP 전체 대회: 45→16→8→4 / 20→8→4, SQLite 재시작 보존', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awana-test-')); let app;
  try {
    let context = await start(dir); app = context.app;
    let s = await (await context.get('/api/state')).json();
    for (const [division, count, expected] of [['awana', 45, [45, 16, 8, 4]], ['open', 20, [20, 8, 4]]]) {
      let result = await context.post('participants', { revision: s.revision, division, entries: Array.from({ length: count }, (_, i) => ({ name: `한글선수${i + 1}` })) });
      assert.equal(result.status, 200); s = result.data;
      result = await context.post('start', { revision: s.revision, division }); assert.equal(result.status, 200); s = result.data;
      for (const size of expected) {
        const round = s.divisions[division].rounds.at(-1);
        assert.equal(round.entrantIds.length, size);
        for (let heat = 0; heat < round.groups.length; heat++) for (let run = 0; run < 2; run++) {
          const records = Object.fromEntries(lanesFor(round, heat, run).filter(Boolean).map(id => [id, ((3000 + round.entrantIds.indexOf(id) * 10 + run * 100) / 1000).toFixed(3)]));
          result = await context.post('records', { revision: s.revision, division, roundId: round.id, heat, run, records });
          assert.equal(result.status, 200, JSON.stringify(result.data)); s = result.data;
        }
        result = await context.post('finish', { revision: s.revision, division, roundId: round.id });
        assert.equal(result.status, 200, JSON.stringify(result.data)); s = result.data;
        const newest = s.divisions[division].rounds.at(-1);
        if (newest.id !== round.id) assert.ok(Object.values(newest.results).every(rec => rec.scoreMs === 0 && rec.times.every(t => t === null)));
      }
      assert.equal(s.divisions[division].rounds.at(-1).status, 'completed');
      assert.ok(s.divisions[division].rounds.at(-1).winnerId);
    }
    const csv = await (await context.get('/api/csv')).text(); assert.match(csv, /한글선수/); assert.match(csv, /준준결승/);
    const backup = await (await context.get('/api/export')).json(); assert.equal(backup.state.revision, s.revision);
    await app.close(); app = null;
    context = await start(dir); app = context.app;
    const restored = await (await context.get('/api/state')).json(); assert.deepEqual(restored, s);
    assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, s.revision);
  } finally { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('인증·충돌·오입력 롤백·실시간 관객 동기화·정적 화면', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awana-test-')); let app, reader;
  try {
    const c = await start(dir); app = c.app;
    for (const path of ['/host', '/tv', '/style.css', '/host.js', '/tv.js', '/healthz']) assert.equal((await c.get(path)).status, 200);
    assert.equal((await c.post('title', { revision: 0, title: '변조' }, false)).status, 401);
    assert.equal((await c.post('title', { revision: 0, title: '변조' }, true, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(c.base + '/api/export')).status, 401);
    assert.equal((await c.post('participants', { revision: 0, division: 'awana', entries: [{ name: '김민준', car: '1' }, { name: '김하늘', car: '1' }] })).status, 400);
    assert.equal(app.store.read().divisions.awana.participants.length, 0);
    const stream = await fetch(c.base + '/api/events'); reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: state/);
    const saved = await c.post('title', { revision: 0, title: '우리 교회 그랑프리' }); assert.equal(saved.status, 200);
    const update = new TextDecoder().decode((await reader.read()).value); assert.match(update, /우리 교회 그랑프리/);
    assert.equal((await c.post('title', { revision: 0, title: '오래된 화면' })).status, 409);
    assert.equal(app.store.read().title, '우리 교회 그랑프리');
    await reader.cancel(); reader = null;
    await c.post('logout', {});
    assert.equal((await c.post('title', { revision: 1, title: '로그아웃 후' })).status, 401);
  } finally { if (reader) await reader.cancel(); if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('자동차 이름: 기존 명단 호환, 인증, 기록 보존, 내보내기와 재시작', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awana-car-test-')); let app;
  try {
    let c = await start(dir); app = c.app;
    let result = await c.post('participants', { revision: 0, division: 'open', entries: Array.from({ length: 8 }, (_, i) => ({ name: `선수${i}`, ...(i ? {} : { carName: '번개호' }) })) });
    assert.equal(result.status, 200);
    let s = result.data; const id = s.divisions.open.participants[0].id;
    assert.equal(s.divisions.open.participants[1].carName, '');
    result = await c.post('start', { revision: s.revision, division: 'open' });
    assert.equal(result.status, 200); s = result.data;
    const roundsBefore = structuredClone(s.divisions.open.rounds);
    for (const [carName, status] of [['가'.repeat(25), 400], ['줄\n바꿈', 400], [42, 400]]) {
      assert.equal((await c.post('car-name', { revision: s.revision, division: 'open', id, carName })).status, status);
      assert.equal(app.store.read().revision, s.revision);
    }
    assert.equal((await c.post('car-name', { revision: s.revision, division: 'open', id, carName: '변조' }, false)).status, 401);
    result = await c.post('car-name', { revision: s.revision, division: 'open', id, carName: '  슈퍼 로켓  ' });
    assert.equal(result.status, 200); s = result.data;
    assert.equal(s.divisions.open.participants[0].carName, '슈퍼 로켓');
    assert.deepEqual(s.divisions.open.rounds, roundsBefore);
    assert.match(await (await c.get('/api/csv')).text(), /자동차 이름/);
    assert.match(await (await c.get('/api/csv')).text(), /슈퍼 로켓/);
    assert.equal((await (await c.get('/api/export')).json()).state.divisions.open.participants[0].carName, '슈퍼 로켓');
    await app.close(); app = null;
    c = await start(dir); app = c.app;
    assert.deepEqual(await (await c.get('/api/state')).json(), s);
    result = await c.post('car-name', { revision: s.revision, division: 'open', id, carName: '' });
    assert.equal(result.status, 200);
    assert.equal(result.data.divisions.open.participants[0].carName, '');
  } finally { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
