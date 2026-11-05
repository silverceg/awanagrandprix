import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freshState,mutate,lanesFor} from '../lib/race.js';
import {scheduledRace} from '../public/race-format.js';
import * as common from '../public/common.js';
import {quickTime} from '../public/quick-entry.js';
import {createApp} from '../server.js';

function fixture(cursor=0){
  const s=freshState();
  mutate(s,'participants',{division:'awana',entries:['가','나','다'].map(name=>({name}))});
  const a=s.divisions.awana.participants.map(p=>p.id);
  mutate(s,'start',{division:'awana',groups:[[a[0],null,a[1],a[2]]]});
  mutate(s,'participants',{division:'open',entries:['라','마','바','사'].map(name=>({name}))});
  mutate(s,'start',{division:'open'});
  for(let n=0;n<cursor;n++){
    const t=scheduledRace(s),r=s.divisions[t.division].rounds[0];
    mutate(s,'records',{...t,roundId:r.id,advance:true,records:Object.fromEntries(lanesFor(r,t.heat,t.run).filter(Boolean).map(id=>[id,'3.21']))});
  }
  return s;
}

// Execute the actual browser controller against the real race mutation model.
// The tiny DOM adapter preserves the physical lane order in generated markup.
async function recorder(initial=fixture(),authenticated=true){
  let remote=structuredClone(initial),form=null,activeElement,failedStatus=0,hold=null,confirmation=true,stream;
  const elements=new Map(),handlers=new Map(),requests=[],confirmations=[];
  const element=key=>{
    if(!elements.has(key))elements.set(key,{id:key.slice(1),hidden:false,value:'',textContent:'',className:'',disabled:false,
      classList:{add(){},remove(){}},focus(){activeElement=this;},select(){},scrollIntoView(){},
      addEventListener(type,fn){const k=key+':'+type;if(!handlers.has(k))handlers.set(k,[]);handlers.get(k).push(fn);}});
    return elements.get(key);
  };
  const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]??'']));
  function controls(html){
    const body=html.match(/<form id="records-form">([\s\S]*?)<\/form>/)?.[1];
    if(!body){form=null;elements.delete('#records-form');return;}
    const inputs=[...body.matchAll(/<input\b[^>]*data-race-time[^>]*>/g)].map(m=>{
      const a=attrs(m[0]),input={...element('#'+a.id),tagName:'INPUT',id:a.id,name:a.name,value:a.value,validationMessage:'',dataset:{original:a['data-original']},
        matches:q=>q==='input[data-race-time]',setCustomValidity(message){this.validationMessage=message;},
        closest:q=>q==='#records-form'?form:null};
      elements.set('#'+a.id,input);element('#preview-'+a.name);return input;
    });
    const buttons=[...body.matchAll(/<button\b[^>]*>/g)].map((m,i)=>{
      const a=attrs(m[0]),button={...element('#'+(a.id||'dnf-'+i)),tagName:'BUTTON',id:a.id,name:a.name,value:a.value,disabled:false,
        dataset:a['data-dnf']?{dnf:a['data-dnf']}:{},
        closest(q){return q==='button[data-dnf]'?(this.dataset.dnf?this:null):q==='#records-form'?form:null;}};
      if(a.id)elements.set('#'+a.id,button);return button;
    });
    const reason={...element('#reason'),tagName:'INPUT',value:'',required:false,matches:()=>false,closest:q=>q==='#records-form'?form:null};
    elements.set('#reason',reason);
    form={id:'records-form',inputs,buttons,reason,requestSubmit(button){
      if(button.disabled||inputs.some(f=>!f.value.trim()||f.validationMessage)||reason.required&&!reason.value.trim())return;
      this.submission=fire('#recorder','submit',{target:this,submitter:button,preventDefault(){}});
    }};
    elements.set('#records-form',form);
  }
  const app=element('#recorder');let html='';
  Object.defineProperty(app,'innerHTML',{get:()=>html,set:value=>{html=value;controls(value);}});
  app.querySelectorAll=q=>q==='input[data-race-time]'?(form?.inputs||[]):q==='input, button'&&form?[...form.inputs,form.reason,...form.buttons]:[];
  async function fire(key,type,event){for(const fn of handlers.get(key+':'+type)||[])await fn(event);}
  const document={get activeElement(){return activeElement;},getElementById:id=>elements.get('#'+id)||null};
  const context=vm.createContext({...common,quickTime,e:common.escape,$:element,console,document,window:{addEventListener(){}},
    confirm:message=>{confirmations.push(message);return confirmation;},
    api:async(name,body)=>{
      if(name==='session')return {authenticated,passwordRequired:!authenticated};
      if(name==='state')return structuredClone(remote);
      requests.push({name,body:structuredClone(body)});
      if(name==='login'){authenticated=true;return {ok:true};}
      if(hold)await hold;
      if(failedStatus)throw Object.assign(new Error('저장 실패'),{status:failedStatus});
      if(body.revision!==remote.revision)throw Object.assign(new Error('다른 창에서 변경됨'),{status:409});
      const next=structuredClone(remote);mutate(next,name,body);next.revision++;remote=next;return structuredClone(remote);
    },connect(callback){stream=callback;}});
  const source=(await readFile(new URL('../public/recorder.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
  await vm.runInContext(`(async()=>{${source}\nglobalThis.inspect=()=>({state,dirty,saving,pendingState,loggedIn});})();`,context);
  return {requests,confirmations,element,get form(){return form;},get active(){return activeElement;},get html(){return html;},
    inspect:()=>context.inspect(),get remote(){return structuredClone(remote);},confirm(value){confirmation=value;},fail(value){failedStatus=value;},defer(value){hold=value;},
    async type(index,value){const input=form.inputs[index];input.value=value;await fire('#recorder','input',{target:input});return input;},
    async fill(value='321'){for(let i=0;i<form.inputs.length;i++)await this.type(i,value);},
    async key(target,ctrlKey=false,repeat=false){
      let prevented=false;const before=form;
      await fire('#recorder','keydown',{target,key:'Enter',ctrlKey,repeat,preventDefault(){prevented=true;}});
      if(!prevented&&target.tagName==='BUTTON'&&target.name==='move')before.requestSubmit(target);
      if(before?.submission)await before.submission;return prevented;
    },
    async submit(advance=true){const before=form;return fire('#recorder','submit',{target:before,submitter:before.buttons.find(b=>b.value===(advance?'advance':'stay')),preventDefault(){}});},
    async dnf(index){return fire('#recorder','click',{target:form.buttons.find(b=>b.dataset.dnf===form.inputs[index].name)});},
    push(next){remote=structuredClone(next);stream(next);},
    async refresh(){return fire('#refresh','click',{});},
    async login(){return fire('#login-form','submit',{preventDefault(){}});}
  };
}

test('기록관: 빈 레인을 건너뛰고 마지막 Enter는 TV에 기록 표시, 다음 Enter만 경기 이동',async()=>{
  const h=await recorder();assert.equal(h.form.inputs.length,3);assert.match(h.html,/빈 레인/);
  const first=await h.type(0,'321');await h.key(first);assert.equal(first.value,'3.21');assert.equal(h.active,h.form.inputs[1]);
  await h.type(1,'322');await h.key(h.form.inputs[1]);await h.type(2,'323');await h.key(h.form.inputs[2]);
  assert.equal(h.requests.length,1);assert.equal(h.active.id,'advance');
  assert.equal(h.requests[0].name,'records');assert.equal(h.requests[0].body.advance,false);
  assert.equal(h.remote.meeting.cursor,0);assert.equal(h.remote.display.heat,0);assert.equal(h.remote.display.division,'awana');
  assert.deepEqual(Object.values(h.remote.divisions.awana.rounds[0].results).map(r=>r.times[0]),[3210,3220,3230]);
  assert.match(h.element('#message').textContent,/Enter를 한 번 더/);
  await h.key(h.active);assert.deepEqual(h.requests.map(r=>r.name),['records','next-race']);
  assert.equal(h.inspect().state.meeting.cursor,1);assert.equal(h.active,h.form.inputs[0]);assert.match(h.html,/일반부/);
});
test('기록관: Ctrl+Enter도 TV 유지 저장, 성공 후 Enter로 다음 경기 이동',async()=>{
  const h=await recorder();await h.fill();await h.key(h.form.inputs[0],true);
  assert.equal(h.requests.length,1);assert.equal(Object.keys(h.requests[0].body.records).length,3);assert.equal(h.requests[0].body.advance,false);
  assert.equal(h.inspect().state.meeting.cursor,0);
  await h.key(h.active);assert.equal(h.inspect().state.meeting.cursor,1);
});

test('기록관: 4명 Enter 저장 실패나 길게 누르기로 다음 조를 건너뛰지 않음',async()=>{
  const h=await recorder(fixture(1));await h.fill();h.fail(500);
  await h.key(h.form.inputs[3]);assert.equal(h.remote.meeting.cursor,1);assert.equal(h.inspect().dirty,true);
  h.fail(0);await h.key(h.form.inputs[3]);assert.equal(h.remote.meeting.cursor,1);assert.equal(h.active.id,'advance');
  const count=h.requests.length;await h.key(h.active,false,true);assert.equal(h.requests.length,count);
  await h.key(h.active);assert.equal(h.remote.meeting.cursor,2);assert.equal(h.active,h.form.inputs[0]);
  await h.key(h.active);assert.equal(h.remote.meeting.cursor,2);assert.equal(h.requests.length,count+1);
});
test('기록관: DNF와 2자리 정밀도 처리, 신규 소수3자리 거부',async()=>{
  const h=await recorder();await h.fill();await h.type(0,'3.217');await h.submit();assert.equal(h.requests.length,0);
  await h.type(0,'1025');await h.dnf(1);await h.submit();
  assert.deepEqual(Object.values(h.requests[0].body.records),['10.25','DNF','3.21']);
});
test('기록관: 기록만 저장 후 다음 이동은 수정사유 없이 next-race만 호출',async()=>{
  const h=await recorder();await h.fill();await h.submit(false);assert.equal(h.inspect().state.meeting.cursor,0);
  assert.match(h.element('#advance').textContent,/저장 확인/);assert.equal(h.element('#stay').disabled,true);
  await h.submit();assert.deepEqual(h.requests.map(r=>r.name),['records','next-race']);assert.equal(h.inspect().state.meeting.cursor,1);
});
test('기록관: 저장한 기록 수정은 사유를 요구하고 legacy정밀도는 보존',async()=>{
  const state=fixture(),r=state.divisions.awana.rounds[0],ids=r.entrantIds;
  r.results[ids[0]].times[0]=3217;r.results[ids[1]].times[0]=3220;r.results[ids[2]].times[0]=3230;
  const h=await recorder(state);await h.type(1,'325');await h.submit();assert.equal(h.requests.length,0);assert.equal(h.element('#correction').hidden,false);
  h.form.reason.value='스톱워치 확인';await h.submit();assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].body.records[ids[0]],'3.217');assert.equal(h.requests[0].body.reason,'스톱워치 확인');
});
test('기록관: 부분 저장된 복원 경기에서도 수정사유를 받아 저장',async()=>{
  const state=fixture(),r=state.divisions.awana.rounds[0];r.results[r.entrantIds[0]].times[0]=3210;
  const h=await recorder(state);await h.type(1,'322');await h.type(2,'323');assert.equal(h.element('#correction').hidden,false);
  await h.submit();assert.equal(h.requests.length,0);h.form.reason.value='미입력 보완';await h.submit();assert.equal(h.requests.length,1);
});
test('기록관: Dirty SSE는 입력과 현재 조를 보존하고 최신 확인 전 저장 차단',async()=>{
  const h=await recorder();await h.fill();const next=fixture(1);next.revision=h.remote.revision+1;
  const raw=h.form.inputs[0].value;h.push(next);assert.equal(h.form.inputs[0].value,raw);assert.equal(h.element('#stale').hidden,false);assert.equal(h.element('#advance').disabled,true);
  await h.submit();assert.equal(h.requests.length,0);assert.equal(h.inspect().state.meeting.cursor,0);
  h.confirm(false);await h.refresh();assert.equal(h.form.inputs[0].value,raw);
  h.confirm(true);await h.refresh();assert.equal(h.inspect().state.meeting.cursor,1);assert.equal(h.inspect().dirty,false);assert.equal(h.form.inputs.length,4);
});
test('기록관: Clean SSE는 새 현재 경기와 물리레인 순서로 이동',async()=>{
  const h=await recorder();const next=fixture(2);next.revision=h.remote.revision+1;h.push(next);
  assert.equal(h.inspect().state.meeting.cursor,2);assert.equal(h.form.inputs.length,3);
  const r=next.divisions.awana.rounds[0];assert.deepEqual(h.form.inputs.map(f=>f.name),lanesFor(r,0,1).filter(Boolean));
  assert.equal(h.active,h.form.inputs[0]);
});
test('기록관: 409와 통신 실패는 입력을 지우거나 자동 재시도하지 않음',async()=>{
  const h=await recorder();await h.fill();h.fail(500);await h.submit();assert.equal(h.form.inputs[0].value,'3.21');assert.equal(h.inspect().dirty,true);assert.equal(h.requests.length,1);
  h.fail(409);await h.submit();assert.equal(h.form.inputs[0].value,'3.21');assert.equal(h.element('#stale').hidden,false);assert.equal(h.requests.length,2);
});
test('기록관: 저장 중 중복 제출과 Enter 길게 누르기 차단',async()=>{
  const h=await recorder();await h.fill();let release;h.defer(new Promise(resolve=>release=resolve));
  const first=h.submit();await h.submit();assert.equal(h.requests.length,1);release();await first;h.defer(null);
  await h.fill();await h.key(h.form.inputs[0],true,true);assert.equal(h.requests.length,1);
});
test('기록관: PIN 로그인은 같은 세션 API를 사용하고 만료되어도 입력 유지',async()=>{
  const h=await recorder(fixture(),false);assert.equal(h.form,null);assert.equal(h.element('#login').hidden,false);
  h.element('#pin').value='test-pin';await h.login();assert.equal(h.form.inputs.length,3);assert.equal(h.requests[0].name,'login');
  await h.fill();h.fail(401);await h.submit();assert.equal(h.element('#recorder').hidden,true);assert.equal(h.form.inputs[0].value,'3.21');
  h.fail(0);await h.login();assert.equal(h.element('#recorder').hidden,false);assert.equal(h.form.inputs[0].value,'3.21');
});
test('기록관: 각 부문 마지막 확인 취소 후 재시도, 전체 완료는 읽기 전용',async()=>{
  const h=await recorder(fixture(6));await h.fill();h.confirm(false);await h.submit();assert.equal(h.requests.length,0);assert.equal(h.confirmations.length,1);
  h.confirm(true);await h.submit();assert.equal(h.inspect().state.divisions.awana.rounds[0].status,'completed');assert.equal(h.inspect().state.meeting.cursor,7);
  await h.fill();await h.submit();assert.equal(h.inspect().state.meeting.status,'completed');assert.equal(h.form,null);assert.match(h.html,/읽기 전용/);
  assert.equal(h.element('#message').textContent,'모든 경기 기록이 저장되었습니다.');
});

