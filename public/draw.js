import { $, escape as e, connect } from './common.js';
import { numberDraw } from './draw-model.js';

let state, signatures=new Map(), visible=new Set(), queue=[], running=false, generation=0, eventId, recent;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function portrait(p) {
  const src=typeof p?.photoUrl==='string' && /^\/media\/[a-f0-9]{64}\.jpg$/.test(p.photoUrl) ? p.photoUrl : '';
  return `<span class="portrait">${src?`<img src="${e(src)}" alt="">`:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-4c0-8 7-12 15-12s15 4 15 12v4z"/></svg>'}</span>`;
}
function player(id) { return state.divisions.awana.participants.find(p=>p.id===id); }
function render() {
  if(!state)return;
  const draw=numberDraw(state.divisions.awana.participants),shown=draw.groups.flat().filter(p=>p&&visible.has(p.id)).length;
  $('#draw-count').innerHTML=`${shown} <small>/ 40명</small>`;
  $('#draw-grid').innerHTML=draw.groups.map((group,i)=>{
    const count=group.filter(p=>p&&visible.has(p.id)).length;
    return `<article class="team ${count===4?'full':''} ${group.some(p=>p?.id===recent)?'recent':''}"><div class="team-head"><strong><b>${i+1}</b>조</strong><span>${i*4+1}~${i*4+4}번 · ${count}/4명</span></div><div class="team-members">${group.map((p,j)=>{
      const show=p&&visible.has(p.id),number=i*4+j+1;
      return `<div class="member ${show?'':'empty'} ${show&&p.id===recent?'new':''}" data-number="${number}"><span class="ticket">${String(number).padStart(2,'0')}</span>${show?`${portrait(p)}<strong title="${e(p.name)}">${e(p.name)}</strong>`:'<strong>친구를 기다려요</strong>'}</div>`;
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
  $('#reveal-player').innerHTML=`<div class="reveal-driver">${portrait(p)}<div><small>선수 번호 ${e(p.car)}번</small><strong>${e(p.name)}</strong></div></div>`;
  $('#reveal-result').innerHTML='<div class="result waiting">우리 조로 출발!</div>';
  $('#reveal-friends').innerHTML='';render();
  await pause(reduced.matches?100:1000);if(token!==generation)return;
  if(!validPlayer(id) || Number(player(id).car)!==number){finish();return;}
  $('#reveal-result').innerHTML=`<div class="result"><b>${group+1}</b>조</div>`;
  const friends=numberDraw(state.divisions.awana.participants).groups[group].filter(q=>q&&q.id!==id&&visible.has(q.id));
  $('#reveal-friends').innerHTML=`<p class="friends-title">${friends.length?'함께 달릴 우리 조 친구들':'우리 조의 첫 번째 주인공이에요!'}</p><div class="friends">${friends.map(q=>`<div class="friend"><small>#${e(q.car)}</small>${e(q.name)}</div>`).join('')}</div>`;
  await pause(reduced.matches?500:1100);if(token!==generation)return;
  if(!validPlayer(id) || Number(player(id).car)!==number){finish();return;}
  const start=$('.reveal-driver').getBoundingClientRect(),destination=$(`[data-number="${number}"]`).getBoundingClientRect();
  $('#reveal').classList.add('flying');
  if(!reduced.matches) {
    const flyer=document.createElement('div');flyer.className='fly-ticket';flyer.innerHTML=`${portrait(p)}<strong><small>#${e(p.car)}</small>${e(p.name)}</strong>`;
    flyer.style.width=`${start.width}px`;flyer.style.height=`${start.height}px`;document.body.append(flyer);
    const animation=flyer.animate([
      {transform:`translate(${start.x}px,${start.y}px) scale(1)`,opacity:1},
      {transform:`translate(${destination.x}px,${destination.y}px) scale(${destination.width/start.width},${destination.height/start.height})`,opacity:1}
    ],{duration:900,easing:'cubic-bezier(.35,0,.15,1)',fill:'forwards'});
    await animation.finished.catch(()=>{});flyer.remove();if(token!==generation)return;
  }
  visible.add(id);recent=id;$('#reveal').hidden=true;render();
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
  for(const node of document.querySelectorAll('.fly-ticket')){for(const a of node.getAnimations())a.cancel();node.remove();}
  $('#reveal').hidden=true;render();
});
$('#fullscreen').addEventListener('click',()=>{
  const task=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
  task?.catch(()=>{ $('#draw-message').textContent='브라우저의 전체 화면 기능을 사용하세요.'; });
});
connect(accept);
