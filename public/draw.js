import { $, escape as e, connect } from './common.js';
import { numberDraw } from './draw-model.js';

let state, signatures=new Map(), visible=new Set(), queue=[], running=false, generation=0, eventId, recent;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let audioContext, soundOn=false, master, engineNoise;
const sounding=new Set();
function stopSound(){for(const source of sounding){try{source.stop();}catch{}}sounding.clear();}
function engineSound(){
  if(!soundOn || audioContext?.state!=='running')return;
  const now=audioContext.currentTime, envelope=audioContext.createGain();
  envelope.gain.setValueAtTime(0,now);envelope.gain.linearRampToValueAtTime(.45,now+.09);envelope.gain.exponentialRampToValueAtTime(.08,now+.9);envelope.gain.linearRampToValueAtTime(0,now+1.15);envelope.connect(master);
  const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(450,now);filter.frequency.exponentialRampToValueAtTime(1600,now+.8);filter.connect(envelope);
  for(const pitch of [75,112]){
    const osc=audioContext.createOscillator();osc.type='sawtooth';osc.frequency.setValueAtTime(pitch,now);osc.frequency.exponentialRampToValueAtTime(pitch*3.8,now+.72);osc.frequency.exponentialRampToValueAtTime(pitch*1.5,now+1.1);osc.connect(filter);track(osc,now,now+1.15);
  }
  const noise=audioContext.createBufferSource(),level=audioContext.createGain();noise.buffer=engineNoise;level.gain.value=.24;noise.connect(level);level.connect(filter);track(noise,now,now+1.15);
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
        audioContext=new AudioContext();master=audioContext.createGain();master.connect(audioContext.destination);
        engineNoise=audioContext.createBuffer(1,Math.ceil(audioContext.sampleRate*1.2),audioContext.sampleRate);const data=engineNoise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      }
      await audioContext.resume();soundOn=audioContext.state==='running';master.gain.value=soundOn ? .12 : 0;
      if(soundOn)arrivalSound();
    }
    button.setAttribute('aria-pressed',String(soundOn));button.textContent=soundOn?'효과음 끄기':'효과음 켜기';
  }catch{$('#draw-message').textContent='소리를 켜지 못했어요. 브라우저 소리 설정을 확인해 주세요.';}
  finally{button.disabled=false;}
});
function celebrate(number){
  if(reduced.matches)return;
  const target=$(`[data-number="${number}"]`).getBoundingClientRect(),burst=document.createElement('div');burst.className='arrival-burst';burst.setAttribute('aria-hidden','true');
  burst.style.left=`${target.x+target.width/2}px`;burst.style.top=`${target.y+target.height/2}px`;
  for(let i=0;i<16;i++){
    const spark=document.createElement('i'),angle=i*Math.PI/8,range=45+(i%3)*24;
    spark.style.setProperty('--dx',`${Math.cos(angle)*range}px`);spark.style.setProperty('--dy',`${Math.sin(angle)*range}px`);spark.style.setProperty('--turn',`${i*47}deg`);spark.style.background=['#ffe34b','#69e2ff','#fff','#ff9d40'][i%4];burst.append(spark);
  }
  document.body.append(burst);setTimeout(()=>burst.remove(),1000);
}
function portrait(p) {
  const src=typeof p?.photoUrl==='string' && /^\/media\/[a-f0-9]{64}\.jpg$/.test(p.photoUrl) ? p.photoUrl : '';
  return `<span class="portrait"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-4c0-8 7-12 15-12s15 4 15 12v4z"/></svg>${src?`<img src="${e(src)}" alt="${e(p.name)} 선수 사진">`:''}</span>`;
}
function carPhoto(p) {
  const src=typeof p?.carPhotoUrl==='string' && /^\/media\/[a-f0-9]{64}\.jpg$/.test(p.carPhotoUrl) ? p.carPhotoUrl : '';
  return `<span class="car-photo"><svg viewBox="0 0 80 48" aria-hidden="true"><path d="m17 12-7 15v12h6v-5h48v5h6V27l-7-15a6 6 0 0 0-5-3H22a6 6 0 0 0-5 3Zm5 3h36l5 12H17Zm-2 14a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm40 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>${src?`<img src="${e(src)}" alt="${e(p.carName||p.name)} 자동차 사진">`:''}</span>`;
}
function identity(p,withNumber=false) {
  return `<span class="driver-info">${withNumber?`<small>선수 번호 ${e(p.car)}번</small>`:''}<strong title="${e(p.name)}">${e(p.name)}</strong><span class="car-name ${p.carName?'':'unnamed'}" title="${e(p.carName||'자동차 이름 미등록')}">${e(p.carName||'자동차 이름')}</span></span>`;
}
document.addEventListener('error',event=>{
  if(event.target instanceof HTMLImageElement && event.target.closest('.portrait,.car-photo'))event.target.hidden=true;
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
      return `<div class="member ${show?'':'empty'} ${show&&p.id===recent?'new':''}" data-number="${number}"><span class="ticket">${String(number).padStart(2,'0')}</span>${show?`${portrait(p)}${identity(p)}${carPhoto(p)}`:'<strong>친구를 기다려요</strong>'}</div>`;
    }).join('')}</div></article>`;
  }).join('');
  $('#draw-message').textContent=draw.invalid.length?`번호 확인이 필요한 선수 ${draw.invalid.length}명 · 진행자에게 알려 주세요`:shown===40?'40명 모두 우리 조에 도착했어요!':running?'우리 조로 이동하는 중이에요!':'번호와 이름을 등록하면 우리 조로 출발해요';
}
function validPlayer(id) {return numberDraw(state.divisions.awana.participants).groups.flat().find(p=>p?.id===id);}
async function play() {
  if(running || !queue.length)return;
  running=true;const token=generation,id=queue.shift(),p=validPlayer(id);
  if(!p){running=false;play();return;}
  visible.delete(id);
  const number=Number(p.car),group=Math.floor((number-1)/4);
  $('#reveal').classList.remove('flying');$('#reveal').hidden=false;
  $('#reveal-player').innerHTML=`<div class="reveal-driver">${portrait(p)}${identity(p,true)}${carPhoto(p)}</div>`;
  $('#reveal-result').innerHTML='<div class="result waiting">우리 조로 출발!</div>';
  $('#reveal-friends').innerHTML='';render();
  await pause(reduced.matches?100:1100);if(token!==generation)return;
  if(!validPlayer(id) || Number(player(id).car)!==number){finish();return;}
  $('#reveal-result').innerHTML=`<div class="result"><b>${group+1}</b>조</div>`;
  const friends=numberDraw(state.divisions.awana.participants).groups[group].filter(q=>q&&q.id!==id&&visible.has(q.id));
  $('#reveal-friends').innerHTML=`<p class="friends-title">${friends.length?'함께 달릴 우리 조 친구들':'우리 조의 첫 번째 주인공이에요!'}</p><div class="friends">${friends.map(q=>`<div class="friend"><small>#${e(q.car)}</small>${e(q.name)}</div>`).join('')}</div>`;
  await pause(reduced.matches?500:1400);if(token!==generation)return;
  if(!validPlayer(id) || Number(player(id).car)!==number){finish();return;}
  const start=$('.reveal-driver').getBoundingClientRect(),destination=$(`[data-number="${number}"]`).getBoundingClientRect();
  $('#reveal').classList.add('flying');
  $(`[data-number="${number}"]`).closest('.team').classList.add('receiving');engineSound();
  if(!reduced.matches) {
    const flyer=document.createElement('div');flyer.className='fly-ticket';flyer.innerHTML=`${portrait(p)}${identity(p,true)}${carPhoto(p)}`;
    flyer.style.width=`${start.width}px`;flyer.style.height=`${start.height}px`;document.body.append(flyer);
    const animation=flyer.animate([
      {transform:`translate(${start.x}px,${start.y}px) scale(1)`,opacity:1},
      {transform:`translate(${destination.x}px,${destination.y}px) scale(${destination.width/start.width},${destination.height/start.height})`,opacity:1}
    ],{duration:1100,easing:'cubic-bezier(.45,0,.12,1)',fill:'forwards'});
    await animation.finished.catch(()=>{});flyer.remove();if(token!==generation)return;
  }
  visible.add(id);recent=id;$('#reveal').hidden=true;render();celebrate(number);arrivalSound();
  await pause(reduced.matches?150:650);if(token!==generation)return;
  finish();
  function finish(){ $('#reveal').hidden=true;running=false;render();play(); }
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
