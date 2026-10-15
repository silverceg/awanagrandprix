import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,mutate,standings} from '../lib/race.js';
import {rows} from '../public/common.js';
import {validateBackup} from '../lib/restore.js';
import {createStore} from '../lib/store.js';
import {renderBoard} from '../public/leaderboard.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function scenario(division,count) {
  const state=freshState();mutate(state,'participants',{division,entries:Array.from({length:count},(_,i)=>({name:'선수'+i}))});
  const d=state.divisions[division],ids=d.participants.map(p=>p.id);
  mutate(state,'start',{division,groups:Array.from({length:Math.ceil(count/4)},(_,i)=>ids.slice(i*4,i*4+4))});
  const r=d.rounds[0];
  for(const [i,id] of ids.entries())r.results[id].times=[3000+i,5000+i];
  r.results[ids[r.advance]].times=[3000+r.advance-1,6000];
  r.results[ids[r.advance-1]].tieBreak=3100;
  for(const rec of Object.values(r.results))rec.scoreMs=Math.min(...rec.times);
  const old=structuredClone(r.results);
  mutate(state,'finish',{division,roundId:r.id});
  return {state,d,r,ids,old};
}
test('어와나 공동 16위 두 명은 17명 진출·5개 조·17칸·새 기록 초기화',()=>{
  const {state,d,r,ids,old}=scenario('awana',40),next=d.rounds[1];
  assert.equal(r.advancedIds.length,17);assert.deepEqual(next.groups.map(g=>g.length),[4,4,4,4,1]);
  assert.deepEqual(next.entrantIds,ids.slice(0,17));assert.deepEqual(r.results,old);
  assert.deepEqual(standings(d,r).slice(15,17).map(p=>p.rank),[16,16]);
  assert.deepEqual(rows(d,r).slice(15,17).map(p=>p.rank),[16,16]);
  assert.equal(rows(d,next).length,17);assert.ok(rows(d,next).every(p=>p.rank===null));
  assert.match(renderBoard(state,'awana'),/전체 순위 17칸/);
  assert.match(renderBoard(state,'both'),/어와나 순위 17칸/);
  for(const rec of Object.values(next.results))assert.deepEqual(rec,{times:[null,null],scoreMs:0,tieBreak:null});
  assert.deepEqual(validateBackup({state}).divisions,state.divisions);
});
test('일반부 공동 8위는 9명, 다음 공동 4위는 5명이 결승 진출',()=>{
  const {state,d}=scenario('open',18),r=d.rounds[1];
  assert.deepEqual(r.groups.map(g=>g.length),[4,4,1]);
  r.entrantIds.forEach((id,i)=>r.results[id].times=[3000+(i===4?3:i),5000+i]);
  for(const rec of Object.values(r.results))rec.scoreMs=Math.min(...rec.times);
  mutate(state,'finish',{division:'open',roundId:r.id});
  assert.equal(d.rounds[2].entrantIds.length,5);assert.deepEqual(d.rounds[2].groups.map(g=>g.length),[4,1]);
  assert.deepEqual(validateBackup({state}).divisions,state.divisions);
});
test('확장된 진출 명단은 SQLite 재시작과 JSON 복원 후에도 유지',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-tied-advance-'));let store=createStore(dir);
  try{
    const {state}=scenario('awana',40);
    store.update('restore',{revision:0,confirmation:'백업 복원',backup:{state}});
    const saved=store.export();store.close();store=createStore(dir);
    assert.deepEqual(store.read().divisions,state.divisions);
    const broken=structuredClone(saved);broken.state.divisions.awana.rounds[1].entrantIds.pop();
    assert.throws(()=>validateBackup(broken));
    const invalid=structuredClone(saved);const r=invalid.state.divisions.awana.rounds[0];r.advancedIds[16]=r.entrantIds[20];
    assert.throws(()=>validateBackup(invalid),/동점 진출/);
    store.update('restore',{revision:store.read().revision,confirmation:'백업 복원',backup:saved});
    assert.deepEqual(store.read().divisions,state.divisions);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
