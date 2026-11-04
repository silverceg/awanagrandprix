import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {freshState,mutate,standings,lanesFor} from '../lib/race.js';
import * as common from '../public/common.js';
import {renderBoard} from '../public/leaderboard.js';

function fixture(awanaCount=4,openCount=4) {
  const s=freshState();
  for(const [division,count] of [['awana',awanaCount],['open',openCount]]) {
    const numbers=division==='awana' && count===39 ? Array.from({length:40},(_,i)=>i+1).filter(n=>n!==18) : Array.from({length:count},(_,i)=>i+(division==='awana'?1:41));
    mutate(s,'participants',{division,entries:numbers.map(n=>({name:`${division} 선수 ${n}`,car:String(n)}))});
    const players=s.divisions[division].participants;
    const groups=division==='awana' && count===39
      ? Array.from({length:10},(_,h)=>Array.from({length:4},(_,l)=>players.find(p=>Number(p.car)===h*4+l+1)?.id??null))
      : Array.from({length:Math.ceil(count/4)},(_,h)=>players.slice(h*4,h*4+4).map(p=>p.id));
    mutate(s,'start',{division,groups});
  }
  return s;
}
function tvHarness() {
  const elements=new Map();let receive;
  const element=key=>{if(!elements.has(key))elements.set(key,{textContent:'',innerHTML:'',classList:{toggle(){}},addEventListener(){}});return elements.get(key);};
  const context=vm.createContext({...common,e:common.escape,$:element,document:{addEventListener(){}},setInterval(){},connect:fn=>{receive=fn;}});
  vm.runInContext(readFileSync(new URL('../public/tv.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,''),context);
  return s=>{receive(s);return {screen:element('#screen').innerHTML,rank:element('#leaderboard').innerHTML};};
}

test('첫 주행 DNF는 TV 순위에 대기가 아닌 DNF로 표시되고 이후 유효 기록으로 갱신',()=>{
  const s=fixture(),render=tvHarness(),r=common.current(s.divisions.awana);
  const records=Object.fromEntries(r.entrantIds.map((id,i)=>[id,i===0?'DNF':String(3+i/10)]));
  mutate(s,'records',{division:'awana',roundId:r.id,heat:0,run:0,records});
  const failed=render(s).rank.match(/<article class="ranking-row[^>]* unranked"[\s\S]*?<\/article>/)?.[0];
  assert.ok(failed);assert.match(failed,/<strong>DNF<\/strong>/);assert.doesNotMatch(failed,/대기/);
  records[r.entrantIds[0]]='2.90';
  mutate(s,'records',{division:'awana',roundId:r.id,heat:0,run:0,records,reason:'기록 오입력 정정'});
  assert.match(render(s).rank,/2\.90/);assert.doesNotMatch(render(s).rank,/unranked/);
});

test('39+18명 전체 60경기: TV·전체 순위·지난 라운드 변동·레인별 기록이 서버 결과와 일치',()=>{
  const s=fixture(39,18),render=tvHarness(),history=new Map();
  let previousRanks={},activeRun=-1,steps=0;
  while(s.meeting.status==='active') {
    const task=common.scheduledRace(s),d=s.divisions[task.division],r=common.current(d);
    if(task.run!==activeRun) {
      previousRanks=Object.fromEntries(Object.entries(s.divisions).map(([key,division])=>[key,new Map(standings(division).map(p=>[p.id,p.rank]))]));
      activeRun=task.run;
    }
    const records={};
    lanesFor(r,task.heat,task.run).forEach((id,lane)=>{
      if(!id)return;
      const number=Number(d.participants.find(p=>p.id===id).car);
      const time=number===2 || (number+task.run)%9===0 ? 'DNF' : 2800+((number*7+task.run*11)%12)*30;
      records[id]=time==='DNF'?time:(time/1000).toFixed(2);
      const saved=history.get(id)||[null,null,null,null];saved[lane]=time;history.set(id,saved);
    });
    const body={division:task.division,roundId:r.id,heat:task.heat,run:task.run};
    mutate(s,'records',{...body,records});
    for(const [key,division] of Object.entries(s.divisions)) {
      const round=common.current(division),list=common.rankedRows(s,key),server=standings(division);
      assert.deepEqual(list.map(p=>[p.id,p.rank]),server.map(p=>[p.id,p.rank]));
      for(const p of list) {
        assert.deepEqual(common.laneRecords(round,p.id),history.get(p.id)||[null,null,null,null]);
        if(task.run>0) {
          const previous=previousRanks[key].get(p.id);
          assert.equal(p.previousRank,previous);
          assert.equal(p.rankChange,previous!==null&&p.rank!==null?previous-p.rank:null);
        }
      }
    }
    const board=renderBoard(s),tv=render(s);
    assert.doesNotMatch(board+tv.rank+tv.screen,/NaN|Infinity|undefined/);
    assert.equal((board.match(/class="entry(?: |")/g)||[]).length,57);
    assert.equal((tv.screen.match(/class="lane-card /g)||[]).length,4);
    mutate(s,'next-race',body);steps++;
  }
  assert.equal(steps,60);assert.equal(history.size,57);
  assert.match(renderBoard(s),/본선 최종 결과/);
  const finalTV=render(s).screen;
  assert.match(finalTV,/스피드 수상자/);
  assert.equal((finalTV.match(/class="award-card /g)||[]).length,6);
  assert.doesNotMatch(finalTV,/class="lane-card /);
  for(const key of ['awana','open'])assert.ok(common.rankedRows(s,key).every(p=>p.comparisonRound===3));
});
