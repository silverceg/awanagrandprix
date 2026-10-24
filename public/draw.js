import { $, escape as e, connect } from './common.js';
import { numberDraw } from './draw-model.js';

let state, signatures=new Map(), visible=new Set(), queue=[], running=false, generation=0, eventId, recent;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let audioContext, soundOn=false, master;
let volume=.65, launchBuffers=[], nextSound=0;
const SOUND_URLS=['/sounds/draw-intro.wav','/sounds/draw-crowd.wav','/sounds/draw-rhythm.wav'];
const FLIGHT_MS=1500;
async function loadLaunch(){
  if(launchBuffers.length===SOUND_URLS.length)return;
  const loaded=await Promise.all(SOUND_URLS.map(async url=>{
    const response=await fetch(url);
    if(!response.ok)throw Error('launch-load');
    return audioContext.decodeAudioData(await response.arrayBuffer());
  }));
  launchBuffers=loaded;
}
const sounding=new Set();
function stopSound(){for(const source of sounding){try{source.stop();}catch{}}sounding.clear();}
$('#sound-volume').addEventListener('input',event=>{
  volume=Number(event.target.value)/100;if(master)master.gain.setTargetAtTime(soundOn?volume*.6:0,audioContext.currentTime,.03);
});
function startRevealSound(){
  if(!soundOn || audioContext?.state!=='running' || launchBuffers.length!==SOUND_URLS.length)return 0;
  const launchBuffer=launchBuffers[nextSound];
  const now=audioContext.currentTime,source=audioContext.createBufferSource();
  // Keep one track playing across the reveal and rotate only after playback starts.
  const offset=reduced.matches?2.35:0;
  source.buffer=launchBuffer;source.connect(master);sounding.add(source);
  source.onended=()=>{sounding.delete(source);source.disconnect();};
  source.start(now,offset);source.stop(now+launchBuffer.duration-offset);
  nextSound=(nextSound+1)%launchBuffers.length;
  return (launchBuffer.duration-offset)*1000;
}
function track(source,start,end){sounding.add(source);source.onended=()=>{sounding.delete(source);source.disconnect();};source.start(start);source.stop(end);}
function arrivalSound(){
  if(!soundOn || audioContext?.state!=='running')return;
  const now=audioContext.currentTime;
  for(const [i,pitch] of [660,880,1320].entries()){
    const osc=audioContext.createOscillator(),gain=audioContext.createGain(),at=now+i*.075;osc.type='sine';osc.frequency.value=pitch;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.22,at+.015);gain.gain.exponentialRampToValueAtTime(.001,at+.3);osc.connect(gain);gain.connect(master);track(osc,at,at+.32);
  }
}
$('#sound-toggle').addEventListener('click',async()=>{
  const button=$('#sound-toggle');button.disabled=true;
  try{
    if(soundOn){soundOn=false;stopSound();master.gain.value=0;}
    else{
      if(!audioContext){
        audioContext=new AudioContext();master=audioContext.createGain();const limiter=audioContext.createDynamicsCompressor();limiter.threshold.value=-12;limiter.ratio.value=8;master.connect(limiter);limiter.connect(audioContext.destination);
      }
      await audioContext.resume();button.textContent='효과음 준비 중…';await loadLaunch();soundOn=audioContext.state==='running';master.gain.value=soundOn ? volume*.6 : 0;
      if(soundOn)arrivalSound();
    }
    button.setAttribute('aria-pressed',String(soundOn));button.textContent=soundOn?'효과음 끄기':'효과음 켜기';
  }catch{soundOn=false;if(master)master.gain.value=0;button.setAttribute('aria-pressed','false');button.textContent='효과음 켜기';$('#draw-message').textContent='효과음을 불러오지 못했어요. 연결을 확인하고 다시 켜 주세요.';}
  finally{button.disabled=false;}
});
function celebrate(number){
  if(reduced.matches)return;
  const slot=$(`[data-number="${number}"]`);if(!slot)return;const target=slot.getBoundingClientRect(),burst=document.createElement('div');burst.className='arrival-burst';burst.setAttribute('aria-hidden','true');
  burst.style.left=`${target.x+target.width/2}px`;burst.style.top=`${target.y+target.height/2}px`;
  for(let i=0;i<28;i++){
    const spark=document.createElement('i'),angle=i*Math.PI/14,range=65+(i%4)*24;
    spark.className='spark-'+i%4;burst.append(spark);
    spark.animate([{opacity:1,transform:'scale(.4)'},{opacity:0,transform:`translate(${Math.cos(angle)*range}px,${Math.sin(angle)*range}px) rotate(${i*47}deg) scale(.7)`}],{duration:950,easing:'cubic-bezier(.1,.6,.3,1)',fill:'forwards'});
  }
  document.body.append(burst);setTimeout(()=>burst.remove(),1000);
}
function portrait(p) {
  const src=typeof p?.photoUrl==='string' && /^\/media\/[a-f0-9]{64}\.jpg$/.test(p.photoUrl) ? p.photoUrl : '';
  return `<span class="portrait"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-4c0-8 7-12 15-12s15 4 15 12v4z"/></svg>${src?`<img src="${e(src)}" alt="${e(p.name)} 선수 사진">`:''}</span>`;
}
function identity(p,withNumber=false) {
  return `<span class="driver-info">${withNumber?`<small>선수 번호 ${e(p.car)}번</small>`:''}<strong title="${e(p.name)}">${e(p.name)}</strong><span class="car-name ${p.carName?'':'unnamed'}" title="${e(p.carName||'자동차 이름 미등록')}">${e(p.carName||'자동차 이름')}</span></span>`;
}
document.addEventListener('error',event=>{
  if(event.target instanceof HTMLImageElement && event.target.closest('.portrait'))event.target.hidden=true;
},true);
function player(id) { return state.divisions.awana.participants.find(p=>p.id===id); }
function render() {
  if(!state)return;
  const draw=numberDraw(state.divisions.awana.participants),shown=draw.groups.flat().filter(p=>p&&visible.has(p.id)).length;
  $('#draw-count').innerHTML=`${shown} <small>/ 40명</small>`;
  $('#draw-grid').innerHTML=draw.groups.map((group,i)=>{
    const count=group.filter(p=>p&&visible.has(p.id)).length;
    return `<article class="team ${count===4?'full':''} ${group.some(p=>p?.id===recent)?'recent':''}"><div class="team-head"><strong><b>${i+1}</b>조</strong><span>${i*4+1}~${i*4+4}번 · ${count}/4명</span></div><div class="team-members">${group.map((p,j)=>{
      const show=p&&visible.has(p.id),number=i*4+j+1;
      return `<div class="member ${show?'':'empty'} ${show&&p.id===recent?'new':''}" data-number="${number}"><span class="ticket">${String(number).padStart(2,'0')}</span>${show?`${portrait(p)}${identity(p)}`:'<strong>친구를 기다려요</strong>'}</div>`;
    }).join('')}</div></article>`;
  }).join('');
  $('#draw-message').textContent=draw.invalid.length?`번호 확인이 필요한 선수 ${draw.invalid.length}명 · 진행자에게 알려 주세요`:shown===40?'40명 모두 우리 조에 도착했어요!':running?'우리 조로 이동하는 중이에요!':'뽑은 번호를 지정하면 우리 조로 출발해요';
}
function validPlayer(id) {return numberDraw(state.divisions.awana.participants).groups.flat().find(p=>p?.id===id);}
async function play() {
  if(running || !queue.length)return;
  running=true;const token=generation,id=queue.shift(),p=validPlayer(id);
  if(!p){running=false;play();return;}
  visible.delete(id);
  const number=Number(p.car),group=Math.floor((number-1)/4);
  $('#reveal').classList.remove('flying','revealed');$('#reveal').classList.add('charging');$('#reveal').hidden=false;
  $('#reveal-player').innerHTML=`<div class="reveal-driver">${portrait(p)}${identity(p)}</div>`;
  $('#reveal-result').innerHTML='<div class="start-sequence"><span class="launch-label">어느 조의 주인공일까요?</span><div class="start-lights" aria-hidden="true"><i></i><i></i><i></i></div><strong>READY?</strong></div>';
  const soundDuration=startRevealSound(),revealWait=reduced.matches?350:2700;
  $('#reveal-friends').innerHTML='';render();
  await pause(revealWait);if(token!==generation)return;
  $('#reveal').classList.remove('charging');
  if(!validPlayer(id) || Number(player(id).car)!==number){finish();return;}
  $('#reveal').classList.add('revealed');const launchDuration=Math.max(0,soundDuration-revealWait);
  $('#reveal-result').innerHTML=`<div class="result race-go"><small>선수 번호 ${number}번</small><span><strong>WOW!</strong><b>${group+1}</b>조</span><em>지금, 우리 조로 출발!</em></div>`;
  const friends=numberDraw(state.divisions.awana.participants).groups[group].filter(q=>q&&q.id!==id&&visible.has(q.id));
  $('#reveal-friends').innerHTML=`<p class="friends-title">${friends.length?'함께 달릴 우리 조 친구들':'우리 조의 첫 번째 주인공이에요!'}</p><div class="friends">${friends.map(q=>`<div class="friend"><small>#${e(q.car)}</small>${e(q.name)}</div>`).join('')}</div>`;
  await pause(reduced.matches?300:450);if(token!==generation)return;
  if(!validPlayer(id) || Number(player(id).car)!==number){finish();return;}
  const start=$('.reveal-driver').getBoundingClientRect(),destination=$(`[data-number="${number}"]`).getBoundingClientRect();
  $('#reveal').classList.add('flying');
  $(`[data-number="${number}"]`).closest('.team').classList.add('receiving');
  if(!reduced.matches) {
    const flyer=document.createElement('div');flyer.className='fly-ticket';flyer.innerHTML=`${portrait(p)}${identity(p,true)}`;
    flyer.style.width=`${start.width}px`;flyer.style.height=`${start.height}px`;document.body.append(flyer);
    const animation=flyer.animate([
      {transform:`translate(${start.x}px,${start.y}px) scale(1)`,opacity:1},
      {transform:`translate(${destination.x}px,${destination.y}px) scale(${destination.width/start.width},${destination.height/start.height})`,opacity:1}
    ],{duration:FLIGHT_MS,easing:'cubic-bezier(.45,0,.12,1)',fill:'forwards'});
    await animation.finished.catch(()=>{});flyer.remove();if(token!==generation)return;
  }
  visible.add(id);recent=id;$('#reveal').hidden=true;render();celebrate(number);
  await pause(Math.max(reduced.matches?150:650,launchDuration-(reduced.matches?300:450+FLIGHT_MS)));if(token!==generation)return;
  finish();
  function finish(){ stopSound();$('#reveal').hidden=true;running=false;render();play(); }
}
function accept(next) {
  if(state && next.revision<state.revision)return;
  const players=next.divisions.awana.participants,initial=!state;
  const validIds=new Set(numberDraw(players).groups.flat().filter(Boolean).map(p=>p.id));
  const nextSignatures=new Map(players.map(p=>[p.id,`${p.car}:${validIds.has(p.id)}`]));
  const incoming=players.filter(p=>!signatures.has(p.id)||signatures.get(p.id)!==nextSignatures.get(p.id)).map(p=>p.id);
  state=next;
  if(initial){visible=new Set(players.map(p=>p.id));eventId=next.drawReveal?.eventId;}
  else {
    for(const id of incoming){visible.delete(id);if(!queue.includes(id))queue.push(id);}
    if(next.drawReveal?.eventId && next.drawReveal.eventId!==eventId){
      const id=next.drawReveal.participantId;eventId=next.drawReveal.eventId;
      if(!incoming.includes(id) && !queue.includes(id))queue.push(id);
    }
  }
  signatures=nextSignatures;visible=new Set([...visible].filter(id=>nextSignatures.has(id)));
  render();play();
}
$('#skip').addEventListener('click',()=>{
  generation++;queue=[];running=false;visible=new Set(state.divisions.awana.participants.map(p=>p.id));
  stopSound();document.querySelectorAll('.arrival-burst').forEach(node=>node.remove());
  for(const node of document.querySelectorAll('.fly-ticket')){for(const a of node.getAnimations())a.cancel();node.remove();}
  $('#reveal').hidden=true;render();
});
$('#fullscreen').addEventListener('click',()=>{
  const task=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
  task?.catch(()=>{ $('#draw-message').textContent='브라우저의 전체 화면 기능을 사용하세요.'; });
});
connect(accept);

