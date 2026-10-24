import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { freshState, mutate } from './legacy-fixture.js';
import { mutate as liveMutate } from '../lib/race.js';
import * as common from '../public/common.js';

// Execute the real host controller with an isolated DOM/API adapter. No real DB.
async function host(four=false) {
  const initial = freshState(),apply=four?liveMutate:mutate;
  if(four){apply(initial,'participants',{division:'awana',entries:Array.from({length:4},(_,i)=>({name:'어와나'+i}))});apply(initial,'start',{division:'awana'});}
  apply(initial, 'participants', {division:'open',entries:Array.from({length:18},(_,i)=>({name:`선수${i+1}`}))});
  apply(initial,'start',{division:'open'});
  if(!four)initial.display={division:'open',heat:2,run:1,mode:'race'};
  const elements=new Map(), handlers={}, requests=[];
  const element=key=>{
    if(!elements.has(key))elements.set(key,{hidden:false,value:'',innerHTML:'',querySelectorAll:()=>[],classList:{add(){},remove(){}},addEventListener(type,fn){handlers[key+':'+type]=fn;}});
    return elements.get(key);
  };
  let onState, failure=true, remote=structuredClone(initial), hold;
  const context=vm.createContext({...common,e:common.escape,$:element,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    document:{querySelector:element,getElementById:id=>element('#'+id)},window:{addEventListener(){}},
    FormData:class{constructor(form){this.values=form.values;} get(key){return this.values[key]??null;}},
    api:async(name,body)=>{
      if(name==='state')return structuredClone(remote);
      if(name==='session')return {authenticated:true,passwordRequired:false};
      requests.push({name,body});
      if(hold)await hold;
      if(failure)throw Object.assign(new Error('테스트 저장 실패'),{status:400});
      apply(remote,name,body);remote.revision++;return structuredClone(remote);
    },connect:fn=>{onState=fn;}});
  const source=(await readFile(new URL('../public/host.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  await vm.runInContext(`(async()=>{${source}\nglobalThis.inspector=()=>({heat,run,history,revision,state,dirty,saving});})();`,context);
  return {context,requests,element,inspect:()=>context.inspector(),
    click:async id=>handlers['#app:click']({target:{closest:()=>({id,dataset:{}})}}),
    change:(id,value)=>handlers['#app:change']({target:{id,value}}),
    edit:()=>handlers['#app:input']({target:{closest:()=>true}}),
    submit:async (values,id='records-form',advance=false)=>handlers['#app:submit']({preventDefault(){},submitter:{value:advance?'advance':'stay'},target:{values,getAttribute:()=>id}}),
    push:s=>onState(s),remote,allow:()=>{failure=false;},defer:p=>{hold=p;}};
}
test('다음 주행 요청 실패 시 화면과 내부 조·주행이 모두 유지됨',async()=>{
  const h=await host(),before=h.inspect();
  await h.click('next');
  assert.equal(h.inspect().heat,before.heat);
  assert.equal(h.inspect().run,before.run);
});
test('라운드 종료 실패 시 선택한 조·주행 유지',async()=>{
  const h=await host(),before=h.inspect();
  await h.click('finish');
  assert.equal(h.inspect().heat,before.heat);
  assert.equal(h.inspect().run,before.run);
});
test('입력 중 다른 진행자가 라운드를 종료해도 입력 대상 라운드는 바뀌지 않음',async()=>{
  const h=await host(); h.edit();
  const before=h.inspect().state.divisions.open.rounds.at(-1),updated=structuredClone(h.remote);
  updated.divisions.open.rounds[0].entrantIds.forEach((id,i)=>updated.divisions.open.rounds[0].results[id].times=[3000+i,4000+i]);
  mutate(updated,'finish',{division:'open',roundId:before.id});updated.revision++;
  h.push(updated);
  assert.equal(h.inspect().state.divisions.open.rounds.at(-1).id,before.id);
  assert.equal(h.element('#stale').hidden,false);
  const values=Object.fromEntries(before.groups[2].map(id=>[id,'3.123']));values.reason='확인';
  await h.submit(values);
  assert.equal(h.requests.at(-1).body.roundId,before.id);
  assert.equal(h.inspect().dirty,true);
});
test('성공한 다음 주행은 선택 및 TV 표시가 함께 이동',async()=>{
  const h=await host();h.allow();await h.click('next');
  assert.equal(h.inspect().heat,3);assert.equal(h.inspect().run,0);
  assert.equal(h.inspect().state.display.heat,3);assert.equal(h.inspect().state.display.run,0);
});
test('1차에서 다음 주행 실패 후 재저장해도 2차에 기록하지 않음',async()=>{
  const h=await host(); h.change('run','0'); await h.click('next');
  const r=h.inspect().state.divisions.open.rounds.at(-1);
  const values=Object.fromEntries(r.groups[2].map(id=>[id,'3.321']));values.reason='기록 확인';
  h.edit();await h.submit(values);
  assert.equal(h.requests.at(-1).name,'records');
  assert.equal(h.requests.at(-1).body.run,0);
});
test('저장 응답 대기 중 조 변경 차단 및 중복 제출 방지',async()=>{
  const h=await host(); let release;h.defer(new Promise(resolve=>{release=resolve;}));
  const pending=h.click('next');assert.equal(h.inspect().saving,true);
  h.change('heat','4');h.change('run','0');await h.click('next');
  assert.equal(h.inspect().heat,2);assert.equal(h.inspect().run,1);assert.equal(h.requests.length,1);
  release();await pending;assert.equal(h.inspect().saving,false);
});
test('저장 중 도착한 더 최신 실시간 상태는 저장 응답 뒤에도 보존',async()=>{
  const h=await host();h.allow();let release;h.defer(new Promise(resolve=>{release=resolve;}));
  const pending=h.click('next');const latest=structuredClone(h.remote);latest.revision=2;latest.title='새 행사 이름';
  h.push(latest);release();await pending;
  assert.equal(h.inspect().state.title,'새 행사 이름');assert.equal(h.inspect().revision,2);
});
test('초기화 폼 저장 후 잘못된 조 선택 없이 참가자 등록 화면으로 복귀',async()=>{
  const h=await host();h.allow();await h.submit({confirmation:'기록 초기화'},'reset-form');
  assert.equal(h.inspect().heat,0);assert.equal(h.inspect().run,0);assert.equal(h.inspect().history,-1);
  assert.equal(h.inspect().state.divisions.open.rounds.length,0);
  assert.equal(h.inspect().state.divisions.open.participants.length,18);
  assert.match(h.element('#app').innerHTML,/participants-form/);
});


test('새 규칙 호스트: 저장 실패 시 유지, 저장 후 다음 경기 성공 시 실제 레인과 선택 함께 이동',async()=>{
  const h=await host(true),r=h.remote.divisions.awana.rounds[0];
  const values=Object.fromEntries(r.groups[0].map(id=>[id,'3.123']));
  await h.submit(values,'records-form',true);
  assert.equal(h.inspect().run,0);assert.equal(h.inspect().state.meeting.cursor,0);
  h.allow();await h.submit(values,'records-form',true);
  assert.equal(h.inspect().run,0);assert.equal(h.inspect().state.meeting.cursor,1);
  assert.equal(h.inspect().state.display.division,'open');
  assert.match(h.element('#app').innerHTML,/일반부 · 2조 · 본선 1라운드 기록/);
  const open=h.remote.divisions.open.rounds[0];
  for(const group of open.groups)await h.submit(Object.fromEntries(group.filter(Boolean).map(id=>[id,'3.250'])),'records-form',true);
  assert.equal(h.inspect().state.display.division,'awana');assert.equal(h.inspect().heat,0);assert.equal(h.inspect().run,1);
  assert.match(h.element('#app').innerHTML,/어와나 · 1조 · 본선 2라운드 기록/);
});
