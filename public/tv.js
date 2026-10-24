import { $, escape as e, current, fmt, rows, lanes, connect, isFour, laneRecords, phases, eventSchedule, groupNumber } from './common.js';

const PAGE_SIZE = 8;
let state, page = 0, viewKey;
const star = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 1 3.4 6.9 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6L5.2 22l1.3-7.6L1 9l7.6-1.1z"/></svg>';
const trophy = '<svg class="trophy" viewBox="0 0 160 160" aria-hidden="true"><defs><linearGradient id="gold" x2=".8" y2="1"><stop stop-color="#fff7ad"/><stop offset=".55" stop-color="#ffcb31"/><stop offset="1" stop-color="#ef9e17"/></linearGradient></defs><ellipse cx="80" cy="145" rx="50" ry="8" fill="#002867" opacity=".15"/><path d="M46 36H20v16q0 31 36 32M114 36h26v16q0 31-36 32" fill="none" stroke="#ffce3c" stroke-width="12"/><path d="M43 20h74v37q0 40-37 44-37-4-37-44z" fill="url(#gold)"/><path d="M73 98h14v27h20v15H53v-15h20z" fill="url(#gold)"/><path d="m80 38 7 14 16 3-12 11 3 16-14-8-14 8 3-16-12-11 16-3z" fill="#fff8bc"/><path d="M54 29v27q0 16 8 23" fill="none" stroke="white" opacity=".65" stroke-width="6" stroke-linecap="round"/></svg>';

// Shared portrait slot. Until a local photo is provided, show a friendly silhouette.
function profile(p) {
  const src = typeof p?.photoUrl === 'string' && /^\/(?!\/)[^\\]*$/.test(p.photoUrl) ? p.photoUrl : '';
  return `<span class="profile-photo" role="img" aria-label="${src ? e(p.name) + ' 프로필 사진' : '기본 프로필 아이콘'}"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-4c0-8 7-12 15-12s15 4 15 12v4z"/></svg>${src ? `<img src="${e(src)}" alt="" decoding="async">` : ''}</span>`;
}
// A missing photo must never leave a broken-image symbol on the TV.
document.addEventListener('error', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.parentElement?.classList.contains('profile-photo')) {
    img.parentElement.setAttribute('aria-label', '기본 프로필 아이콘');
    img.remove();
  }
}, true);

function carCaption(p) {
  const name = p?.carName || (p ? '자동차 이름 미등록' : '출발을 기다려요');
  if (p?.carPhotoUrl) return `<div class="car-caption" title="${e(name)}"><img class="car-thumbnail" src="${e(p.carPhotoUrl)}" alt=""><span>${e(name)}</span></div>`;
  return `<div class="car-caption ${p?.carName ? '' : 'unnamed'}" title="${e(name)}"><svg viewBox="0 0 24 16" aria-hidden="true"><path d="m5 2-2 6H1v6h2v2h3v-2h12v2h3v-2h2V8h-2l-2-6zm1.5 2h11L19 8H5zM4 10h3v2H4zm13 0h3v2h-3z"/></svg><span>${e(name)}</span></div>`;
}

