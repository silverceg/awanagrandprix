import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {freshState,mutate,lanesFor,standings} from '../lib/race.js';
import {lanes,orderedGroups,numberedGroups} from '../public/common.js';
import {validateBackup} from '../lib/restore.js';
import {createStore} from '../lib/store.js';

function fixture() {
  const state=freshState();
  mutate(state,'participants',{division:'awana',entries:Array.from({length:40},(_,i)=>({name:'선수'+(i+1)}))});
  const ids=state.divisions.awana.participants.map(p=>p.id),groups=orderedGroups(ids);
  groups[0][1]=null;groups.push([null,null,ids[1],null]);
  return {state,ids,groups};
}
test('번호순 자동 편성: 문자열 사전순이 아닌 숫자순, 4명씩 배치, 원본 유지',()=>{
  const players=['10','2','21','1','9','3','12','4','11','5','8','7','6','20','19','18','17','16'].map(car=>({id:'p'+car,car}));
  const original=structuredClone(players),groups=numberedGroups(players);
  assert.deepEqual(groups.flat(),['1','2','3','4','5','6','7','8','9','10','11','12','16','17','18','19','20','21'].map(n=>'p'+n));
  assert.deepEqual(groups.map(g=>g.length),[4,4,4,4,2]);
  assert.deepEqual(players,original);
});
test('빈 2레인 위치 유지, 40명 11개 조 및 두 주행 선수 순서 고정',()=>{
  const {state,ids,groups}=fixture();
  mutate(state,'start',{division:'awana',groups});const r=state.divisions.awana.rounds[0];
  assert.equal(r.groups.length,11);assert.equal(r.entrantIds.length,40);assert.ok(!r.entrantIds.includes(null));
  for(const run of [0,1]){
    assert.deepEqual(lanesFor(r,0,run),[ids[0],null,ids[2],ids[3]]);
    assert.deepEqual(lanes(r,0,run),lanesFor(r,0,run));
    assert.deepEqual(lanesFor(r,10,run),[null,null,ids[1],null]);
  }
});
test('빈칸은 기록 대상에서 제외, 선수별 두 기록 및 진출 출전순 보존',()=>{
  const {state,ids,groups}=fixture();mutate(state,'start',{division:'awana',groups});const d=state.divisions.awana,r=d.rounds[0];
  for(let heat=0;heat<r.groups.length;heat++)for(let run=0;run<2;run++){
    mutate(state,'records',{division:'awana',roundId:r.id,heat,run,records:Object.fromEntries(lanesFor(r,heat,run).filter(Boolean).map(id=>[id,(3+ids.indexOf(id)/100+run/10).toFixed(3)]))});
  }
  assert.equal(Object.keys(r.results).length,40);assert.equal(standings(d).length,40);
  assert.deepEqual(r.results[ids[1]].times,[3010,3110]);
  const oldResults=structuredClone(r.results);
  mutate(state,'finish',{division:'awana',roundId:r.id});
  const next=d.rounds[1];assert.deepEqual(next.groups.flat(),groups.flat().filter(id=>r.advancedIds.includes(id)));
  assert.ok(next.groups.every(g=>g.length===4 && g.every(Boolean)));assert.deepEqual(r.results,oldResults);
});
test('빈 레인 허용하되 선수 누락·중복·빈 조·잘못된 빈칸 값은 거절',()=>{
  for(const change of [
    g=>g.slice(0,-1),
    g=>[...g,[null,null,null,null]],
    g=>{g[0][1]=g[1][0];return g;},
    g=>{g[0][1]='';return g;},
    g=>{g[0][1]=false;return g;}
  ]){
    const {state,groups}=fixture();assert.throws(()=>mutate(state,'start',{division:'awana',groups:change(groups)}));
    assert.equal(state.divisions.awana.rounds.length,0);
  }
});
test('빈 레인 편성 저장·SQLite 재시작·백업 복원',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-empty-lanes-'));let store=createStore(dir);
  try{
    const {state,groups}=fixture();const update=(action,body)=>store.update(action,{revision:store.read().revision,...body});
    update('restore',{confirmation:'백업 복원',backup:{state}});
    update('start',{division:'awana'});
    const r=store.read().divisions.awana.rounds[0];
    update('groups',{division:'awana',roundId:r.id,groups});
    const before=store.read();assert.deepEqual(validateBackup(store.export()).divisions,before.divisions);
    const bad=store.export();bad.state.divisions.awana.rounds[0].groups.push([null,null,null,null]);
    assert.throws(()=>update('restore',{confirmation:'백업 복원',backup:bad}));assert.deepEqual(store.read(),before);
    store.close();store=createStore(dir);assert.deepEqual(store.read(),before);
    update('reset-records',{confirmation:'기록 초기화'});update('restore',{confirmation:'백업 복원',backup:{state:before}});
    assert.deepEqual(store.read().divisions,before.divisions);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
