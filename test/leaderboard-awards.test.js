import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,mutate} from '../lib/race.js';
import {boardData,awardContenders,renderBoard} from '../public/leaderboard.js';

function fixture(){
  const state=freshState();
  for(const key of ['awana','open']){
    mutate(state,'participants',{division:key,entries:Array.from({length:8},(_,i)=>({name:`${key}선수${i+1}`,car:String(i+(key==='awana'?1:41)),carName:`자동차${i+1}`}))});
    const ids=state.divisions[key].participants.map(p=>p.id);
    mutate(state,'start',{division:key,groups:[ids.slice(0,4),ids.slice(4)]});
    const r=state.divisions[key].rounds.at(-1);
    r.entrantIds.forEach((id,i)=>r.results[id].times=[3000+i*10,3100+i*10,3200+i*10,null]);
  }
  return state;
}

test('수상권 효과는 4라운드에만 표시하고 동점이 없으면 어와나4명·일반부2명이다',()=>{
  const state=fixture();
  for(const cursor of [0,4,8]){
    state.meeting.cursor=cursor;
    for(const key of ['awana','open'])assert.equal(awardContenders(state,key,boardData(state,key).list).size,0);
    assert.doesNotMatch(renderBoard(state),/award-contender/);
  }
  state.meeting.cursor=12;
  assert.equal(awardContenders(state,'awana',boardData(state,'awana').list).size,4);
  assert.equal(awardContenders(state,'open',boardData(state,'open').list).size,2);
  // Four Awana spotlights + one general spotlight, plus six rank rows.
  assert.equal((renderBoard(state).match(/award-contender/g)||[]).length,11);
  state.meeting.status='completed';
  assert.doesNotMatch(renderBoard(state),/award-contender/);
});

test('수상 경계 동점자는 인원 제한 없이 모두 표시한다',()=>{
  const state=fixture();state.meeting.cursor=12;
  const times={awana:[3000,3100,3200,3300,3300,3400,3500,3600],open:[3000,3100,3100,3200,3300,3400,3500,3600]};
  for(const key of ['awana','open']){
    const r=state.divisions[key].rounds.at(-1);
    r.entrantIds.forEach((id,i)=>r.results[id].times=[times[key][i],times[key][i]+10,times[key][i]+20,null]);
  }
  const awana=boardData(state,'awana').list,open=boardData(state,'open').list;
  assert.deepEqual(awana.slice(0,6).map(p=>p.rank),[1,2,3,3,3,6]);
  assert.deepEqual(open.slice(0,4).map(p=>p.rank),[1,2,2,4]);
  assert.deepEqual([...awardContenders(state,'awana',awana)],awana.slice(0,5).map(p=>p.id));
  assert.deepEqual([...awardContenders(state,'open',open)],open.slice(0,3).map(p=>p.id));
  // Five spotlights and all eight co-award rank rows receive the effect.
  assert.equal((renderBoard(state).match(/award-contender/g)||[]).length,13);
  state.meeting.cursor=8;
  assert.doesNotMatch(renderBoard(state),/award-contender/);
});

test('어와나 네 명의 표시 순위는1,2,3,3이고 기록 없는 선수·DNF는 수상권에서 제외한다',()=>{
  const state=fixture();state.meeting.cursor=12;
  const {list}=boardData(state,'awana');
  assert.deepEqual(list.slice(0,5).map(p=>p.rank),[1,2,3,3,5]);
  const html=renderBoard(state,'awana');
  assert.equal((html.match(/class="spotlight /g)||[]).length,4);
  assert.match(html,/spotlight spot-3/);
  for(const d of Object.values(state.divisions)){
    const r=d.rounds.at(-1);r.entrantIds.forEach((id,i)=>r.results[id].times=i<2?[3000+i*10,null,null,null]:i<4?['DNF',null,null,null]:[null,null,null,null]);
  }
  for(const key of ['awana','open'])assert.equal(awardContenders(state,key,boardData(state,key).list).size,2);
});
