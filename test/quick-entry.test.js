import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {freshState,mutate,lanesFor} from '../lib/race.js';
import {scheduledRace} from '../public/race-format.js';
import * as common from '../public/common.js';
import {quickTime} from '../public/quick-entry.js';

test('초와 밀리초 생략 입력을 구분하고 소수점 3자리까지 정규화',()=>{
  for(const [raw,value] of [['3215','3.215'],['10250','10.250'],['3.215','3.215'],['3.21','3.210'],['3.2','3.200'],['3','3.000'],['12','12.000'],['321','0.321'],['1000','1.000'],['001','0.001'],['999999','999.999'],['dnf','DNF']])assert.equal(quickTime(raw).value,value,raw);
  for(const raw of ['', '0','000','-321','3.2178','3,21','3.','1000000','NaN'])assert.equal(quickTime(raw).ok,false,raw);
  assert.equal(quickTime('3.218','3.217').value,'3.218');
  assert.equal(quickTime('3.21','3.21').value,'3.210');
});

function fixture(cursor=0){
  const s=freshState();
  mutate(s,'participants',{division:'awana',entries:['가','나','다'].map(name=>({name}))});
  const a=s.divisions.awana.participants.map(p=>p.id);
  mutate(s,'start',{division:'awana',groups:[[a[0],null,a[1],a[2]]]});
  mutate(s,'participants',{division:'open',entries:['라','마','바','사'].map(name=>({name}))});
  mutate(s,'start',{division:'open'});
  for(let n=0;n<cursor;n++){
    const t=scheduledRace(s),r=s.divisions[t.division].rounds[0];
    mutate(s,'records',{...t,roundId:r.id,advance:true,records:Object.fromEntries(lanesFor(r,t.heat,t.run).filter(Boolean).map(id=>[id,'3.210']))});
  }
  return s;
}

