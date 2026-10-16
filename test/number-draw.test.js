import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {numberDraw} from '../public/draw-model.js';
import {freshState,mutate} from '../lib/race.js';
import {validateBackup} from '../lib/restore.js';
import {createStore} from '../lib/store.js';
import {createApp} from '../server.js';

test('등록 순서와 무관하게 1~4번=1조, 5~8번=2조, 37~40번=10조',()=>{
  const players=['40','5','1','8','4','37'].map(car=>({id:'p'+car,car,name:'선수'+car})),draw=numberDraw(players);
  assert.equal(draw.groups.length,10);assert.ok(draw.groups.every(g=>g.length===4));
  assert.deepEqual(draw.groups[0].map(p=>p?.car??null),['1',null,null,'4']);
  assert.deepEqual(draw.groups[1].map(p=>p?.car??null),['5',null,null,'8']);
  assert.deepEqual(draw.groups[9].map(p=>p?.car??null),['37',null,null,'40']);
  assert.equal(draw.count,6);assert.equal(draw.invalid.length,0);
});
test('잘못된 번호와 01/1 중복 자리는 경고하고 잘못된 조에 표시하지 않음',()=>{
  const players=['01','1','0','41','A1','1.5','2'].map((car,i)=>({id:'p'+i,car})),draw=numberDraw(players);
  assert.equal(draw.invalid.length,6);assert.equal(draw.count,1);assert.equal(draw.groups[0][0],null);assert.equal(draw.groups[0][1].car,'2');
});
test('40명 등록 후 번호 기준 조를 실제 예선에 적용, 일반부는 유지',()=>{
  const state=freshState();mutate(state,'participants',{division:'open',entries:[{name:'일반부'}]});
  const general=structuredClone(state.divisions.open);
  mutate(state,'participants',{division:'awana',entries:Array.from({length:40},(_,i)=>({name:'선수'+i,car:String(40-i)}))});
  const players=state.divisions.awana.participants;
  mutate(state,'start-number-draw',{division:'awana'});
  const r=state.divisions.awana.rounds[0];assert.deepEqual(r.groups.map(g=>g.map(id=>players.find(p=>p.id===id).car)),Array.from({length:10},(_,i)=>Array.from({length:4},(_,j)=>String(i*4+j+1))));
  assert.deepEqual(state.divisions.open,general);
  assert.throws(()=>mutate(state,'start-number-draw',{division:'awana'}),/이미/);
  assert.throws(()=>mutate(state,'start-number-draw',{division:'open'}),/수동/);
});
test('누락·번호 오류 때 예선 시작 차단, 공개만 할 때 경기·기록 불변',()=>{
  const state=freshState();mutate(state,'participants',{division:'awana',entries:[{name:'선수',car:'5'}]});
  const before=structuredClone(state.divisions),id=state.divisions.awana.participants[0].id;
  mutate(state,'draw-reveal',{division:'awana',id});assert.deepEqual(state.divisions,before);
  assert.equal(state.drawReveal.participantId,id);const first=state.drawReveal.eventId;
  mutate(state,'draw-reveal',{division:'awana',id});assert.notEqual(state.drawReveal.eventId,first);
  assert.throws(()=>mutate(state,'start-number-draw',{division:'awana'}),/모두 등록/);
  mutate(state,'participant-delete',{division:'awana',id});assert.equal(state.drawReveal,undefined);
});
test('번호·이름·공개 이벤트의 SQLite 재시작 및 백업 복원',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-draw-'));let store=createStore(dir);
  try{
    const act=(action,body={})=>store.update(action,{revision:store.read().revision,division:'awana',...body});
    act('participants',{entries:[{car:'5',name:'김하늘'}]});const p=store.read().divisions.awana.participants[0];
    act('draw-reveal',{id:p.id});const backup=store.export();assert.deepEqual(validateBackup(backup).drawReveal,backup.state.drawReveal);
    store.close();store=createStore(dir);assert.deepEqual(store.read(),backup.state);
    act('restore',{confirmation:'백업 복원',backup});assert.deepEqual(store.read().drawReveal,backup.state.drawReveal);
    assert.equal(numberDraw(store.read().divisions.awana.participants).groups[1][0].id,p.id);
    const bad=structuredClone(backup);bad.state.drawReveal.participantId='missing';assert.throws(()=>validateBackup(bad));
    const saved=store.read();assert.throws(()=>store.update('draw-reveal',{revision:0,division:'awana',id:p.id}),/변경/);assert.deepEqual(store.read(),saved);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('추첨 관객 경로·실시간 등록 이벤트·공개 API 인증',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-draw-http-')),app=createApp({dataDir:dir,pin:'draw-test-123',production:false});let reader;
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    for(const path of ['/draw','/draw.js','/draw.css','/draw-model.js'])assert.equal((await fetch(base+path)).status,200);
    const post=(action,body,cookie='')=>fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify({division:'awana',revision:app.store.read().revision,...body})});
    assert.equal((await post('draw-reveal',{id:'none'})).status,401);
    const login=await post('login',{pin:'draw-test-123'}),cookie=login.headers.get('set-cookie').split(';')[0];
    reader=(await fetch(base+'/api/events')).body.getReader();await reader.read();
    assert.equal((await post('participants',{entries:[{car:'5',name:'실시간선수'}]},cookie)).status,200);
    const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/실시간선수/);
    const id=app.store.read().divisions.awana.participants[0].id;
    assert.equal((await post('draw-reveal',{id},cookie)).status,200);
    assert.match(new TextDecoder().decode((await reader.read()).value),/drawReveal/);
  }finally{await reader?.cancel();await app.close();rmSync(dir,{recursive:true,force:true});}
});
