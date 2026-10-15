import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {freshState,mutate,standings} from '../lib/race.js';
import {rows} from '../public/common.js';
import {createStore} from '../lib/store.js';

test('진행자·TV 순위와 서버 진출 순위 일치: 동점·DNF·미입력 조합',()=>{
  const state=freshState();mutate(state,'participants',{division:'awana',entries:Array.from({length:45},(_,i)=>({name:`선수${i}`}))});
  mutate(state,'start',{division:'awana'});const d=state.divisions.awana,r=d.rounds[0];
  let seed=1920;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const times=[null,'DNF',3100,3200,3300,3400];
  for(let trial=0;trial<100;trial++){
    for(const id of r.entrantIds)r.results[id]={times:[times[random(6)],times[random(6)]],tieBreak:times[random(6)],scoreMs:0};
    assert.deepEqual(rows(d).map(p=>[p.id,p.rank]),standings(d).map(p=>[p.id,p.rank]));
  }
});
test('실행 중 SQLite 백업 복사본은 원본 기록과 일치하고 무결성 검사 통과',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-backup-check-'));let store,restored;
  try{
    store=createStore(dir);store.update('participants',{revision:0,division:'awana',entries:[{name:'백업 확인',carName:'번개호'}]});
    const expected=store.read(),file=join(dir,'copy.sqlite');await backup(store.db,file);
    restored=new DatabaseSync(file);
    assert.deepEqual(JSON.parse(restored.prepare('SELECT json FROM event WHERE id=1').get().json),expected);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{restored?.close();store?.close();rmSync(dir,{recursive:true,force:true});}
});
