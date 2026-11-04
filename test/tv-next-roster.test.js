import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {freshState,mutate} from '../lib/race.js';
import * as common from '../public/common.js';

async function controller(){
 const elements=new Map(),element=s=>{if(!elements.has(s))elements.set(s,{textContent:'',innerHTML:'',addEventListener(){},classList:{toggle(){}}});return elements.get(s);};
 const context=vm.createContext({...common,e:common.escape,$:element,document:{addEventListener(){}},connect(){},setInterval(){},console});
 const source=(await readFile(new URL('../public/tv.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
 vm.runInContext(source+'\nglobalThis.inspectNext=nextRaceInfo;globalThis.inspectTicker=tickerContent;',context);
 return {next:s=>context.inspectNext(s),ticker:(s,r)=>context.inspectTicker(s,r)};
}
function fixture(){
 const s=freshState();
 for(const [division,count]of[['awana',7],['open',4]]){
  mutate(s,'participants',{division,entries:Array.from({length:count},(_,i)=>({name:division+i,car:String(i+(division==='awana'?1:41))}))});
  const ids=s.divisions[division].participants.map(p=>p.id);
  mutate(s,'start',{division,groups:division==='awana'?[[ids[0],null,ids[1],ids[2]],ids.slice(3)]:[ids]});
 }
 return s;
}
const ids=players=>Array.from(players,p=>p.id);

test('TV next roster follows real next group and general division handoff',async()=>{
 const c=await controller(),s=fixture();
 assert.deepEqual(ids(c.next(s).players),s.divisions.awana.participants.slice(3).map(p=>p.id));
 s.meeting.cursor=1;
 const next=c.next(s);assert.equal(next.title,'다음 일반부 3조 · 본선 1라운드');
 assert.deepEqual(ids(next.players),s.divisions.open.participants.map(p=>p.id));
});

test('Round boundary uses rotated physical lanes and omits empty lane, independent of old TV selection',async()=>{
 const c=await controller(),s=fixture();s.meeting.cursor=2;
 s.display={division:'awana',heat:0,run:0,mode:'race'};
 const next=c.next(s),p=s.divisions.awana.participants;
 assert.equal(next.title,'다음 어와나 1조 · 본선 2라운드');
 assert.deepEqual(ids(next.players),[p[2].id,p[0].id,p[1].id]);
});

test('Already saved future heat is skipped as next-race would skip it',async()=>{
 const c=await controller(),s=fixture(),r=s.divisions.awana.rounds[0];
 r.groups[1].forEach(id=>{r.results[id].times[0]=3100;});
 assert.equal(c.next(s).task.division,'open');
});

test('Waiting, completed and last race never show an earlier roster',async()=>{
 const c=await controller(),s=fixture(),r=s.divisions.awana.rounds[0];
 s.meeting.cursor=11;
 assert.equal(c.next(s),null);assert.equal(c.ticker(s,r).label,'LAST RACE');
 s.meeting.status='completed';assert.equal(c.next(s),null);assert.equal(c.ticker(s,r).label,'WELL DONE!');
 delete s.meeting;assert.equal(c.next(s),null);assert.equal(c.ticker(s,r).label,'GET READY');
});

test('Next names and sticker numbers are escaped in the ticker markup',async()=>{
 const c=await controller(),s=fixture(),r=s.divisions.awana.rounds[0];
 s.divisions.awana.participants[3].name='<img src=x onerror=alert(1)>';
 s.divisions.awana.participants[3].car='"&';
 const html=c.ticker(s,r).html;
 assert.match(html,/&lt;img/);assert.match(html,/#&quot;&amp;/);assert.doesNotMatch(html,/<img/);
 assert.equal((html.match(/class="next-player"/g)||[]).length,4);
});
