import { $, escape as e, current, rows, fmt, connect } from './common.js';

export function boardData(state, pinned) {
  const key = ['awana','open'].includes(pinned) ? pinned : state.display.division;
  const d = state.divisions[key], r = current(d);
  return {key,d,r,list:rows(d,r).filter(p=>p.complete),count:r?.entrantIds.length || d.participants.length || (key==='awana'?40:18)};
}
function photo(p) {
  return `<span class="portrait">${p?.photoUrl?`<img src="${e(p.photoUrl)}" alt="">`:'<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-4c0-8 7-12 15-12s15 4 15 12v4z"/></svg>'}</span>`;
}
function entry(p, index) {
  if (!p) return `<article class="entry empty"><b>${index+1}</b><span class="empty-line"></span><small>기록 대기</small></article>`;
  return `<article class="entry tier-${p.rank && p.rank<=3?p.rank:'base'}"><b class="place">${p.rank || '—'}</b>${photo(p)}<div class="identity"><strong title="${e(p.name)}">${e(p.name)}</strong><small>#${e(p.car)} · ${e(p.carName || '자동차 이름 미등록')}</small></div><div class="result"><strong>${Number.isFinite(p.best)?fmt(p.best):'DNF'}</strong><small>${p.tieBreak!==null?`재경기 ${fmt(p.tieBreak)}`:Number.isFinite(p.best)?'초 · BEST':'미완주'}</small></div></article>`;
}
function spotlight(p,index) {
  return `<article class="spotlight spot-${index+1} ${p?'':'waiting'}"><div class="medal">${p?.rank || index+1}<small>PLACE</small></div>${photo(p)}<div class="spot-name"><small>${index===0?'가장 빠른 순간':index===1?'멋진 도전':'빛나는 레이스'}</small><h2>${p?e(p.name):'주인공을 기다려요'}</h2><span>${p?`#${e(p.car)} · ${e(p.carName || '')}`:'두 번의 도전, 하나의 최고 기록'}</span></div><strong class="spot-time">${p?fmt(p.best):'—'}<small>${p?'초':''}</small></strong></article>`;
}
export function renderBoard(state, pinned) {
  if (pinned==='both' || (!['awana','open'].includes(pinned) && current(state.divisions.awana)?.index>=1)) return renderCombined(state);
  const {d,r,list,count} = boardData(state,pinned);
  const columns=count>48?4:count>24?3:count>8?2:1, per=Math.ceil(count/columns);
  const valid=list.filter(p=>Number.isFinite(p.best));
  return `<div class="full-board"><header class="board-header"><div><div class="kicker">AWANA GRAND PRIX <span>● LIVE</span></div><h1>${d.name} <em>${r?.name || '예선 준비'}</em><small>실시간 전체 순위</small></h1></div><div class="progress-copy"><b>${list.length}<span> / ${count}명</span></b><small>두 번의 기록 입력 완료</small></div></header><section class="spotlights">${[0,1,2].map(i=>spotlight(valid[i],i)).join('')}</section><section class="all-ranks columns-${columns} ${count>48?'dense':''}" aria-label="전체 순위 ${count}칸">${Array.from({length:columns},(_,col)=>`<div class="rank-column">${Array.from({length:Math.min(per,count-col*per)},(_,row)=>{const i=col*per+row;return entry(list[i],i);}).join('')}</div>`).join('')}</section><footer><span>${r?.status==='completed'?'FINAL · 최종 결과':'LIVE · 잠정 순위'} · 두 번 중 더 빠른 기록 · 동점은 공동 순위</span><b>${r?.advance?`상위 ${r.advance}명 다음 라운드 진출`:r?'끝까지 도전한 모두에게 박수를!':'경기를 마치면 순위가 채워져요'}</b><span>${['awana','open'].includes(pinned)?'이 부문 고정 화면':'TV 부문 자동 전환'}</span></footer></div>`;
}
export function renderCombined(state) {
  return `<div class="full-board combined-board"><header class="board-header"><div><div class="kicker">AWANA GRAND PRIX <span>● LIVE</span></div><h1>함께 달리는 <em>그랑프리</em><small>부문별 실시간 순위</small></h1></div></header><section class="division-boards">${['awana','open'].map(key=>{
    const {d,r,list,count}=boardData(state,key),active=state.display.division===key;
    const columns=count>20?2:1,per=Math.ceil(count/columns);
    return `<section class="division-board ${active?'on-air':''}" data-board-division="${key}"><header><div><h2>${d.name} <em>${r?.name||'예선 준비'}</em></h2><span class="division-status">${r?.status==='completed'?'최종 결과':active&&r?'진행 중':'준비 / 대기'}</span></div><div class="division-progress"><strong>${list.length} / ${count}명</strong><small>두 번의 기록 입력 완료</small></div></header><div class="dual-ranks" style="grid-template-columns:repeat(${columns},minmax(0,1fr))" aria-label="${d.name} 순위 ${count}칸">${Array.from({length:columns},(_,col)=>`<div class="rank-column">${Array.from({length:Math.min(per,count-col*per)},(_,row)=>{const i=col*per+row;return entry(list[i],i);}).join('')}</div>`).join('')}</div><p class="division-footer">${r?.status==='completed'?'최종 순위 확정':r?.advance?`상위 ${r.advance}명 다음 라운드 진출`:'경기를 마치면 순위가 채워져요'}</p></section>`;
  }).join('')}</section><footer><span>두 번 중 더 빠른 기록 · 동점은 공동 순위</span><b>함께 달리고, 함께 응원해요!</b><span>새 라운드는 빈 순위표로 시작</span></footer></div>`;
}
if (typeof document !== 'undefined') {
  const pinned=new URLSearchParams(location.search).get('division');
  connect(state=>{$('#board').innerHTML=renderBoard(state,pinned);});
  $('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('#fullscreen').title='F11로 전체 화면';}});
}
