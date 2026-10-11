import { $, escape as e, fmt, current, rows, lanes, ranking, api, connect, nextCount } from './common.js';

let state, revision, division = 'awana', heat = 0, run = 0, history = -1, loggedIn = false, dirty = false, saving = false;
const app = $('#app');
function notify(text, bad = false) {
  const box = $('#message'); box.textContent = text; box.className = bad ? 'error' : 'success'; box.hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { box.hidden = true; }, bad ? 12000 : 5000);
}
function clean() { return !dirty || confirm('입력 중인 내용이 있습니다. 저장하지 않고 이동할까요?'); }
function setLogin(value) { loggedIn = value; $('#login').hidden = value; app.hidden = !value; $('#logout').hidden = !value; if (value && state) render(); }
function render() {
  if (!loggedIn || !state) return;
  revision = state.revision; dirty = false;
  const d = state.divisions[division], active = current(d), r = history < 0 ? active : d.rounds[history];
  if (active) heat = Math.min(heat, active.groups.length - 1);
  const done = active ? Object.values(active.results).filter(x => x.times.every(t => t !== null)).length : 0;
  app.innerHTML = `<section class="page-heading"><div><span class="eyebrow">RACE CONTROL</span><h1>${e(state.title)}</h1><p>두 번의 기회, 가장 빠른 한 번의 기록.</p></div><div class="export"><a class="button ghost" href="/api/csv">기록 CSV ↓</a><a class="button ghost" href="/api/export">전체 기록 JSON ↓</a></div></section>
  <nav class="division-tabs">${Object.entries(state.divisions).map(([key, v]) => `<button data-division="${key}" class="${key === division ? 'selected' : ''}">${v.name}<span>${v.participants.length}명</span></button>`).join('')}</nav>
  <div class="stats"><div><small>현재 라운드</small><strong>${active?.name || '참가자 등록'}</strong></div><div><small>참가 인원</small><strong>${active?.entrantIds.length ?? d.participants.length}<em>명</em></strong></div><div><small>기록 입력 완료</small><strong>${done}<em>/ ${active?.entrantIds.length || 0}명</em></strong></div><div><small>${active?.advance === 0 ? '결승 상태' : '다음 라운드'}</small><strong>${active ? active.advance ? `상위 ${active.advance}명` : active.status === 'completed' ? '최종 확정' : '우승 결정' : `상위 ${nextCount(division)}명`}</strong></div></div>
  <div id="stale" class="notice" hidden>새 변경 사항이 있습니다. 입력 내용은 유지했습니다. <button id="refresh">최신 내용 불러오기</button></div>
  ${!active ? registration(d) : racePanel(d, active)}
  ${carNames(d)}
  ${r ? `<section class="card"><div class="section-head"><div><span class="eyebrow">LEADERBOARD</span><h2>${history < 0 ? '현재 순위' : '이전 라운드 기록'}</h2></div><label>기록 보기 <select id="history"><option value="-1" ${history < 0 ? 'selected' : ''}>현재 · ${active.name}</option>${d.rounds.slice(0, -1).map((old, i) => `<option value="${i}" ${history === i ? 'selected' : ''}>${old.name} · 보존 기록</option>`).join('')}</select></label></div><p class="hint">${r.advance ? `상위 ${r.advance}명 진출 · 진행 중 순위는 잠정 순위입니다.` : '결승 순위'} 최고 기록 동점은 공동 순위로 표시합니다. 진출선 동점은 재경기로 결정합니다.</p><div class="table-scroll">${ranking(d, r)}</div></section>` : ''}
  <details class="card"><summary>행사 이름 및 운영 기록</summary><form id="title-form" class="inline-form"><label>행사 이름<input name="title" value="${e(state.title)}" maxlength="60" required></label><button class="ghost">이름 저장</button></form><button id="audit" class="ghost">최근 변경 내역 보기</button><div id="audit-list"></div></details>`;
}
function carNames(d) {
  if (!d.participants.length) return '';
  return `<details class="card"><summary>자동차 이름 등록·수정</summary><p class="hint">이름은 TV 카드 아래에 표시됩니다. 최대 24자이며, 짧은 이름이 잘 보입니다.</p><form id="car-name-form" class="inline-form"><label>참가자<select name="id" id="car-owner">${d.participants.map(p => `<option value="${p.id}">#${e(p.car)} ${e(p.name)}</option>`).join('')}</select></label><label>자동차 이름<input name="carName" id="car-name-input" value="${e(d.participants[0].carName || '')}" maxlength="24" placeholder="예: 번개호"></label><button class="primary">자동차 이름 저장</button></form></details>`;
}
function registration(d) {
  return `<div class="host-grid"><section class="card"><span class="eyebrow">01 / CHECK IN</span><h2>참가자 등록</h2><p>한 줄에 한 명씩 입력하세요. 자동차 이름은 선택 입력이며, 이름만 입력하면 차량 번호가 자동으로 부여됩니다.</p><form id="participants-form"><label for="entries">이름 또는 차량번호,이름,자동차이름</label><textarea id="entries" name="entries" rows="8" placeholder="1,김하늘,번개호&#10;2,박서준,슈퍼로켓&#10;이민준" required></textarea><button class="primary">명단 추가</button></form><p class="hint">권장 인원: 어와나 40~45명 · 일반부 18~20명<br>시작 후 명단이 잠깁니다. 참가자와 차량 번호를 먼저 확인하세요.</p></section><section class="card"><div class="section-head"><h2>출발 준비 <span class="muted">${d.participants.length}명</span></h2><button id="start" class="primary" ${d.participants.length < nextCount(division) ? 'disabled' : ''}>예선 시작 →</button></div><p class="hint">3~4명씩 무작위 균등 편성 · 2차 주행은 레인 두 칸 이동</p><ul class="participants">${d.participants.map(p => `<li><span><b class="car">#${e(p.car)}</b> ${e(p.name)}${p.carName ? `<small class="participant-car-name">${e(p.carName)}</small>` : ''}</span><button class="small ghost" data-delete="${p.id}" aria-label="${e(p.name)} 삭제">삭제</button></li>`).join('') || '<li class="empty">첫 번째 참가자를 등록해 주세요.</li>'}</ul></section></div>`;
}
function racePanel(d, r) {
  const ids = lanes(r, heat, run), data = rows(d, r);
  const ties = data.filter(p => Number.isFinite(p.best) && data.some(q => q.id !== p.id && q.best === p.best));
  const display = state.display;
  const winner = r.winnerId && d.participants.find(p => p.id === r.winnerId);
  return `${winner ? `<section class="winner-banner"><span>CHAMPION · ${d.name}</span><h2>🏆 ${e(winner.name)} <small>#${e(winner.car)}</small></h2></section>` : ''}
  <div class="host-grid"><section class="card"><div class="section-head"><div><span class="eyebrow">02 / TIMEKEEPING</span><h2>${r.name} 기록 입력</h2></div><span class="tag">${r.status === 'completed' ? '종료 · 읽기 전용' : '진행 중'}</span></div>
  <div class="race-controls"><label>경기 조<select id="heat">${r.groups.map((g, i) => `<option value="${i}" ${heat === i ? 'selected' : ''}>${i + 1}조 · ${g.length}명${g.every(id => r.results[id].times.every(t => t !== null)) ? ' ✓' : ''}</option>`).join('')}</select></label><label>주행<select id="run"><option value="0" ${run === 0 ? 'selected' : ''}>1차 주행</option><option value="1" ${run === 1 ? 'selected' : ''}>2차 주행 · 레인 교체</option></select></label><button id="broadcast" class="ghost">이 경기를 TV에 표시</button></div>
  <form id="records-form"><div class="lane-inputs">${ids.map((id, i) => {
    const p = d.participants.find(p => p.id === id), value = id && r.results[id].times[run];
    return `<div class="lane-input lane-${i + 1}"><span class="lane-label">LANE ${i + 1}</span>${id ? `<div class="driver"><span class="car">#${e(p.car)}</span><b>${e(p.name)}</b></div><label for="time-${id}">기록 (초)<input id="time-${id}" name="${id}" value="${value === null ? '' : fmt(value)}" placeholder="0.000" autocomplete="off" inputmode="decimal" required ${r.status !== 'active' ? 'disabled' : ''}></label><button type="button" class="small ghost" data-dnf="${id}" ${r.status !== 'active' ? 'disabled' : ''}>미완주 DNF</button>` : '<div class="empty">빈 레인</div>'}</div>`;
  }).join('')}</div><label>수정 사유 <span class="muted">기존 기록을 수정할 때 필수</span><input name="reason" maxlength="200" placeholder="예: 2레인 스톱워치 재확인" ${r.status !== 'active' ? 'disabled' : ''}></label><div class="form-actions"><button class="primary" ${r.status !== 'active' ? 'disabled' : ''}>${heat + 1}조 ${run + 1}차 기록 저장</button><button type="button" id="next" class="ghost">다음 주행 →</button></div></form>
  <p class="hint">저장 전 빈칸은 미입력입니다. 새 라운드 기록은 0.000부터 시작하며, 입력 전에는 순위에 반영하지 않습니다. DNF는 다른 한 번의 유효 기록에 영향을 주지 않습니다.</p></section>
  <aside class="card"><span class="eyebrow">03 / RACE DIRECTOR</span><h2>진행 및 TV 화면</h2><p class="broadcast-note">현재 송출: ${state.divisions[display.division].name}<br>${display.mode === 'ranking' ? '전체 순위' : `${display.heat + 1}조 · ${display.run + 1}차 주행`}</p><button id="rank-tv" class="ghost full">이 부문 순위 TV에 표시</button><p class="hint">TV 화면은 자동으로 갱신됩니다. 전체 순위는 8명씩 8초마다 넘어갑니다.</p><hr><h3>${r.advance ? `${r.name} 종료 → 상위 ${r.advance}명 진출` : '결승 종료 → 최종 순위 확정'}</h3><p class="hint">모든 기록 입력과 진출선 동점 해소 후 진행할 수 있습니다. 종료한 라운드는 수정할 수 없으며 기록이 보존됩니다.</p><button id="finish" class="primary full" ${r.status !== 'active' ? 'disabled' : ''}>${r.name} 종료${r.advance ? ' 및 자동 진출' : ' 및 결과 확정'}</button><hr><details><summary>전체 경기 편성표</summary>${r.groups.map((group, i) => `<div class="schedule"><b>${i + 1}조</b>${group.map((id, j) => { const p = d.participants.find(p => p.id === id); return `<p>#${e(p.car)} ${e(p.name)} <small>${j + 1} → ${(j + 2) % 4 + 1}레인</small></p>`; }).join('')}</div>`).join('')}</details></aside></div>
  ${ties.length && r.status === 'active' ? `<details class="card"><summary>동점자 재경기 입력 · ${ties.length}명</summary><p>최고 기록이 같은 참가자끼리 재경기를 진행하세요. 진출선에 걸린 동점자 모두의 기록이 필요합니다. 재경기도 동점이면 다시 경기한 기록으로 모두 갱신하세요.</p><form id="tie-form" class="inline-form"><label>동점 참가자<select name="id">${ties.map(p => `<option value="${p.id}">#${e(p.car)} ${e(p.name)} · 최고 ${fmt(p.best)} / 재경기 ${fmt(p.tieBreak)}</option>`).join('')}</select></label><label>재경기 기록 (초 또는 DNF)<input name="time" placeholder="3.215" required></label><label>재경기 사유<input name="reason" placeholder="예: 16위 진출선 동점 재경기" maxlength="200" required></label><button class="primary">재경기 저장</button></form></details>` : ''}`;
}
async function action(name, body = {}) {
  saving = true;
  try {
    state = await api(name, { revision, division, ...body });
    dirty = false; render(); notify('저장했습니다. 관객 화면에 반영됩니다.'); return true;
  } catch (err) {
    notify(err.message, true);
    if (err.status === 409) $('#stale').hidden = false;
    if (err.status === 401) setLogin(false);
    return false;
  } finally { saving = false; }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('login', { pin: $('#pin').value }); $('#pin').value = ''; state = await api('state'); setLogin(true); }
  catch (err) { notify(err.message, true); }
});
$('#logout').addEventListener('click', async () => { if (clean()) { try { await api('logout', {}); setLogin(false); } catch (err) { notify(err.message, true); } } });
app.addEventListener('input', event => { if (event.target.closest('form')) dirty = true; });
app.addEventListener('change', event => {
  const id = event.target.id;
  if (id === 'car-owner') { $('#car-name-input').value = state.divisions[division].participants.find(p => p.id === event.target.value)?.carName || ''; return; }
  if (!['heat', 'run', 'history'].includes(id)) return;
  if (!clean()) { event.target.value = id === 'heat' ? heat : id === 'run' ? run : history; return; }
  if (id === 'heat') heat = Number(event.target.value);
  if (id === 'run') run = Number(event.target.value);
  if (id === 'history') history = Number(event.target.value);
  render();
});
app.addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  const form = event.target, fd = new FormData(form), r = current(state.divisions[division]);
  if (form.getAttribute('id') === 'participants-form') {
    const entries = fd.get('entries').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => { const parts = line.split(',').map(s => s.trim()); return parts.length === 1 ? { name: line } : { car: parts[0], name: parts[1], carName: parts.slice(2).join(',').trim() }; });
    await action('participants', { entries });
  }
  if (form.getAttribute('id') === 'records-form') {
    const records = Object.fromEntries(lanes(r, heat, run).filter(Boolean).map(id => [id, fd.get(id).trim().toUpperCase()]));
    await action('records', { roundId: r.id, heat, run, records, reason: fd.get('reason') });
  }
  if (form.getAttribute('id') === 'tie-form') await action('tiebreak', { roundId: r.id, ...Object.fromEntries(fd) });
  if (form.getAttribute('id') === 'car-name-form') await action('car-name', { id: fd.get('id'), carName: fd.get('carName').trim() });
  if (form.getAttribute('id') === 'title-form') await action('title', { title: fd.get('title') });
});
app.addEventListener('click', async event => {
  try {
  const b = event.target.closest('button'); if (!b || saving) return;
  if (b.dataset.dnf) { document.getElementById('time-' + b.dataset.dnf).value = 'DNF'; dirty = true; return; }
  if (b.dataset.division && clean()) { division = b.dataset.division; heat = run = 0; history = -1; render(); }
  if (b.dataset.delete && confirm('이 참가자를 삭제할까요?')) await action('participant-delete', { id: b.dataset.delete });
  if (b.id === 'start' && clean() && confirm('명단을 확정하고 예선을 시작할까요? 시작 후 명단은 잠깁니다.')) await action('start');
  if (b.id === 'refresh' && clean()) { state = await api('state'); render(); }
  if (b.id === 'broadcast' || b.id === 'rank-tv') { if (clean()) await action('display', { heat, run, mode: b.id === 'broadcast' ? 'race' : 'ranking' }); }
  const r = current(state.divisions[division]);
  if (b.id === 'next' && clean()) {
    if (!r.groups[heat].every(id => r.results[id].times[run] !== null) && !confirm('현재 주행 기록이 아직 없습니다. 다음 주행으로 이동할까요?')) return;
    if (run === 0) run = 1; else if (heat < r.groups.length - 1) { heat++; run = 0; } else { notify('마지막 주행입니다. 모든 기록을 확인한 뒤 라운드를 종료하세요.'); return; }
    await action('display', { heat, run, mode: 'race' });
  }
  if (b.id === 'finish' && clean() && confirm(`${r.name}을 종료할까요?${r.advance ? ` 상위 ${r.advance}명이 새 라운드로 등록되고 새 기록은 0으로 초기화됩니다.` : ' 최종 순위가 확정됩니다.'} 기존 기록은 보존되며 종료 후 수정할 수 없습니다.`)) { heat = run = 0; history = -1; await action('finish', { roundId: r.id }); }
  if (b.id === 'audit') {
    try { const data = await api('audit'); $('#audit-list').innerHTML = data.map(item => `<details><summary>${new Date(item.at).toLocaleString('ko-KR')} · ${e(item.action)}</summary><pre>${e(JSON.stringify(JSON.parse(item.detail), null, 2))}</pre></details>`).join('') || '<p>변경 내역이 없습니다.</p>'; }
    catch (err) { notify(err.message, true); }
  }
  } catch (err) { notify(err.message || '연결을 확인하고 다시 시도하세요.', true); }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try {
  state = await api('state');
  division = state.display.division; heat = state.display.heat; run = state.display.run;
  const session = await api('session'); setLogin(session.authenticated);
  connect(next => { state = next; if (!loggedIn || saving) return; if (dirty) { if (state.revision !== revision) $('#stale').hidden = false; } else render(); });
} catch (err) { notify('서버에 연결할 수 없습니다. 새로고침해 주세요. ' + err.message, true); }
