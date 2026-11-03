import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {freshState,mutate} from '../lib/race.js';
import * as common from '../public/common.js';
import {boardData,renderBoard} from '../public/leaderboard.js';

export function fixture(){
  const s=freshState();
  for(const division of ['awana','open']){
    mutate(s,'participants',{division,entries:['가람','나래','다온','라온'].map((name,i)=>({name:division+name,car:String(i+(division==='awana'?1:41))}))});
    mutate(s,'start',{division,groups:[s.divisions[division].participants.map(p=>p.id)]});
  }
  return s;
}
function records(s,key,matrix){
  const r=common.current(s.divisions[key]);r.entrantIds.forEach((id,i)=>r.results[id].times=matrix[i]);
}
const first=[[3000,null,null,null],[3100,null,null,null],[3200,null,null,null],[3300,null,null,null]];
const byNumber=(s,key='awana')=>common.rankedRows(s,key).sort((a,b)=>Number(a.car)-Number(b.car));
function round(s,run){s.meeting.cursor=run*2;s.display={division:'awana',heat:0,run,mode:'race'};}

test('1라운드에는 비교 화살표가 없고, 2라운드는 이전 종료 순위 대비 상승·하락·유지',()=>{
  const s=fixture();records(s,'awana',structuredClone(first));
  assert.ok(byNumber(s).every(p=>p.rankChange===null));
  assert.doesNotMatch(renderBoard(s),/rank-movement (up|down)/);
  round(s,1);const r=common.current(s.divisions.awana);r.results[r.entrantIds[2]].times[1]=2900;
  const before=structuredClone(s),list=byNumber(s);
  assert.deepEqual(list.map(p=>[p.previousRank,p.rank,p.rankChange]),[[1,2,-1],[2,3,-1],[3,1,2],[4,4,0]]);
  assert.match(common.rankMovement(list[2]),/class="rank-movement up"/);assert.match(common.rankMovement(list[2]),/▲2/);
  assert.match(common.rankMovement(list[0]),/▼1/);assert.match(common.rankMovement(list[3]),/변동 없음/);
  assert.deepEqual(s,before);
  assert.deepEqual(common.rankedRows(structuredClone(s),'awana'),common.rankedRows(s,'awana'));
});

test('비교 기준은 현재 라운드 입력 중 고정되고 다음 라운드 시작 시 갱신',()=>{
  const s=fixture();round(s,1);records(s,'awana',first.map(t=>[t[0],3400,null,null]));
  const r=common.current(s.divisions.awana);r.results[r.entrantIds[2]].times[1]=2900;
  assert.equal(byNumber(s)[2].rankChange,2);
  s.revision++;assert.equal(byNumber(s)[2].rankChange,2);
  round(s,2);assert.ok(byNumber(s).every(p=>p.rankChange===0));
  r.results[r.entrantIds[3]].times[2]=2800;
  assert.deepEqual(byNumber(s).map(p=>p.rankChange),[-1,-1,-1,3]);
  assert.equal(byNumber(s)[3].comparisonRound,2);
});

test('직전 주행 기록만이 아니라 이전까지 누적 최고 기록 순위를 비교',()=>{
  const s=fixture();round(s,2);
  records(s,'awana',[[2900,3300,null,null],[3000,2800,null,null],[3100,3050,2700,null],[3200,3400,null,null]]);
  assert.deepEqual(byNumber(s).map(p=>p.previousRank),[2,1,3,4]);
  assert.equal(byNumber(s)[2].rankChange,2);
});

test('공동 순위·DNF 후 첫 기록·빈 레인·기록 대기 처리',()=>{
  const s=fixture();round(s,1);records(s,'awana',[[3000,null,null,null],[3100,null,null,null],[3200,3000,null,null],['DNF',null,null,null]]);
  let list=byNumber(s);assert.deepEqual(list.map(p=>p.rank),[1,3,1,null]);assert.deepEqual(list.map(p=>p.rankChange),[0,-1,2,null]);
  assert.equal(common.rankMovement(list[3]),'');
  const r=common.current(s.divisions.awana);r.results[r.entrantIds[3]].times[1]=2900;
  list=byNumber(s);assert.match(common.rankMovement(list[3]),/NEW/);
  r.groups=[[r.entrantIds[0],null,r.entrantIds[1],r.entrantIds[2]],[r.entrantIds[3],null,null,null]];
  s.meeting.cursor=3;assert.equal(byNumber(s)[3].comparisonRound,1);
  r.results[r.entrantIds[0]].times[0]=null;
  assert.ok(byNumber(s).every(p=>p.rankChange===null));
});

test('두 부문 별도 비교, 최종 4라운드는 3라운드 누적 대비, 초기화하면 비교 제거',()=>{
  const s=fixture();round(s,1);
  records(s,'awana',[[3000,null,null,null],[3100,null,null,null],[3200,2900,null,null],[3300,null,null,null]]);
  records(s,'open',[[3000,null,null,null],[3100,2800,null,null],[3200,null,null,null],[3300,null,null,null]]);
  assert.deepEqual(byNumber(s,'open').map(p=>p.rankChange),[-1,1,0,0]);
  assert.equal(byNumber(s)[2].rankChange,2);
  s.meeting.status='completed';
  records(s,'awana',[[3000,3200,3300,3400],[3100,3300,3400,3500],[3200,2900,3300,3400],[3300,3400,3500,2800]]);
  const list=byNumber(s);assert.equal(list[3].rankChange,3);assert.equal(list[3].comparisonRound,3);
  mutate(s,'reset-records',{confirmation:'기록 초기화'});
  assert.deepEqual(common.rankedRows(s,'awana'),[]);assert.doesNotMatch(renderBoard(s),/rank-movement /);
});

test('지난 기록 정정·새로고침은 같은 기준으로 재계산, 기존 2회 경기에는 표시하지 않음',()=>{
  const s=fixture();round(s,1);records(s,'awana',[[3000,null,null,null],[3100,null,null,null],[3200,2900,null,null],[3300,null,null,null]]);
  const r=common.current(s.divisions.awana);r.results[r.entrantIds[0]].times[0]=2800;
  assert.equal(byNumber(s)[2].rankChange,1);
  delete r.format;r.results=Object.fromEntries(r.entrantIds.map(id=>[id,{times:[3000,3100],tieBreak:null}]));
  assert.ok(common.rankedRows(s,'awana').every(p=>!Object.hasOwn(p,'comparisonRound')));
});

test('전체·부문 고정 화면과 TV 순위표 모두 방향·변동 폭 표시',()=>{
  const s=fixture();round(s,1);records(s,'awana',[[3000,null,null,null],[3100,null,null,null],[3200,2900,null,null],[3300,null,null,null]]);
  for(const key of [undefined,'awana']){
    const html=renderBoard(s,key);assert.match(html,/▲2/);assert.match(html,/▼1/);assert.match(html,/1라운드 종료 대비/);
  }
  assert.equal(boardData(s,'awana').list.find(p=>p.car==='3').rankChange,2);
  const elements=new Map();let receive;
  const element=key=>{if(!elements.has(key))elements.set(key,{textContent:'',innerHTML:'',classList:{toggle(){}},addEventListener(){}});return elements.get(key);};
  const context=vm.createContext({...common,e:common.escape,$:element,document:{addEventListener(){}},setInterval(){},connect:fn=>{receive=fn;}});
  vm.runInContext(readFileSync(new URL('../public/tv.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,''),context);
  receive(s);assert.match(element('#leaderboard').innerHTML,/▲2/);assert.match(element('#leaderboard').innerHTML,/▼1/);
});
