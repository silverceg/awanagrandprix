import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { lanesFor } from '../lib/race.js';
const pin = 'test-password-9281';

test('4회 기록 수정 사유·조 전체 원자적 저장·미래 경기 차단',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-four-atomic-')),app=createApp({dataDir:dir,pin});
  try{
    const store=app.store,act=(action,body)=>store.update(action,{revision:store.read().revision,...body});
    for(const division of ['awana','open']){
      act('participants',{division,entries:Array.from({length:4},(_,i)=>({name:'선수'+i}))});
      act('start',{division});
    }
    const r=store.read().divisions.awana.rounds[0],ids=lanesFor(r,0,0).filter(Boolean);
    const body={division:'awana',roundId:r.id,heat:0,run:0,records:Object.fromEntries(ids.map(id=>[id,'3.200']))};
    const before=store.read();
    assert.throws(()=>act('records',{...body,records:{...body.records,[ids.at(-1)]:'0'}}));
    assert.deepEqual(store.read(),before);
    assert.throws(()=>act('records',{...body,run:2}),/앞 순서/);
    act('records',body);
    assert.throws(()=>act('records',body),/수정 사유/);
    act('records',{...body,records:{...body.records,[ids[0]]:'3.050'},reason:'스톱워치 확인'});
    assert.equal(store.read().divisions.awana.rounds[0].results[ids[0]].scoreMs,3050);
    assert.throws(()=>act('tiebreak',{division:'awana',roundId:r.id,id:ids[0],time:'3.100',reason:'동점'}),/공동 순위/);
    const saved=store.read();
    assert.throws(()=>act('records',{...body,heat:0,run:0,advance:true,division:'open',roundId:saved.divisions.open.rounds[0].id}),/앞 순서/);
    assert.deepEqual(store.read(),saved);
    act('next-race',{division:'awana',roundId:r.id,heat:0,run:0});
    assert.equal(store.read().display.division,'open');
    assert.equal(store.read().display.run,0);
    assert.throws(()=>act('next-race',{division:'open',roundId:store.read().divisions.open.rounds[0].id,heat:0,run:0}),/모든 기록/);
  }finally{app.server.close();app.store.close();rmSync(dir,{recursive:true,force:true});}
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

test('HTTP 40명/18명 전체 60경기: 부문 자동 전환·레인 순환·재시작·CSV·최종 공동 순위',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-four-http-'));let ctx=await start(dir);
  try{
    for(const [division,count] of [['awana',40],['open',18]]){
      let revision=ctx.app.store.read().revision;
      let res=await ctx.post('participants',{revision,division,entries:Array.from({length:count},(_,i)=>({name:division+i,car:String(i+(division==='awana'?1:41))}))});
      assert.equal(res.status,200);
      const ids=res.data.divisions[division].participants.map(p=>p.id);
      res=await ctx.post('start',{revision:res.data.revision,division,groups:Array.from({length:Math.ceil(count/4)},(_,i)=>ids.slice(i*4,i*4+4))});
      assert.equal(res.status,200);
    }
    for(let step=0;step<60;step++){
      const s=ctx.app.store.read(),task=s.display,r=s.divisions[task.division].rounds[0];
      assert.equal(s.meeting.cursor,step);
      assert.equal(task.division,step%15<10?'awana':'open');
      const run=Math.floor(step/15);
      assert.equal(task.heat,step%15<10?step%15:step%15-10);
      assert.equal(task.run,run);
      const records=Object.fromEntries(lanesFor(r,task.heat,task.run).filter(Boolean).map(id=>[id,(3+task.run/10).toFixed(3)]));
      const response=await ctx.post('records',{revision:s.revision,division:task.division,roundId:r.id,heat:task.heat,run:task.run,records,advance:true});
      assert.equal(response.status,200,JSON.stringify(response.data));
      if(step===14){
        const saved=ctx.app.store.read();await ctx.app.close();ctx=await start(dir);
        assert.deepEqual(ctx.app.store.read(),saved);
        assert.ok(Object.values(saved.divisions.awana.rounds[0].results).every(rec=>rec.times[0]!==null && rec.times[1]===null && rec.times[2]===null));
      }
    }
    const done=ctx.app.store.read();
    assert.equal(done.meeting.status,'completed');assert.equal(done.meeting.cursor,60);
    for(const d of Object.values(done.divisions)){
      assert.equal(d.rounds.length,1);assert.equal(d.rounds[0].status,'completed');
      assert.ok(Object.values(d.rounds[0].results).every(rec=>rec.times.length===4 && rec.times.every(t=>t!==null)));
    }
    const csv=await (await ctx.get('/api/csv')).text();
    assert.match(csv,/3레인/);assert.match(csv,/4레인/);assert.match(csv,/3.300/);
    for(const path of ['/race-format.js','/tv','/host','/leaderboard','/draw'])assert.equal((await ctx.get(path)).status,200);
    const backup=await(await ctx.get('/api/export')).json();
    const restored=await ctx.post('restore',{revision:done.revision,confirmation:'백업 복원',backup});
    assert.equal(restored.status,200);assert.deepEqual(restored.data.divisions,done.divisions);assert.deepEqual(restored.data.meeting,done.meeting);
  }finally{await ctx.app.close();rmSync(dir,{recursive:true,force:true});}
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

test('비밀번호 미설정: 바로 접속·저장·내보내기, 교차 사이트 차단 유지', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awana-open-test-')); let app;
  try {
    app = createApp({ dataDir: dir, pin: '', production: false });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    assert.deepEqual(await (await fetch(base + '/api/session')).json(), { authenticated: true, passwordRequired: false });
    const post = (path, body, headers = {}) => fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('login', {})).status, 200);
    let res = await post('participants', { revision: 0, division: 'open', entries: [{ name: '테스트 참가자', carName: '번개호' }] });
    assert.equal(res.status, 200);
    const s = await res.json(); assert.equal(s.divisions.open.participants[0].carName, '번개호');
    assert.equal((await fetch(base + '/api/export')).status, 200);
    assert.equal((await post('title', { revision: s.revision, title: '외부 변경' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('title', { revision: 0, title: '오래된 저장' })).status, 409);
    await app.close(); app = null;
    app = createApp({ dataDir: dir, pin: '' });
    assert.deepEqual(app.store.read(), s);
    assert.throws(() => createApp({ dataDir: dir, pin: 'short' }), /8자/);
  } finally { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
