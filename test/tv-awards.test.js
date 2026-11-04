import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { freshState, mutate } from '../lib/race.js';
import * as common from '../public/common.js';

async function controller() {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {textContent:'',innerHTML:'',addEventListener(){},classList:{toggle(){}}});
    return elements.get(selector);
  };
  const timers=new Map();
  const context = vm.createContext({...common,e:common.escape,$:element,document:{addEventListener(){}},connect(){},setInterval(fn,delay){timers.set(delay,fn);},console});
  const source = (await readFile(new URL('../public/tv.js', import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
  vm.runInContext(source + '\nglobalThis.inspect={allRacesComplete,speedWinners,awardPageInfo,awardsScreen,render:s=>{state=s;render();}};', context);
  return {...context.inspect, elements, tickAwards:()=>timers.get(10000)()};
}

function completedFixture(awanaCount=7,openCount=4) {
  const s = freshState();
  for (const [division,count] of [['awana',awanaCount],['open',openCount]]) {
    mutate(s,'participants',{division,entries:Array.from({length:count},(_,i)=>({name:division+i,car:String(i+(division==='awana'?1:41)),carName:'레이서 '+i}))});
    mutate(s,'start',{division});
  }
  for(const d of Object.values(s.divisions)){
    const r = common.current(d);
    Object.values(r.results).forEach((result,i)=>{result.times=[3100+i*10,3200+i*10,3300+i*10,3400+i*10];});
    r.status='completed';
  }
  s.meeting.status='completed';
  s.display.run=3;
  return s;
}

test('TV awards wait for explicit whole meeting completion and both divisions', async () => {
  const c=await controller(),s=completedFixture();
  assert.equal(c.allRacesComplete(s),true);
  s.meeting.status='active';assert.equal(c.allRacesComplete(s),false);
  s.meeting.status='completed';common.current(s.divisions.open).status='active';
  assert.equal(c.allRacesComplete(s),false);
  common.current(s.divisions.open).status='completed';
  delete s.meeting;assert.equal(c.allRacesComplete(s),false);
});

test('TV final contains only four Awana and two general speed winners, with shared third', async () => {
  const c=await controller(),s=completedFixture();
  assert.deepEqual(Array.from(c.speedWinners(s,'awana'),p=>p.rank),[1,2,3,3]);
  assert.deepEqual(Array.from(c.speedWinners(s,'open'),p=>p.rank),[1,2]);
  const html=c.awardsScreen(s);
  assert.equal((html.match(/class="award-card /g)||[]).length,6);
  assert.equal((html.match(/공동 <b>3<\/b>위/g)||[]).length,2);
  assert.doesNotMatch(html,/awana4|awana5|awana6|open2|open3/);
  assert.match(html,/스피드 수상자/);
});

test('DNF-only participants never become award winners and empty result stays honest',async()=>{
  const c=await controller(),s=completedFixture(),r=common.current(s.divisions.awana);
  Object.values(r.results).forEach(result=>{result.times=['DNF','DNF','DNF','DNF'];});
  assert.equal(c.speedWinners(s,'awana').length,0);
  assert.match(c.awardsScreen(s),/유효한 완주 기록이 없습니다/);
  assert.equal((c.awardsScreen(s).match(/class="award-card /g)||[]).length,2);
});

test('Awards escape names and retain actual equal-time shared ranks',async()=>{
  const c=await controller(),s=completedFixture(),d=s.divisions.awana,r=common.current(d);
  d.participants[0].name='<b>test</b>';d.participants[0].carName='"<script>';
  r.results[d.participants[1].id].times[0]=3100;
  const html=c.awardsScreen(s);
  assert.match(html,/&lt;b&gt;test&lt;\/b&gt;/);assert.match(html,/&quot;&lt;script&gt;/);
  assert.equal((html.match(/공동 <b>1<\/b>위/g)||[]).length,2);
});

test('Fourth round glow follows actual meeting cursor, not host preview, and stops at completion',async()=>{
  const c=await controller(),s=completedFixture();s.meeting.status='active';
  for(const d of Object.values(s.divisions))common.current(d).status='active';
  s.display.division='awana';c.render(s);
  assert.equal((c.elements.get('#leaderboard').innerHTML.match(/aria-label="현재 수상권"/g)||[]).length,0,'Viewing round four during round one must not start the effect');
  s.meeting.cursor=common.eventSchedule(s).findIndex(task=>task.run===3);c.render(s);
  assert.equal((c.elements.get('#leaderboard').innerHTML.match(/aria-label="현재 수상권"/g)||[]).length,4);
  s.display.run=2;c.render(s);
  assert.equal((c.elements.get('#leaderboard').innerHTML.match(/aria-label="현재 수상권"/g)||[]).length,4,'Viewing a past race does not change the actual final-round ranking effect');
  s.display.run=3;s.display.division='open';c.render(s);
  assert.equal((c.elements.get('#leaderboard').innerHTML.match(/aria-label="현재 수상권"/g)||[]).length,2);
  s.meeting.status='completed';c.render(s);
  assert.equal((c.elements.get('#leaderboard').innerHTML.match(/aria-label="현재 수상권"/g)||[]).length,0);
});

test('Boundary ties are all awarded, including third Awana and second general, across pages',async()=>{
  const c=await controller(),s=completedFixture();
  for(const [key,times] of [['awana',[3000,3100,3200,3300,3300,3400,3500]],['open',[3000,3100,3100,3200]]]){
    const d=s.divisions[key],r=common.current(d);
    d.participants.forEach((p,i)=>{r.results[p.id].times=[times[i],3500,3600,3700];});
  }
  assert.equal(c.speedWinners(s,'awana').length,5);
  assert.equal(c.speedWinners(s,'open').length,3);
  assert.deepEqual(Array.from(c.awardPageInfo(s,'awana',1).players,p=>p.name),['awana4']);
  assert.deepEqual(Array.from(c.awardPageInfo(s,'open',1).players,p=>p.name),['open2']);
  const second=c.awardsScreen(s,1);
  assert.match(second,/공동 <b>3<\/b>위/);assert.match(second,/공동 <b>2<\/b>위/);
  assert.match(second,/수상자 화면 2 \/ 2/);
  c.render(s);c.tickAwards();assert.equal(c.elements.get('#screen').innerHTML,second);
  c.tickAwards();assert.equal(c.elements.get('#screen').innerHTML,c.awardsScreen(s,0));
});

test('Every tied winner appears without duplicates in a page when all 55 drivers share the lead',async()=>{
  const c=await controller(),s=completedFixture(39,16);
  for(const d of Object.values(s.divisions))Object.values(common.current(d).results).forEach(result=>{result.times=[3000,3100,3200,3300];});
  for(const [key,count,capacity]of[['awana',39,4],['open',16,2]]){
    const seen=new Set(),pages=c.awardPageInfo(s,key).pages;
    assert.equal(c.speedWinners(s,key).length,count);
    for(let page=0;page<pages;page++){
      const info=c.awardPageInfo(s,key,page),ids=Array.from(info.players,p=>p.id);
      assert(ids.length<=capacity);assert.equal(new Set(ids).size,ids.length);
      ids.forEach(id=>seen.add(id));
    }
    assert.equal(seen.size,count);
    assert.deepEqual(Array.from(c.awardPageInfo(s,key,pages).players,p=>p.id),Array.from(c.awardPageInfo(s,key,0).players,p=>p.id));
  }
});
