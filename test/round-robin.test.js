import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {freshState,mutate,lanesFor} from '../lib/race.js';
import {eventSchedule,scheduledRace,groupNumber} from '../public/race-format.js';
import {renderBoard} from '../public/leaderboard.js';
import {validateBackup} from '../lib/restore.js';
import {createStore} from '../lib/store.js';
function fixture(){
 const s=freshState();
 for(const [division,count] of [['awana',40],['open',18]]){
  mutate(s,'participants',{division,entries:Array.from({length:count},(_,i)=>({name:division+i,car:String(i+(division==='awana'?1:41)),carName:'자동차'+i}))});
  const ids=s.divisions[division].participants.map(p=>p.id);
  mutate(s,'start',{division,groups:Array.from({length:Math.ceil(count/4)},(_,h)=>ids.slice(h*4,h*4+4))});
 }
 return s;
}
function record(s){const t=scheduledRace(s),r=s.divisions[t.division].rounds[0];mutate(s,'records',{division:t.division,roundId:r.id,heat:t.heat,run:t.run,advance:true,records:Object.fromEntries(lanesFor(r,t.heat,t.run).filter(Boolean).map(id=>[id,'3.100']))});}
test('40+18명: 본선 매 라운드 1~15조, 모든 레인 한 번씩, 끝까지 명단 유지',()=>{
 const s=fixture(),plan=eventSchedule(s);
 assert.equal(plan.length,60);assert.equal(s.meeting.order,'round-robin');
 for(let run=0;run<4;run++){
  const tasks=plan.slice(run*15,(run+1)*15);
  assert.deepEqual(tasks.map(t=>groupNumber(s,t.division,t.heat)),Array.from({length:15},(_,i)=>i+1));
  assert.ok(tasks.every(t=>t.run===run));
 }
 const visits=new Map();
 while(s.meeting.status==='active'){
  const t=scheduledRace(s),r=s.divisions[t.division].rounds[0];
  lanesFor(r,t.heat,t.run).forEach((id,l)=>{if(id)visits.set(id,[...(visits.get(id)||[]),l+1]);});
  record(s);
 }
 assert.equal(visits.size,58);
 for(const lanes of visits.values())assert.deepEqual(lanes.sort(),[1,2,3,4]);
 assert.deepEqual(Object.values(s.divisions).map(d=>d.rounds[0].entrantIds.length),[40,18]);
 assert.deepEqual(validateBackup({state:s}).meeting,s.meeting);
});
test('경기 전에도 40+18 빈 순위표, 일반부 큰 카드는 1위 하나, 예선·진출 문구 없음',()=>{
 const s=fixture(),html=renderBoard(s);
 assert.equal((html.match(/class="entry empty"/g)||[]).length,58);
 assert.equal((html.match(/class="spotlight /g)||[]).length,4);
 const open=html.slice(html.indexOf('data-board-division="open"'));
 assert.equal((open.match(/class="spotlight /g)||[]).length,1);
 assert.doesNotMatch(html,/예선|상위 16|준결승/);assert.doesNotMatch(html,/awana0|open0/);
 record(s);assert.match(renderBoard(s),/awana0/);assert.doesNotMatch(renderBoard(s),/open0/);
});
test('이전 2+4+2 진행 백업은 기존 커서 보존, 새 순서 전환은 기록·조·사진 보존 및 자동 백업',()=>{
 const dir=mkdtempSync(join(tmpdir(),'awana-round-order-')),store=createStore(dir);
 try{
  const s=fixture();delete s.meeting.order;
  for(let i=0;i<20;i++)record(s);
  assert.equal(scheduledRace(s).division,'open');
  assert.equal(eventSchedule(validateBackup({state:s}))[20].division,'open');
  store.update('restore',{revision:0,confirmation:'백업 복원',backup:{state:s}});
  const player=store.read().divisions.awana.participants[0];
  store.update('participant-update',{revision:store.read().revision,division:'awana',id:player.id,name:player.name,car:player.car,photoData:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='});
  const before=store.read();
  const after=store.update('round-robin-order',{revision:before.revision,confirmation:'본선 4라운드 적용'});
  assert.deepEqual(after.divisions,before.divisions);
  assert.deepEqual(scheduledRace(after),{division:'open',heat:0,run:0,phase:0});
  assert.equal(after.meeting.cursor,10);
  const backup=JSON.parse(store.resetBackup());assert.deepEqual(backup.state,before);assert.equal(Object.keys(backup.images).length,1);
  assert.deepEqual(validateBackup(store.export()).meeting,after.meeting);
  assert.throws(()=>validateBackup({state:{...after,meeting:{...after.meeting,order:'unknown'}}}));
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('순서 전환 후 이미 완료된 일반부와 뒤쪽 기록은 재입력 없이 건너뛰고 백업 복원 가능',()=>{
 const s=fixture();delete s.meeting.order;
 for(let n=0;n<40;n++)record(s); // old format: Awana first two runs + all open runs
 const before=structuredClone(s.divisions);
 mutate(s,'round-robin-order',{confirmation:'본선 4라운드 적용'});
 assert.equal(s.meeting.cursor,30);
 for(let n=0;n<20;n++){
  assert.equal(scheduledRace(s).division,'awana');record(s);
  assert.deepEqual(validateBackup({state:s}).meeting,s.meeting);
 }
 assert.equal(s.meeting.status,'completed');assert.equal(s.meeting.cursor,60);
 assert.deepEqual(s.divisions.open,before.open);
});
