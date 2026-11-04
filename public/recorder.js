import { $, api, connect, escape as e, fmt, current, lanes, isFour, laneRecords, eventSchedule, scheduledRace, groupNumber } from './common.js';
import { quickTime } from './quick-entry.js';

const app=$('#recorder');
let state=null, pendingState=null, dirty=false, saving=false, loggedIn=false;
const taskKey=s=>{const t=scheduledRace(s);return t?`${s.divisions[t.division].rounds.at(-1)?.id}:${t.division}:${t.heat}:${t.run}`:'';};
const fields=()=>[...app.querySelectorAll('input[data-race-time]')];
function notify(text,error=false){const box=$('#message');box.textContent=text;box.className='message'+(error?' error':'');box.hidden=false;}
function focusField(input){input?.focus({preventScroll:true});input?.select();input?.scrollIntoView({block:'nearest',behavior:'instant'});}
function setLogin(value){loggedIn=value;$('#login').hidden=value;app.hidden=!value;if(value)render();}
function preview(input,commit=false){
  const result=quickTime(input.value,input.dataset.original||'');
  const output=document.getElementById('preview-'+input.name);
  output.textContent=result.ok?result.label:result.empty?'':result.error;
  output.className='entry-preview'+(!result.ok&&!result.empty?' invalid':'');
  input.setCustomValidity(result.ok?'':result.error);
  if(commit&&result.ok)input.value=result.value;
  return result;
}
function snapshot(){
  const inputs=fields(),allSaved=inputs.length>0&&inputs.every(f=>f.dataset.original!=='');
  const changed=inputs.some(f=>{const r=quickTime(f.value,f.dataset.original);return !r.ok||r.value!==f.dataset.original;});
  const correction=changed&&inputs.some(f=>f.dataset.original!=='');
  return {allSaved,changed,correction};
}
function syncButtons(){
  const form=$('#records-form');if(!form)return;
  const {allSaved,changed,correction}=snapshot();
  $('#correction').hidden=!correction;$('#reason').required=correction;
  const last=!eventSchedule(state)[state.meeting.cursor+1];
  $('#advance').textContent=allSaved&&!changed?`저장 확인 후 ${last?'전체 경기 마치기':'다음 경기 →'}`:`기록 저장 후 ${last?'전체 경기 마치기':'다음 경기 →'}`;
  $('#stay').textContent=allSaved&&!changed?'저장된 기록 · TV 유지':'기록만 저장 · TV 유지';
  $('#stay').disabled=saving||!!pendingState||allSaved&&!changed;
  $('#advance').disabled=saving||!!pendingState;
}
function render(){
  if(!loggedIn||!state)return;
  const t=scheduledRace(state),schedule=eventSchedule(state),r=t&&current(state.divisions[t.division]);
  if(!t||!isFour(r)||r.status!=='active'){
    const completed=state.meeting?.status==='completed';
    app.innerHTML=`<section class="panel finished"><span class="division">${completed?'기록 입력 완료':'경기 준비 중'}</span><h1>${completed?'본선 4라운드를 마쳤습니다':'시작할 경기를 기다리고 있어요'}</h1><p>${completed?'모든 기록이 저장되었습니다. 종료된 경기는 읽기 전용입니다.':'호스트에서 두 부문 조 편성을 마치면 현재 경기 입력창이 자동으로 열립니다.'}</p></section>`;
    return;
  }
  const d=state.divisions[t.division],next=schedule[state.meeting.cursor+1],totalGroups=schedule.length/4;
  app.innerHTML=`<section class="progress-heading"><div><span class="division">${e(d.name)}</span><h1>${groupNumber(state,t.division,t.heat)}조 <small>전체 ${totalGroups}개 조</small></h1></div><div><div class="round-strip" aria-label="본선 라운드">${[0,1,2,3].map(n=>`<span class="${n===t.run?'active':n<t.run?'done':''}">${n+1}R</span>`).join('')}</div><div class="progress-count">본선 ${t.run+1} / 4라운드 · ${state.meeting.cursor+1} / ${schedule.length}경기</div></div></section>
  <p class="entry-help"><b>321 → 3.21초</b><span><kbd>Enter</kbd> 다음 레인 / 마지막에는 저장 버튼 확인</span><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 저장 후 다음</span></p>
  <form id="records-form"><div class="lanes">${lanes(r,t.heat,t.run).map((id,i)=>{
    const player=id&&d.participants.find(p=>p.id===id),value=id&&r.results[id].times[t.run],original=id&&value!==null?fmt(value):'';
    return `<section class="lane lane-${i+1}${id?'':' empty-lane'}"><div class="lane-label">${i+1}레인</div>${id?`<div class="driver"><small>선수 번호 #${e(player.car)}</small><strong>${e(player.name)}</strong></div><label for="time-${id}">기록 · 초<input id="time-${id}" name="${id}" data-race-time data-original="${e(original)}" value="${e(original)}" autocomplete="off" inputmode="decimal" placeholder="3.21" required aria-describedby="preview-${id}"></label><output id="preview-${id}" class="entry-preview" for="time-${id}" aria-live="polite">${original?e(original==='DNF'?'미완주 DNF':original+'초'):''}</output><button type="button" class="dnf" data-dnf="${id}">미완주 DNF</button><div class="lane-history">${laneRecords(r,id).map((time,l)=>`<span>${l+1}레인 <b>${fmt(time)}</b></span>`).join('')}</div>`:'<p>빈 레인</p>'}</section>`;
  }).join('')}</div><label id="correction" class="correction" hidden>기존 기록 수정 사유<input id="reason" name="reason" maxlength="200" placeholder="예: 스톱워치 재확인" autocomplete="off"></label><div class="actions"><button id="advance" type="submit" name="move" value="advance" class="primary">기록 저장 후 다음 경기 →</button><button id="stay" type="submit" name="move" value="stay">기록만 저장 · TV 유지</button></div></form><p class="next-race">${next?`다음: ${e(state.divisions[next.division].name)} ${groupNumber(state,next.division,next.heat)}조 · 본선 ${next.run+1}라운드`:'마지막 경기입니다. 완료하면 두 부문의 기록이 확정됩니다.'}</p>`;
  syncButtons();
}
function acceptState(next){
  if(state&&next.revision<=state.revision)return;
  if(dirty||saving){pendingState=next; if(!saving){$('#stale').hidden=false;syncButtons();}return;}
  const previous=state&&taskKey(state),focused=document.activeElement?.id;
  state=next;render();
  if(loggedIn&&taskKey(state))focusField(previous!==taskKey(state)?fields()[0]:document.getElementById(focused));
}
function normalize(){for(const input of fields()){const result=preview(input,true);if(!result.ok){notify(result.error,true);focusField(input);return false;}}return true;}
function hasNewerState(){return !!pendingState&&pendingState.revision>state.revision;}
async function save(advance){
  if(saving||!loggedIn)return;
  if(hasNewerState()){notify('다른 창에서 바뀐 현재 경기를 먼저 확인하세요. 입력값은 그대로 남아 있습니다.',true);$('#stale').hidden=false;return;}
  const t=scheduledRace(state),r=t&&current(state.divisions[t.division]);
  if(!t||!isFour(r)||r.status!=='active'||!normalize())return;
  const {allSaved,changed,correction}=snapshot(),reason=$('#reason').value.trim();
  if(correction&&!reason){notify('기존 기록을 고칠 때는 수정 사유를 입력하세요.',true);$('#reason').focus();return;}
  if(!changed&&!advance){notify('이미 저장된 기록입니다. 다음 경기 버튼으로 이동하세요.');return;}
  if(advance&&t.run===3&&t.heat===r.groups.length-1&&!confirm(`${state.divisions[t.division].name}의 마지막 주행입니다. 모든 기록을 확인했나요? 다음으로 넘기면 이 부문 기록이 잠깁니다.`))return;
  const body={revision:state.revision,division:t.division,roundId:r.id,heat:t.heat,run:t.run};
  const nextOnly=allSaved&&!changed&&advance;
  if(!nextOnly)Object.assign(body,{records:Object.fromEntries(fields().map(f=>[f.name,f.value])),reason,advance});
  saving=true;
  const controls=[...app.querySelectorAll('input, button')].map(el=>[el,el.disabled]);
  for(const [el]of controls)el.disabled=true;
  notify('저장 중입니다…');
  try{
    const result=await api(nextOnly?'next-race':'records',body);
    state=result;dirty=false;
    if(pendingState?.revision>state.revision)state=pendingState;
    pendingState=null;$('#stale').hidden=true;saving=false;render();
    notify(state.meeting?.status==='completed'?'모든 경기 기록이 저장되었습니다.':advance?'저장했습니다. 다음 경기 입력을 준비하세요.':'저장했습니다. 현재 경기와 TV 화면을 유지합니다.');
    if(advance)focusField(fields()[0]);else $('#advance')?.focus({preventScroll:true});
  }catch(err){
    notify(err.message||'저장하지 못했습니다. 입력값을 확인하고 다시 시도하세요.',true);
    if(err.status===401){loggedIn=false;$('#login').hidden=false;app.hidden=true;}
    if(err.status===409||hasNewerState()){
      $('#stale').hidden=false;
      if(!pendingState)try{pendingState=await api('state');}catch{}
    }
  }finally{
    saving=false;
    for(const [el,disabled]of controls)el.disabled=disabled;
    syncButtons();
  }
}
app.addEventListener('input',event=>{dirty=true;if(event.target.matches('input[data-race-time]'))preview(event.target);syncButtons();});
app.addEventListener('focusout',event=>{if(event.target.matches('input[data-race-time]')){preview(event.target,true);syncButtons();}});
app.addEventListener('click',event=>{const button=event.target.closest('button[data-dnf]');if(!button||saving||!loggedIn)return;const input=document.getElementById('time-'+button.dataset.dnf);input.value='DNF';dirty=true;preview(input,true);syncButtons();focusField(input);});
app.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.isComposing||!event.target.closest('#records-form'))return;
  if(saving||event.repeat){event.preventDefault();return;}
  if(!event.ctrlKey&&!event.metaKey&&event.target.tagName==='BUTTON')return;
  event.preventDefault();
  if(event.ctrlKey||event.metaKey){if(normalize()&&!$('#advance').disabled)$('#records-form').requestSubmit($('#advance'));return;}
  const inputs=fields(),i=inputs.indexOf(event.target);
  if(i>=0){if(!preview(inputs[i],true).ok)return;if(inputs[i+1]){focusField(inputs[i+1]);return;}}
  if(!$('#advance').disabled){$('#advance').focus({preventScroll:true});$('#advance').scrollIntoView({block:'nearest'});notify('레인별 기록을 확인한 뒤 Enter를 한 번 더 누르면 저장 후 다음 경기로 이동합니다.');}
});
app.addEventListener('submit',event=>{if(event.target.id!=='records-form')return;event.preventDefault();return save(event.submitter?.value==='advance');});
$('#refresh').addEventListener('click',async()=>{
  if(saving||dirty&&!confirm('입력 중인 값을 화면에서 버리고 최신 경기를 불러올까요? 저장된 기록은 유지됩니다.'))return;
  try{const next=await api('state');state=next;pendingState=null;dirty=false;$('#stale').hidden=true;render();notify('현재 경기와 저장 기록을 불러왔습니다.');focusField(fields()[0]);}catch(err){notify(err.message,true);}
});
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('login',{pin:$('#pin').value});$('#pin').value='';const next=await api('state');
    if(dirty&&state){loggedIn=true;$('#login').hidden=true;app.hidden=false;acceptState(next);syncButtons();}
    else{state=next;setLogin(true);focusField(fields()[0]);}
  }catch(err){notify(err.message,true);}
});
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
try{const session=await api('session');state=await api('state');setLogin(session.authenticated);connect(acceptState);if(loggedIn)focusField(fields()[0]);}
catch(err){notify('서버에 연결할 수 없습니다. 새로고침해 주세요. '+err.message,true);}