// Run the real host controller and real state mutation behind a small DOM
// adapter. Input order is parsed from the rendered physical lane markup.
async function host(initial=fixture()){
  let remote=structuredClone(initial),form,activeElement,fail=false,hold,confirmation=true;
  const elements=new Map(),handlers=new Map(),requests=[],confirmations=[];
  const element=key=>{
    if(!elements.has(key))elements.set(key,{hidden:false,value:'',innerHTML:'',textContent:'',className:'',
      classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(type,fn){
        const k=key+':'+type;if(!handlers.has(k))handlers.set(k,[]);handlers.get(k).push(fn);
      }});
    return elements.get(key);
  };
  const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]??'']));
  function controlsFrom(html){
    const body=html.match(/<form id="records-form">([\s\S]*?)<\/form>/)?.[1];
    if(!body){form=null;elements.delete('#records-form');return;}
    const fields=[...body.matchAll(/<input\b[^>]*data-race-time[^>]*>/g)].map(m=>{
      const a=attributes(m[0]),input={tagName:'INPUT',id:a.id,name:a.name,value:a.value,disabled:'disabled'in a,validationMessage:'',
        dataset:{raceTime:'',original:a['data-original']},matches:q=>q==='input[data-race-time]',
        setCustomValidity(message){this.validationMessage=message;},focus(){activeElement=this;},select(){},scrollIntoView(){},
        closest:q=>q==='#records-form'||q==='form'?form:null};
      elements.set('#'+input.id,input);return input;
    });
    const buttons=[...body.matchAll(/<button\b[^>]*>/g)].map(m=>{
      const a=attributes(m[0]);return {tagName:'BUTTON',id:a.id,name:a.name,value:a.value,disabled:'disabled'in a,
        dataset:a['data-dnf']?{dnf:a['data-dnf']}:{},focus(){activeElement=this;},scrollIntoView(){},
        closest(q){return q==='button'?this:q==='#records-form'||q==='form'?form:null;}};
    });
    const reason={tagName:'INPUT',name:'reason',value:'',disabled:false,closest:q=>q==='#records-form'||q==='form'?form:null};
    form={id:'records-form',fields,buttons,reason,getAttribute:k=>k==='id'?'records-form':null,
      querySelectorAll:q=>q==='input[data-race-time]'?fields:[],
      querySelector:q=>buttons.find(b=>q.includes(`value="${b.value}"`)),
      requestSubmit(button){
        if(button.disabled||fields.some(f=>!f.value.trim()||f.validationMessage))return;
        this.submission=fire('submit',{target:this,submitter:button,preventDefault(){}});
      }};
    elements.set('#records-form',form);
  }
  const app=element('#app');let html='';
  Object.defineProperty(app,'innerHTML',{get:()=>html,set:value=>{html=value;controlsFrom(value);}});
  app.querySelectorAll=q=>q==='input, select, textarea, button'&&form?[...form.fields,form.reason,...form.buttons]:[];
  const fire=async(type,event)=>{for(const fn of handlers.get('#app:'+type)||[])await fn(event);};
  const context=vm.createContext({...common,quickTime,e:common.escape,$:element,console,setTimeout:()=>0,clearTimeout(){},
    confirm:message=>{confirmations.push(message);return confirmation;},
    document:{querySelector:element,getElementById:id=>element('#'+id)},window:{addEventListener(){}},
    FormData:class{constructor(f){this.entries=Object.fromEntries([...f.fields,f.reason].map(x=>[x.name,x.value]));}get(k){return this.entries[k]??null;}},
    api:async(name,body)=>{
      if(name==='state')return structuredClone(remote);
      if(name==='session')return {authenticated:true,passwordRequired:false};
      requests.push({name,body:structuredClone(body)});if(hold)await hold;
      if(fail)throw Object.assign(new Error('저장 실패'),{status:400});
      const next=structuredClone(remote);mutate(next,name,body);next.revision++;remote=next;return structuredClone(remote);
    },connect(){}});
  const source=(await readFile(new URL('../public/host.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
  await vm.runInContext(`(async()=>{${source}\nglobalThis.inspect=()=>({state,dirty,saving,division,heat,run});})();`,context);
  return {requests,confirmations,get form(){return form;},get active(){return activeElement;},inspect:()=>context.inspect(),
    confirm(value){confirmation=value;},fail(value){fail=value;},defer(value){hold=value;},
    async type(index,value){const input=form.fields[index];input.value=value;await fire('input',{target:input});return input;},
    async blur(index){await fire('focusout',{target:form.fields[index]});},
    async key(target,ctrlKey=false,repeat=false){
      let prevented=false;const before=form;
      await fire('keydown',{target,key:'Enter',ctrlKey,repeat,preventDefault(){prevented=true;}});
      if(before?.submission)await before.submission;
      return prevented;
    },
    async submit(advance=true){const before=form;await fire('submit',{target:before,submitter:before.buttons.find(b=>b.value===(advance?'advance':'stay')),preventDefault(){}});},
    async dnf(index){const input=form.fields[index],button=form.buttons.find(b=>b.dataset.dnf===input.name);await fire('click',{target:button});}
  };
}

test('Enter는 빈 레인을 건너뛰고 마지막에는 저장 전 확인 위치로만 이동',async()=>{
  const h=await host();assert.equal(h.form.fields.length,3);
  const first=await h.type(0,'3210');
  assert.equal(await h.key(first),true);
  assert.equal(first.value,'3.210');assert.equal(h.active,h.form.fields[1]);
  const second=await h.type(1,'10250');await h.key(second);
  assert.equal(second.value,'10.250');assert.equal(h.active,h.form.fields[2]);
  const third=await h.type(2,'3300');await h.key(third);
  assert.equal(h.active.value,'advance');assert.equal(h.requests.length,0);
});

test('Ctrl+Enter는 전원 기록을 정규화해 저장하고 다음 경기의 첫 칸으로 이동',async()=>{
  const h=await host();await h.type(0,'3210');await h.type(1,'3250');const last=await h.type(2,'3320');
  await h.key(last,true);
  assert.equal(h.requests.length,1);assert.deepEqual(Object.values(h.requests[0].body.records),['3.210','3.250','3.320']);
  assert.equal(h.inspect().state.meeting.cursor,1);assert.equal(h.inspect().division,'open');
  assert.equal(h.active,h.form.fields[0]);assert.equal(h.form.fields.length,4);
});

test('잘못된 소수 네 자리는 이동·제출을 막고 DNF 버튼은 초 입력과 함께 저장',async()=>{
  const h=await host();const first=await h.type(0,'3.2178');await h.key(first);
  assert.equal(h.requests.length,0);assert.match(first.validationMessage,/세 자리/);
  await h.key(first,true);assert.equal(h.requests.length,0);
  await h.dnf(0);assert.equal(first.value,'DNF');assert.equal(first.validationMessage,'');
  await h.type(1,'3210');const last=await h.type(2,'3220');await h.key(last,true);
  assert.deepEqual(Object.values(h.requests[0].body.records),['DNF','3.210','3.220']);
});

test('blur 정규화 후에도 값이 다시 1000분의 1로 축소되지 않음',async()=>{
  const h=await host();await h.type(0,'3210');await h.blur(0);await h.blur(0);
  assert.equal(h.form.fields[0].value,'3.210');await h.type(1,'3220');await h.type(2,'3230');await h.submit(false);
  assert.deepEqual(Object.values(h.requests[0].body.records),['3.210','3.220','3.230']);
  assert.equal(h.inspect().state.meeting.cursor,0);
});

test('저장 실패 시 입력과 경기 위치를 유지하고 저장 중 단축키 중복 제출 차단',async()=>{
  const h=await host();h.fail(true);await h.type(0,'3210');await h.type(1,'3220');const last=await h.type(2,'3230');
  let release;h.defer(new Promise(resolve=>{release=resolve;}));
  const pending=h.key(last,true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.inspect().saving,true);
  // Fire the repeated keyboard event without waiting on the first submission.
  const second=h.key(last,true,true);release();await Promise.all([pending,second]);
  assert.equal(h.requests.length,1);assert.equal(h.inspect().state.meeting.cursor,0);assert.equal(h.inspect().dirty,true);
  assert.deepEqual(h.form.fields.map(x=>x.value),['3.210','3.220','3.230']);
});

test('4라운드 부문 마지막은 종료 확인을 취소하면 저장·잠금·이동이 일어나지 않음',async()=>{
  const h=await host(fixture(6));h.confirm(false);
  for(let n=0;n<3;n++)await h.type(n,String(321+n));
  await h.key(h.form.fields[2],true);
  assert.equal(h.requests.length,0);assert.equal(h.inspect().state.meeting.cursor,6);
  assert.equal(h.inspect().state.divisions.awana.rounds[0].status,'active');assert.match(h.confirmations.at(-1),/잠깁니다/);
  h.confirm(true);await h.key(h.form.fields[2],true);
  assert.equal(h.requests.length,1);assert.equal(h.inspect().state.divisions.awana.rounds[0].status,'completed');
  assert.equal(h.inspect().state.meeting.cursor,7);assert.equal(h.active,h.form.fields[0]);
});

test('같은 조 다른 값을 수정할 때 기존 3자리 기록을 반올림하지 않고 보존',async()=>{
  const initial=fixture(),r=initial.divisions.awana.rounds[0],ids=r.groups[0].filter(Boolean);
  r.results[ids[0]].times[0]=3217;r.results[ids[1]].times[0]=3300;r.results[ids[2]].times[0]=3400;
  const h=await host(initial);assert.equal(h.form.fields[0].value,'3.217');
  await h.type(1,'3290');h.form.reason.value='측정값 재확인';await h.submit(false);
  assert.equal(h.requests[0].body.records[ids[0]],'3.217');
  assert.equal(h.inspect().state.divisions.awana.rounds[0].results[ids[0]].times[0],3217);
  assert.equal(h.inspect().state.divisions.awana.rounds[0].results[ids[1]].times[0],3290);
});
