import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {freshState,mutate,lanesFor} from '../lib/race.js';
import {numberDraw} from '../public/draw-model.js';
import {eventSchedule,scheduledRace,groupNumber,laneRecords} from '../public/race-format.js';
import {validateBackup} from '../lib/restore.js';
const host=readFileSync(new URL('../public/host.js',import.meta.url),'utf8');
const panel=host.slice(host.indexOf('function numberDrawPanel('),host.indexOf('function groupGrid('));
function seed(missing=40){
 const s=freshState();
 mutate(s,'participants',{division:'awana',entries:Array.from({length:40},(_,i)=>i+1).filter(n=>n!==missing).map(n=>({car:String(n),name:'선수'+n}))});
 return s;
}
function button(s){
 const html=vm.runInNewContext(panel+';numberDrawPanel(d,null)',{d:s.divisions.awana,division:'awana',numberDraw,e:String,drawPreview:()=>''});
 return html.match(/<button id="start-number-draw"[^>]*>/)[0];
}
test('39명: 어느 번호가 빠져도 버튼 활성화, 원래 10개 조·빈 레인 유지',()=>{
 for(let missing=1;missing<=40;missing++){
  const s=seed(missing);assert.doesNotMatch(button(s),/disabled/);
  mutate(s,'start-number-draw',{division:'awana'});
  const d=s.divisions.awana,r=d.rounds[0];
  assert.equal(r.entrantIds.length,39);assert.equal(r.groups.length,10);
  assert.equal(r.groups.flat().filter(id=>id===null).length,1);
  assert.equal(r.groups[Math.floor((missing-1)/4)][(missing-1)%4],null);
  for(const player of d.participants)assert.equal(r.groups[Math.floor((Number(player.car)-1)/4)][(Number(player.car)-1)%4],player.id);
  assert.deepEqual(validateBackup({state:s}).divisions,s.divisions);
 }
});
test('39명+일반부18명: 조 추첨 시작 후 15개 조×4라운드 완주, 빈 레인은 입력 불필요',()=>{
 const s=seed(2);
 mutate(s,'participants',{division:'open',entries:Array.from({length:18},(_,i)=>({name:'일반부'+i}))});
 mutate(s,'start',{division:'open'});
 mutate(s,'start-number-draw',{division:'awana'});
 assert.equal(eventSchedule(s).length,60);assert.equal(groupNumber(s,'open',0),11);
 const visits=new Map();let count=0;
 while(s.meeting.status==='active'){
  const t=scheduledRace(s),r=s.divisions[t.division].rounds[0],lanes=lanesFor(r,t.heat,t.run);
  lanes.forEach((id,l)=>{if(id)visits.set(id,[...(visits.get(id)||[]),l]);});
  mutate(s,'records',{division:t.division,roundId:r.id,heat:t.heat,run:t.run,advance:true,records:Object.fromEntries(lanes.filter(Boolean).map(id=>[id,'3.123']))});count++;
 }
 assert.equal(count,60);assert.equal(visits.size,57);
 for(const v of visits.values())assert.deepEqual(v.sort(),[0,1,2,3]);
 for(const d of Object.values(s.divisions))for(const id of d.rounds[0].entrantIds)assert.deepEqual(laneRecords(d.rounds[0],id),[3123,3123,3123,3123]);
 assert.deepEqual(validateBackup({state:s}).meeting,s.meeting);
});
test('40명 기존 시작 유지; 38명·대기·잘못된 번호·중복 번호는 화면과 서버에서 차단',()=>{
 const full=seed(-1);assert.doesNotMatch(button(full),/disabled/);mutate(full,'start-number-draw',{division:'awana'});
 for(const alter of [
  s=>s.divisions.awana.participants.pop(),
  s=>s.divisions.awana.participants[0].drawPending=true,
  s=>s.divisions.awana.participants.push({id:'waiting',name:'대기',car:'대기',drawPending:true}),
  s=>s.divisions.awana.participants[0].car='41',
  s=>s.divisions.awana.participants[0].car='2'
 ]){
  const s=seed();alter(s);assert.match(button(s),/disabled/);
  const before=structuredClone(s);assert.throws(()=>mutate(s,'start-number-draw',{division:'awana'}),/모두 등록/);assert.deepEqual(s,before);
 }
});
