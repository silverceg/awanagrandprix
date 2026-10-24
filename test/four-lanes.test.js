import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freshState,mutate,lanesFor,standings,makeRound} from '../lib/race.js';
import {createStore} from '../lib/store.js';
import {validateBackup} from '../lib/restore.js';
import {lanes,rows,ranking} from '../public/common.js';
import {laneRecords,eventSchedule,scheduledRace} from '../public/race-format.js';
import {renderBoard,boardData} from '../public/leaderboard.js';

function fixture(gaps=false){
  const s=freshState();
  for(const division of ['awana','open']){
    mutate(s,'participants',{division,entries:Array.from({length:gaps?3:4},(_,i)=>({name:division+i}))});
    const ids=s.divisions[division].participants.map(p=>p.id);
    mutate(s,'start',{division,groups:gaps?[[ids[0],null,ids[1],ids[2]]]:[ids]});
  }
  return s;
}
function body(s,values,advance=true){
  const t=scheduledRace(s),r=s.divisions[t.division].rounds[0];
  return {division:t.division,roundId:r.id,heat:t.heat,run:t.run,advance,records:Object.fromEntries(lanesFor(r,t.heat,t.run).filter(Boolean).map((id,i)=>[id,values?.[i]||String(3+t.run/10)]))};
}
test('4차 순환: 모든 선수는 실제 1~4레인을 정확히 한 번씩, 빈칸도 함께 이동',()=>{
  for(const gaps of [false,true]){
    const s=fixture(gaps),r=s.divisions.awana.rounds[0];
    for(const id of r.entrantIds)assert.deepEqual([0,1,2,3].map(run=>lanesFor(r,0,run).indexOf(id)).sort(),[0,1,2,3]);
    for(const run of [0,1,2,3])assert.deepEqual(lanes(r,0,run),lanesFor(r,0,run));
    assert.throws(()=>lanesFor(r,0,4));assert.throws(()=>lanesFor(r,0,-1));
  }
});
test('새 경기 기록은 네 칸, 한 번의 기록부터 잠정 순위 / 동점은 공동 순위',()=>{
  const s=fixture(),d=s.divisions.awana,r=d.rounds[0];
  assert.equal(boardData(s).list.length,0);
  assert.equal(Object.values(r.results)[0].times.length,4);
  mutate(s,'records',body(s,['3.000','3.000','3.500','DNF'],false));
  assert.deepEqual(standings(d).map(p=>p.rank),[1,1,3,null]);
  assert.deepEqual(rows(d).map(p=>p.rank),[1,1,3,null]);
  assert.equal(boardData(s).list.length,4);
  assert.match(ranking(d,r),/4레인/);
  assert.ok(!ranking(d,r).includes('재경기'));
});
test('주행 차수와 레인 기록은 구분: 4레인 출발자는 2차에 1레인 기록',()=>{
  const s=fixture(),r=s.divisions.awana.rounds[0],id=r.groups[0][3];
  mutate(s,'records',body(s,['3.100','3.200','3.300','3.400']));
  mutate(s,'records',body(s)); // 일반부 1라운드
  mutate(s,'records',body(s,['2.900','3.000','3.100','3.200']));
  assert.deepEqual(r.results[id].times,[3400,2900,null,null]);
  assert.deepEqual(laneRecords(r,id),[2900,null,null,3400]);
  assert.equal(s.display.division,'open');
  assert.equal(boardData(s,'awana').list.length,4);
});
test('매 라운드 두 부문 순환: 조 유지, 모두 DNF도 종료 가능',()=>{
  const s=fixture(true),groups=structuredClone(s.divisions.awana.rounds[0].groups);
  const plan=eventSchedule(s);
  assert.deepEqual(plan.map(t=>t.division+':'+t.run),['awana:0','open:0','awana:1','open:1','awana:2','open:2','awana:3','open:3']);
  for(let i=0;i<plan.length;i++)mutate(s,'records',body(s,['DNF','DNF','DNF']));
  assert.equal(s.meeting.status,'completed');
  assert.deepEqual(s.divisions.awana.rounds[0].groups,groups);
  assert.equal(s.divisions.awana.rounds.length,1);
  assert.ok(standings(s.divisions.awana).every(p=>p.rank===null));
  assert.match(renderBoard(s),/combined-board/);
  assert.deepEqual(validateBackup({state:s}).divisions,s.divisions);
});
test('준비 중에는 기록 입력 차단, 경기 시작 뒤 조 변경·임의 건너뛰기 차단',()=>{
  const s=freshState();
  mutate(s,'participants',{division:'awana',entries:[{name:'하늘'}]});mutate(s,'start',{division:'awana'});
  const r=s.divisions.awana.rounds[0];
  assert.throws(()=>mutate(s,'records',{division:'awana',roundId:r.id,heat:0,run:0,records:{[r.entrantIds[0]]:'3.1'}}),/두 부문/);
  assert.throws(()=>mutate(s,'start-event',{}),/조 편성/);
  mutate(s,'participants',{division:'open',entries:[{name:'선생님'}]});mutate(s,'start',{division:'open'});
  assert.throws(()=>mutate(s,'groups',{division:'awana',roundId:r.id,groups:r.groups}),/자동 경기/);
  assert.throws(()=>mutate(s,'next-race',{division:'awana',roundId:r.id,heat:0,run:0}),/모든 기록/);
  assert.throws(()=>mutate(s,'records',{...body(s),run:2}),/앞 순서/);
});
test('새 백업은 네 기록과 진행 위치 보존, 손상된 배열·누락된 지난 기록 거절',()=>{
  const s=fixture();mutate(s,'records',body(s));mutate(s,'records',body(s));
  const restored=validateBackup({state:s});
  assert.deepEqual(restored.meeting,s.meeting);
  assert.deepEqual(restored.divisions,s.divisions);
  for(const damage of [
    x=>x.divisions.awana.rounds[0].results[x.divisions.awana.participants[0].id].times.pop(),
    x=>x.meeting.cursor=999,
    x=>x.divisions.awana.rounds[0].results[x.divisions.awana.participants[0].id].times[0]=null,
    x=>x.display.run=4
  ]){const broken=structuredClone(s);damage(broken);assert.throws(()=>validateBackup({state:broken}));}
});
test('구규칙 전환은 기록·사진 자동 백업, 명단과 최초 수동 조 유지',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-migrate-')),store=createStore(dir);
  try{
    const s=freshState();mutate(s,'participants',{division:'awana',entries:Array.from({length:16},(_,i)=>({name:'친구'+i}))});
    const d=s.divisions.awana,ids=d.participants.map(p=>p.id),r=makeRound('awana',0,ids,true);
    r.groups[0]=[ids[0],null,ids[1],ids[2]];r.groups[1]=[ids[3],ids[4],ids[5],ids[6]];r.groups[2]=[ids[7],ids[8],ids[9],ids[10]];r.groups[3]=[ids[11],ids[12],ids[13],ids[14]];r.groups[4]=[ids[15]];
    r.results[ids[0]].times=[3100,3200];d.rounds=[r];
    store.update('restore',{revision:0,confirmation:'백업 복원',backup:{state:s}});
    const player=store.read().divisions.awana.participants[0];
    store.update('participant-update',{revision:store.read().revision,division:'awana',id:player.id,name:player.name,car:player.car,photoData:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='});
    const before=store.read();
    assert.throws(()=>store.update('four-lane-reset',{revision:before.revision,confirmation:''}));
    const after=store.update('four-lane-reset',{revision:before.revision,confirmation:'4회 경기로 전환'});
    assert.deepEqual(after.divisions.awana.participants,before.divisions.awana.participants);
    assert.deepEqual(after.divisions.awana.rounds[0].groups,r.groups);
    assert.ok(Object.values(after.divisions.awana.rounds[0].results).every(rec=>rec.times.length===4&&rec.times.every(t=>t===null)));
    const backup=JSON.parse(store.resetBackup());assert.deepEqual(backup.state,before);assert.equal(Object.keys(backup.images).length,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
