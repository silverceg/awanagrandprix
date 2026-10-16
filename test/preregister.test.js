import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.js';
import {numberDraw} from '../public/draw-model.js';
import {validateBackup} from '../lib/restore.js';

function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'awana-preregister-'));const store=createStore(dir);const act=(action,body={})=>store.update(action,{revision:store.read().revision,division:'awana',...body});try{fn(store,act);}finally{store.close();rmSync(dir,{recursive:true,force:true});}}
test('사전 등록은 번호 없이 보관하고 번호 배정 전에는 관객 조에서 제외',()=>fixture((store,act)=>{
  act('participants',{prepareDraw:true,entries:[{name:'하늘',car:'3',carName:'번개호'},{name:'바다',car:'3'}]});
  let d=store.read().divisions.awana,draw=numberDraw(d.participants);assert.equal(draw.count,0);assert.equal(draw.pending.length,2);assert.equal(draw.invalid.length,0);
  const p=d.participants[0];
  act('participant-update',{id:p.id,name:p.name,car:'',carName:'새 번개호',photoData:'data:image/jpeg;base64,/9j/2Q==',carPhotoData:'data:image/jpeg;base64,/9j/2Q=='});
  const saved=store.read().divisions.awana.participants[0];
  act('assign-draw-number',{id:p.id,number:'05'});d=store.read().divisions.awana;
  assert.equal(numberDraw(d.participants).groups[1][0].id,p.id);assert.equal(d.participants[0].car,'5');assert.equal(d.participants[0].carName,'새 번개호');assert.equal(d.participants[0].photoUrl,saved.photoUrl);assert.equal(d.participants[0].carPhotoUrl,saved.carPhotoUrl);assert.equal(store.read().drawReveal.participantId,p.id);
  assert.equal(numberDraw(d.participants).pending.length,1);
}));
test('중복·범위 밖 번호 배정은 상태와 공개 이벤트를 바꾸지 않음',()=>fixture((store,act)=>{
  act('participants',{prepareDraw:true,entries:[{name:'첫째'},{name:'둘째'}]});const [a,b]=store.read().divisions.awana.participants;
  act('assign-draw-number',{id:a.id,number:'5'});const before=store.read();
  for(const number of ['05','0','41','1.5','A5']){assert.throws(()=>act('assign-draw-number',{id:b.id,number}));assert.deepEqual(store.read(),before);}
  assert.throws(()=>act('assign-draw-number',{division:'open',id:b.id,number:'6'}));
}));
test('기존 명단 추첨 준비는 이름과 사진 유지, 기존 공개 제거, 백업 복원 가능',()=>fixture((store,act)=>{
  act('participants',{entries:[{name:'하늘',car:'1',carName:'노란차'}]});const p=store.read().divisions.awana.participants[0];
  act('draw-reveal',{id:p.id});assert.throws(()=>act('prepare-number-draw'));
  act('prepare-number-draw',{confirmation:'번호 추첨 준비'});
  assert.equal(store.read().drawReveal,undefined);assert.equal(store.read().divisions.awana.participants[0].name,p.name);
  const backup=store.export();assert.equal(validateBackup(backup).divisions.awana.participants[0].drawPending,true);
  act('assign-draw-number',{id:p.id,number:'40'});act('restore',{backup,confirmation:'백업 복원'});
  assert.equal(numberDraw(store.read().divisions.awana.participants).count,0);
}));
test('40명 모두 번호 배정 후 정확한 조로 시작하고 경기 중 추첨 초기화 금지',()=>fixture((store,act)=>{
  act('participants',{prepareDraw:true,entries:Array.from({length:40},(_,i)=>({name:'선수'+i}))});
  assert.throws(()=>act('start'),/대기/);assert.throws(()=>act('start-number-draw'));
  const players=store.read().divisions.awana.participants;
  for(const [i,p] of players.entries())act('assign-draw-number',{id:p.id,number:String(40-i)});
  act('start-number-draw');const s=store.read(),d=s.divisions.awana;
  assert.deepEqual(d.rounds[0].groups[0].map(id=>d.participants.find(p=>p.id===id).car),['1','2','3','4']);
  assert.throws(()=>act('prepare-number-draw',{confirmation:'번호 추첨 준비'}));assert.throws(()=>act('assign-draw-number',{id:players[0].id,number:'1'}));assert.deepEqual(store.read(),s);
}));
test('일반부 사전 등록 플래그가 있어도 기존 41번 자동 번호 유지',()=>fixture((store,act)=>{
  act('participants',{division:'open',prepareDraw:true,entries:[{name:'일반선수'}]});const p=store.read().divisions.open.participants[0];assert.equal(p.car,'41');assert.equal(p.drawPending,undefined);
}));