function context() {
  const display = state.display, d = state.divisions[display.division], r = current(d);
  return { display, d, r, list: rows(d, r) };
}
function roundPath(display, r) {
  return `<nav class="round-path" aria-label="본선 라운드">${phases.map((name,i)=>`<span class="${display.run===i?'active':''}">${name}</span>`).join('<i>›</i>')}</nav>`;
}
function hero(d, r, display, leader, winner) {
  const mode = winner ? 'winner' : display.mode === 'ranking' && leader ? 'leader' : !r ? 'waiting' : 'race';
  let copy;
  if (mode === 'winner') copy = `<span class="hero-kicker">오늘의 챔피언을 소개합니다</span><div class="person-line hero-person">${profile(winner)}<h1 class="champion-name">${e(winner.name)}</h1></div><div class="champion-record">${fmt(winner.best)}<small>초</small><span>CAR #${e(winner.car)}${winner.carName ? ` · ${e(winner.carName)}` : ''}</span></div><p class="hero-message">멋진 레이스에 큰 박수를 보내 주세요!</p>`;
  else if (mode === 'leader') copy = `<span class="hero-kicker">${listLeaderLabel(d, r, leader)}</span><div class="person-line hero-person">${profile(leader)}<h1 class="leader-name">${e(leader.name)}</h1></div><div class="champion-record">${fmt(leader.best)}<small>초</small><span>현재 ${leader.rank}위 · #${e(leader.car)}${leader.carName ? ` · ${e(leader.carName)}` : ''}</span></div><p class="hero-message">끝까지 달려 봐요. 주인공은 바로 우리!</p>`;
  else copy = `<span class="hero-kicker">작은 자동차, 커다란 도전!</span><h1 class="poster-title">READY.<br>SET. <em>GO!</em></h1><p class="hero-message">${r ? '우리의 레이스를 함께 응원해요!' : '두근두근, 곧 레이스가 시작됩니다.'}</p>`;
  return `<section class="hero hero-${mode}"><img class="hero-art" src="/race-hero.jpg" alt="파란 트랙을 달리는 노란색 나무 경주 자동차 한 대"><div class="hero-shade"></div><div class="hero-meta"><span class="division-badge">${d.name}<b>${r ? `본선 ${display.run+1}라운드` : '본선 준비'}</b></span>${roundPath(display, r)}</div><div class="hero-copy">${copy}</div>${winner ? `<div class="trophy-wrap">${trophy}<span>CHAMPION</span></div>` : '<span class="cheer-sticker">꿈을 싣고<br><b>달려요!</b><i>★</i></span>'}<span class="hero-footnote">4 LANES &nbsp; / &nbsp; 4 RUNS &nbsp; / &nbsp; ONE BEST TIME</span></section>`;
}
function listLeaderLabel(d, r, leader) {
  const tied = rows(d, r).filter(p => p.rank === leader.rank).length;
  return tied > 1 ? `지금, 가장 빠른 기록 · 공동 ${leader.rank}위 ${tied}명` : '지금, 가장 빠른 기록';
}
function raceCards(d, r, display, list) {
  const ids = r ? lanes(r, display.heat, display.run) : [null, null, null, null];
  return `<section class="race-deck"><div class="deck-heading"><h2>${r ? `<b>${String(groupNumber(state,display.division,display.heat)).padStart(2, '0')}</b>조 <span>본선 ${display.run + 1}라운드</span>` : '네 개의 레인, 하나의 설렘'}</h2><span class="deck-note">${r ? '이번 주행 기록 · 초' : '출발을 기다리고 있어요'}</span></div><div class="lane-grid">${ids.map((id, i) => {
    const p = list.find(p => p.id === id), time = p?.times[display.run];
    const history = (p ? laneRecords(r,p.id) : [null,null,null,null]).map((t,l) => {
      const best = Number.isFinite(t) && t === p?.best;
      return `<div class="${l===i?'current-lane ':''}${best?'best-record':''}" aria-label="${l+1}레인${l===i?' 현재 주행':''}${best?' 최고 기록':''} ${fmt(t)}"><small><span>${l+1}레인</span>${best?'<em class="best-label" aria-hidden="true">★ BEST</em>':''}</small><b>${fmt(t)}</b></div>`;
    }).join('');
    return `<article class="lane-card split-card lane-${i + 1} ${!p ? 'vacant' : ''}">${profile(p)}<div class="card-details"><div class="lane-top"><span class="lane-id">${i + 1}</span><span>${i + 1}레인</span><b>${p ? '#' + e(p.car) : ''}</b></div><h3 title="${p ? e(p.name) : ''}">${p ? e(p.name) : r ? '빈 레인' : '출발 대기'}</h3><div class="lane-time ${time === 'DNF' ? 'dnf' : ''}">${p ? time === null ? '<span class="ready-label">READY</span>' : fmt(time) : '<span class="ready-label">—</span>'}</div></div>${carCaption(p)}${isFour(r)?`<div class="lane-history" aria-label="레인별 누적 기록">${history}</div>`:''}</article>`;
  }).join('')}</div></section>`;
}
function podium(list) {
  const valid = list.filter(p => Number.isFinite(p.best));
  return `<section class="race-deck podium-deck"><div class="deck-heading"><h2>모두가 빛난 오늘의 레이스</h2><span class="deck-note">FINAL RESULTS</span></div><div class="podium-grid">${valid.slice(0, 3).map((p, i) => `<article class="podium-card split-card podium-${i + 1}">${profile(p)}<div class="card-details"><span class="medal">${star}<b>${i + 1}</b></span><small>${['GOLD', 'SILVER', 'BRONZE'][i]} · #${e(p.car)}</small><h3>${e(p.name)}</h3><strong>${fmt(p.best)}<small>초</small></strong></div>${carCaption(p)}</article>`).join('')}</div></section>`;
}
function rankCard(p) {
  if (!p) return '<article class="ranking-row empty-ranking"><span>✦</span><p>다음 주인공을 기다려요</p></article>';
  const tier = p.rank && p.rank <= 3 ? p.rank : 'base';
  return `<article class="ranking-row rank-tier-${tier} ${!p.rank ? 'unranked' : ''}"><div class="rank-badge">${p.rank ? `<b>${p.rank}</b><small>위</small>` : '<small>대기</small>'}</div><div class="rank-main"><h3 title="${e(p.name)}">${e(p.name)}</h3></div><div class="rank-result ${p.best >= 10000 ? 'long-time' : ''}"><strong>${Number.isFinite(p.best) ? fmt(p.best) : p.complete ? 'DNF' : '대기'}</strong>${Number.isFinite(p.best) ? '<small>초</small>' : ''}${p.tieBreak != null ? `<span class="rank-tiebreak">재경기 ${fmt(p.tieBreak)}</span>` : ''}</div><div class="rank-photo">${profile(p)}</div><div class="rank-car"><span>#${e(p.car)}</span>${carCaption(p)}</div></article>`;
}

