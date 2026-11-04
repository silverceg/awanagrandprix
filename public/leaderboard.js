import { $, escape as e, current, rows, fmt, connect, isFour, scheduledRace, rankedRows, rankMovement, rankComparisonLabel } from './common.js';

export function boardData(state, pinned) {
  const key = ['awana','open'].includes(pinned) ? pinned : state.display.division;
  const d = state.divisions[key], r = current(d);
  return {key,d,r,list:rankedRows(state,key).filter(p=>isFour(r)?p.times.some(t=>t!==null):p.complete),count:r?.entrantIds.length || d.participants.length || (key==='awana'?40:18)};
}
function photo(p) {
  return `<span class="portrait">${p?.photoUrl?`<img src="${e(p.photoUrl)}" alt="">`:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-4c0-8 7-12 15-12s15 4 15 12v4z"/></svg>'}</span>`;
}
export function awardContenders(state,key,list) {
  if (state.meeting?.status !== 'active' || scheduledRace(state)?.run !== 3) return new Set();
  return new Set(list.filter(p=>Number.isFinite(p.best) && p.rank>=1 && p.rank<=(key==='awana'?3:2)).map(p=>p.id));
}
function entry(p, index, award=false) {
  if (!p) return `<article class="entry empty"><b>${index+1}</b><span class="empty-line"></span><small>기록 대기</small></article>`;
  return `<article class="entry tier-${p.rank && p.rank<=3?p.rank:'base'}${award?' award-contender':''}"${award?' aria-label="현재 수상권 · 잠정 순위"':''}><span class="rank-place"><b class="place">${p.rank || '—'}</b>${rankMovement(p)}</span>${photo(p)}<div class="identity"><strong title="${e(p.name)}">${e(p.name)}</strong><small title="${e(p.carName || '자동차 이름 미등록')}">#${e(p.car)} · ${e(p.carName || '자동차 이름 미등록')}</small></div><div class="result"><strong>${Number.isFinite(p.best)?fmt(p.best):'DNF'}</strong><small>${p.tieBreak!==null?`재경기 ${fmt(p.tieBreak)}`:Number.isFinite(p.best)?'초 · BEST':'미완주'}</small></div></article>`;
}
function spotlight(p,index,award=false) {
  return `<article class="spotlight spot-${index===3?3:index+1} ${p?'':'waiting'}${award?' award-contender':''}"${award?' aria-label="현재 수상권 · 잠정 순위"':''}><div class="medal"><span class="medal-position">${p?.rank || (index===3?3:index+1)}${rankMovement(p)}</span><small>PLACE</small></div>${photo(p)}<div class="spot-name"><small>${index===0?'가장 빠른 순간':index===1?'멋진 도전':'빛나는 레이스'}</small><h2>${p?e(p.name):'주인공을 기다려요'}</h2><span>${p?`#${e(p.car)} · ${e(p.carName || '')}`:'네 레인의 도전, 하나의 최고 기록'}</span></div><strong class="spot-time">${p?fmt(p.best):'—'}<small>${p?'초':''}</small></strong></article>`;
}
export function renderBoard(state, pinned) {
  if (!['awana','open'].includes(pinned)) return renderCombined(state);
  const {d,r,list,count} = boardData(state,pinned);
  const columns=count>48?4:count>24?3:count>8?2:1, per=Math.ceil(count/columns);
  const valid=list.filter(p=>Number.isFinite(p.best)),awards=awardContenders(state,pinned,list),task=scheduledRace(state),finished=r?.status==='completed';
  return `<div class="full-board"><header class="board-header"><div><div class="kicker">AWANA GRAND PRIX <span>● ${finished?'FINAL':'LIVE'}</span></div><h1>${d.name} <em>${finished?'본선 최종 결과':task?`본선 ${task.run+1}라운드`:'본선 4라운드'}</em><small>실시간 전체 순위</small></h1></div><div class="progress-copy"><b>${list.length}<span> / ${count}명</span></b><small>기록 입력</small></div></header><section class="spotlights">${(pinned==='open'?[0]:[0,1,2,3]).map(i=>spotlight(valid[i],i,awards.has(valid[i]?.id))).join('')}</section><section class="all-ranks columns-${columns} ${count>48?'dense':''}" aria-label="전체 순위 ${count}칸">${Array.from({length:columns},(_,col)=>`<div class="rank-column">${Array.from({length:Math.min(per,count-col*per)},(_,row)=>{const i=col*per+row;return entry(list[i],i,awards.has(list[i]?.id));}).join('')}</div>`).join('')}</section><footer><span>${r?.status==='completed'?'FINAL · 최종 결과':'LIVE · 잠정 순위'} · 네 번 중 가장 빠른 기록 · 동점은 공동 순위</span><b class="movement-legend">${rankComparisonLabel(list)} · <span class="up">▲ 상승</span> <span class="down">▼ 하락</span> — 유지</b><span>${['awana','open'].includes(pinned)?'이 부문 고정 화면':'TV 부문 자동 전환'}</span></footer></div>`;
}
export function renderCombined(state) {
  const task=scheduledRace(state),finished=state.meeting?.status==='completed';
  return `<div class="full-board combined-board"><header class="board-header"><div><div class="kicker">AWANA GRAND PRIX <span>● ${finished?'FINAL':'LIVE'}</span></div><h1>전체 순위 <em>${finished?'본선 최종 결과':task?`본선 ${task.run+1}라운드`:'본선 4라운드'}</em><small>네 레인, 하나의 최고 기록</small></h1></div></header><section class="division-boards">${['awana','open'].map(key=>{
    const {d,r,list,count}=boardData(state,key),active=task?.division===key;
    const columns=key==='awana'?(count>24?3:2):1,per=Math.ceil(count/columns),valid=list.filter(p=>Number.isFinite(p.best)),awards=awardContenders(state,key,list);
    return `<section class="division-board ${active?'on-air':''}" data-board-division="${key}"><header><div><h2>${d.name}</h2><span class="division-status">${r?.status==='completed'?'최종 결과':active?'지금 달리는 부문':'누적 순위'}</span></div><div class="division-progress"><strong>${list.length} / ${count}명</strong><small>기록 입력</small></div></header><div class="division-spotlights ${key==='open'?'single-winner':''}">${(key==='awana'?[0,1,2,3]:[0]).map(i=>spotlight(valid[i],i,awards.has(valid[i]?.id))).join('')}</div><div class="dual-ranks columns-${columns}" aria-label="${d.name} 순위 ${count}칸">${Array.from({length:columns},(_,col)=>`<div class="rank-column">${Array.from({length:Math.min(per,count-col*per)},(_,row)=>{const i=col*per+row;return entry(list[i],i,awards.has(list[i]?.id));}).join('')}</div>`).join('')}</div><p class="division-footer">${rankComparisonLabel(list)} · 누적 최고 기록 기준</p></section>`;
  }).join('')}</section><footer><span>4라운드 중 가장 빠른 기록 · 동점은 공동 순위</span><b class="movement-legend"><span class="up">▲ 상승</span> <span class="down">▼ 하락</span> — 유지 · NEW 첫 기록</b><span>어와나 · 일반부 함께 보기</span></footer></div>`;
}
if (typeof document !== 'undefined') {
  const pinned=new URLSearchParams(location.search).get('division');
  connect(state=>{$('#board').innerHTML=renderBoard(state,pinned);});
  $('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('#fullscreen').title='F11로 전체 화면';}});
}