test('기록관 HTTP: 모든 모듈 제공, 호스트와 동일 PIN쿠키, 비로그인 기록변경 거부',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'awana-recorder-')),app=createApp({dataDir:dir,pin:'recorder-test-123',production:false});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${app.server.address().port}`;
    for(const path of ['/recorder','/recorder.js','/recorder.css','/common.js','/quick-entry.js','/race-format.js','/draw-model.js']){
      const response=await fetch(url+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),path.endsWith('.js')?/javascript/:path.endsWith('.css')?/css/:/html/);
    }
    const post=(path,body,cookie='')=>fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(body)});
    assert.equal((await post('records',{})).status,401);
    const login=await post('login',{pin:'recorder-test-123'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await fetch(url+'/api/session',{headers:{cookie}})).json(),{authenticated:true,passwordRequired:true});
    const updated=await post('participants',{division:'awana',revision:app.store.read().revision,entries:[{name:'테스트'}]},cookie);assert.equal(updated.status,200);
    await post('logout',{},cookie);assert.equal((await post('records',{},cookie)).status,401);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('기록관 HTTP: 비밀번호 없으면 바로 사용, 서버측 오래된 revision은 거부',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'awana-recorder-open-')),app=createApp({dataDir:dir,pin:'',production:false});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${app.server.address().port}`;
    assert.deepEqual(await (await fetch(url+'/api/session')).json(),{authenticated:true,passwordRequired:false});
    const body={division:'awana',revision:app.store.read().revision,entries:[{name:'테스트'}]};
    const post=()=>fetch(url+'/api/participants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post()).status,200);assert.equal((await post()).status,409);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
