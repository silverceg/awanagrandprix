import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { freshState, mutate, parseTime, formatTime, standings } from '../lib/race.js';
import { validateBackup } from '../lib/restore.js';
import * as common from '../public/common.js';
import { renderBoard } from '../public/leaderboard.js';

function fixture() {
  const state=freshState();
  for (const division of ['awana','open']) {
    mutate(state,'participants',{division,entries:Array.from({length:4},(_,i)=>({name:`${division} 선수${i+1}`,car:String(i+1)}))});
    const ids=state.divisions[division].participants.map(p=>p.id);
    mutate(state,'start',{division,groups:[ids]});
  }
  return state;
}
function body(state, values) {
  const r=state.divisions.awana.rounds[0];
  return {division:'awana',roundId:r.id,heat:0,run:0,records:Object.fromEntries(r.groups[0].map((id,i)=>[id,values[i]]))};
}
function tv(state) {
  const elements=new Map(); let receive;
  const element=key=>{if(!elements.has(key))elements.set(key,{textContent:'',innerHTML:'',classList:{toggle(){}},addEventListener(){}});return elements.get(key);};
  const context=vm.createContext({...common,e:common.escape,$:element,document:{addEventListener(){}},setInterval(){},connect:fn=>{receive=fn;}});
  vm.runInContext(readFileSync(new URL('../public/tv.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,''),context);
  receive(state);
  return element('#screen').innerHTML+element('#leaderboard').innerHTML;
}

test('stopwatch input accepts milliseconds and preserves exact integer storage',()=>{
  for (const [input,expected] of [['3.215',3215],['3.21',3210],['3.2',3200],['3',3000],['0.001',1],['999.999',999999],[' 3.215 ',3215],['DNF','DNF']]) assert.equal(parseTime(input),expected);
  for (const input of ['3.2111','0','0.000','1000','3.2.1','3e0','NaN','Infinity',3.21]) assert.throws(()=>parseTime(input));
});
test('new and corrected three-decimal records no longer need a legacy exception',()=>{
  assert.equal(parseTime('3.217',null),3217);assert.equal(parseTime('3.218',3217),3218);
});
test('client and CSV always show three decimals without changing old records',()=>{
  for(const [value,expected] of [[3210,'3.210'],[3000,'3.000'],[10,'0.010'],[1,'0.001'],[3217,'3.217'],['DNF','DNF'],[null,'—']]){
    assert.equal(common.fmt(value),expected);assert.equal(formatTime(value),expected);
  }
});
test('millisecond differences rank correctly and survive backup restore',()=>{
  const state=fixture(),r=state.divisions.awana.rounds[0],ids=r.groups[0];
  mutate(state,'records',body(state,['3.217','3.218','3.210','DNF']));
  assert.deepEqual(ids.map(id=>r.results[id].times[0]),[3217,3218,3210,'DNF']);
  assert.deepEqual(standings(state.divisions.awana).map(p=>[p.id,p.rank]),[[ids[2],1],[ids[0],2],[ids[1],3],[ids[3],null]]);
  assert.deepEqual(validateBackup({state}).divisions,state.divisions);
  mutate(state,'records',{...body(state,['3.219','3.218','3.210','DNF']),reason:'트랙 기록 확인'});
  assert.equal(standings(state.divisions.awana)[1].id,ids[1]);
});
test('fourth decimal in a later lane rolls back the entire heat',()=>{
  const state=fixture(),r=state.divisions.awana.rounds[0],before=structuredClone(r.results);
  assert.throws(()=>mutate(state,'records',body(state,['3.215','3.221','3.1234','DNF'])),/3자리/);
  assert.deepEqual(r.results,before);
});
test('TV and full leaderboard show all milliseconds and DNF',()=>{
  const state=fixture();mutate(state,'records',body(state,['3.210','3.217','3.220','DNF']));
  for(const output of [tv(state),renderBoard(state)]){
    assert.match(output,/>3\.210</);assert.match(output,/>3\.217</);assert.match(output,/>3\.220</);assert.match(output,/DNF/);
  }
});
