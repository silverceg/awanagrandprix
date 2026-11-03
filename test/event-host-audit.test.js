import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {freshState,mutate} from '../lib/race.js';
import * as common from '../public/common.js';

function raceFixture() {
  const state=freshState();
  for(const division of ['awana','open']) {
    mutate(state,'participants',{division,entries:Array.from({length:4},(_,i)=>({name:division+i}))});
    mutate(state,'start',{division});
  }
  return state;
}

async function hostController(initial) {
  const elements=new Map(),element=key=>{
    if(!elements.has(key))elements.set(key,{hidden:false,value:'',innerHTML:'',querySelectorAll:()=>[],addEventListener(){},classList:{add(){},remove(){}}});
    return elements.get(key);
  };
  let receive,reply;
  const context=vm.createContext({...common,e:common.escape,$:element,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    document:{querySelector:element},window:{addEventListener(){}},
    api:async(name)=>{
      if(name==='state')return structuredClone(initial);
      if(name==='session')return {authenticated:true,passwordRequired:false};
      return new Promise(resolve=>{reply=resolve;});
    },connect:fn=>{receive=fn;}});
  const source=(await readFile(new URL('../public/host.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  await vm.runInContext(`(async()=>{${source}\nglobalThis.audit={save:action,inspect:()=>({division,heat,run,state,revision,saving}),select(key){division=key;render();}};})();`,context);
  return {controller:context.audit,push:next=>receive(next),finish:value=>reply(value),element};
}

test('저장 중 다른 호스트가 다음 경기로 넘기면 최신 상태와 입력창이 함께 이동',async()=>{
  const initial=raceFixture(),saved=structuredClone(initial),r=saved.divisions.awana.rounds[0];
  const body={division:'awana',roundId:r.id,heat:0,run:0,records:Object.fromEntries(r.groups[0].map(id=>[id,'3.100']))};
  mutate(saved,'records',body);saved.revision++;
  const latest=structuredClone(saved);
  mutate(latest,'next-race',body);latest.revision++;
  const host=await hostController(initial),pending=host.controller.save('records',body);
  assert.equal(host.controller.inspect().saving,true);
  host.push(latest);host.finish(saved);await pending;
  const result=host.controller.inspect();
  assert.equal(result.revision,latest.revision);
  assert.equal(result.state.meeting.cursor,1);
  assert.equal(result.division,'open');
  assert.equal(result.heat,0);assert.equal(result.run,0);
  assert.match(host.element('#app').innerHTML,/일반부 · 2조 · 본선 1라운드 기록/);
});

test('대기 중 최신 변경이 경기 이동이 아니면 보고 있던 부문을 유지',async()=>{
  const initial=raceFixture(),saved=structuredClone(initial);
  saved.revision++;saved.title='행사 이름';
  const latest=structuredClone(saved);latest.revision++;latest.title='최신 행사 이름';
  const host=await hostController(initial);host.controller.select('open');
  const pending=host.controller.save('title',{title:saved.title});
  host.push(latest);host.finish(saved);await pending;
  assert.equal(host.controller.inspect().division,'open');
  assert.equal(host.controller.inspect().state.title,'최신 행사 이름');
});

async function drawScreen(count,pending=false) {
  const state=freshState();
  mutate(state,'participants',{division:'awana',entries:Array.from({length:count},(_,i)=>({name:'선수'+i,car:String(i+1)}))});
  if(pending)state.divisions.awana.participants.at(-1).drawPending=true;
  const elements=new Map(),element=key=>{
    if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',addEventListener(){},classList:{add(){},remove(){}}});
    return elements.get(key);
  };
  const context=vm.createContext({...common,e:common.escape,$:element,console,setTimeout,clearTimeout,
    window:{matchMedia:()=>({matches:false})},document:{addEventListener(){}},connect:fn=>fn(state)});
  const source=(await readFile(new URL('../public/draw.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
  vm.runInContext(source,context);
  return element;
}

test('39명 추첨 완료: 39/39명 완료 문구, 10개 조와 빈 번호 자리 유지',async()=>{
  const element=await drawScreen(39);
  assert.equal(element('#draw-count').innerHTML,'39 <small>/ 39명</small>');
  assert.equal(element('#draw-message').textContent,'39명 모두 우리 조에 도착했어요!');
  assert.equal((element('#draw-grid').innerHTML.match(/<article class="team /g)||[]).length,10);
  assert.match(element('#draw-grid').innerHTML,/data-number="40"[^>]*>.*?친구를 기다려요/);
});

test('추첨 대기자가 있거나 아직 명단 입력 중이면 완료로 표시하지 않음',async()=>{
  const pending=await drawScreen(39,true);
  assert.equal(pending('#draw-count').innerHTML,'38 <small>/ 39명</small>');
  assert.doesNotMatch(pending('#draw-message').textContent,/모두 우리 조에 도착/);
  const partial=await drawScreen(3);
  assert.equal(partial('#draw-count').innerHTML,'3 <small>/ 40명</small>');
  assert.doesNotMatch(partial('#draw-message').textContent,/모두 우리 조에 도착/);
  const full=await drawScreen(40);
  assert.equal(full('#draw-message').textContent,'40명 모두 우리 조에 도착했어요!');
});