function renderBoard() {
  if (!state) return;
  const { d, r, display, list } = context();
  const final = r?.status==='completed', rankingMode = display.mode === 'ranking' && !final;
  const boardList = list.filter(p => isFour(r)?p.times.some(t=>t!==null):p.complete);
  const pages = rankingMode || final ? Math.max(1, Math.ceil(boardList.length / PAGE_SIZE)) : 1;
  page %= pages;
  const offset = page * PAGE_SIZE, completed = list.filter(p => p.complete).length;
  const slots = Array.from({ length: final ? Math.min(PAGE_SIZE,Math.max(4,boardList.length)) : PAGE_SIZE }, (_, i) => boardList[offset + i]);
  $('#leaderboard').innerHTML = `<header class="board-heading"><div class="board-eyebrow"><span>${final ? 'FINAL RESULTS' : 'LIVE LEADERBOARD'}</span><span class="board-live">${final ? 'FINAL' : 'LIVE'}</span></div><h2>${final ? '최종 순위' : r ? rankingMode ? '전체 순위' : '실시간 순위' : '출발을 기다려요'}</h2><div class="board-sub"><span>${d.name} · ${r ? `본선 ${display.run+1}라운드` : '본선 준비'}</span><b>${r ? `${completed} / ${list.length}명 완료` : `${d.participants.length}명 참가`}</b></div><progress value="${completed}" max="${Math.max(1, list.length)}" aria-label="기록 입력 완료"></progress></header><div class="rank-grid ${final ? 'final-grid' : ''}">${slots.map(rankCard).join('')}</div><footer class="board-footer"><div class="advance-note">${final ? '<b>모든 참가자에게 큰 박수를!</b>' : '<b>함께 달리고, 함께 응원해요!</b>'}</div><div class="board-legend"><span>네 번 중 <b>가장 빠른 기록</b> 기준${final ? '' : ' · 잠정 순위'}</span><span>${rankingMode ? `${page + 1} / ${pages}` : final ? 'FINAL' : r ? 'TOP 8' : 'READY'}</span></div></footer>`;
}
function render() {
  const { display, d, r, list } = context();
  const key = `${display.division}-${r?.id}-${display.mode}-${Boolean(r?.winnerId)}`;
  if (key !== viewKey) { page = 0; viewKey = key; }
  const winner = r?.winnerId && list.find(p => p.id === r.winnerId);
  const leader = list.find(p => Number.isFinite(p.best));
  $('#event-title').textContent = state.title;
  $('#screen').classList.toggle('four-lane-screen',isFour(r));
  $('#screen').innerHTML = hero(d, r, display, leader, winner) + (winner ? podium(list) : raceCards(d, r, display, list));
  if(isFour(r)) {
    const schedule=eventSchedule(state),index=schedule.findIndex(t=>t.division===display.division&&t.heat===display.heat&&t.run===display.run),next=schedule[index+1];
    $('#ticker-label').textContent=state.meeting?.status==='completed'?'WELL DONE!':'UP NEXT';
    $('#ticker-text').textContent=state.meeting?.status==='completed'?'네 레인을 완주한 모든 참가자에게 큰 박수를!':next?`다음 ${state.divisions[next.division].name} ${groupNumber(state,next.division,next.heat)}조 · 본선 ${next.run+1}라운드`:'마지막 주행 · 기록 확인 후 최종 순위를 확정해요';
  } else {
    $('#ticker-label').textContent='CHEER UP!';
    $('#ticker-text').textContent='작은 자동차에 담긴 커다란 꿈. 함께 응원해 주세요!';
  }
  renderBoard();
}
connect(next => { state = next; render(); });
setInterval(() => { if (state?.display.mode === 'ranking') { page++; renderBoard(); } }, 8000);
function clock() { $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }); }
clock(); setInterval(clock, 1000);
$('#fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('#fullscreen').title = 'F11로 전체 화면'; } });


