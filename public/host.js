import { $, escape as e, fmt, current, rows, lanes, ranking, api, connect, nextCount, parseRoster, orderedGroups, numberedGroups, clearGroupSlot } from './common.js';

let state, revision, division = 'awana', heat = 0, run = 0, history = -1, loggedIn = false, dirty = false, saving = false;
let passwordRequired = true;
let pendingState = null;
let editorId = null, photoDraft = {}, mediaBusy = 0;
const app = $('#app');
function notify(text, bad = false) {
  const box = $('#message'); box.textContent = text; box.className = bad ? 'error' : 'success'; box.hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { box.hidden = true; }, bad ? 12000 : 5000);
}
function clean() { return !dirty || confirm('입력 중인 내용이 있습니다. 저장하지 않고 이동할까요?'); }
function setLogin(value) { loggedIn = value; $('#login').hidden = value; app.hidden = !value; $('#logout').hidden = !value || !passwordRequired; if (value && state) render(); }
function render() {
  if (!loggedIn || !state) return;
  if (!saving && pendingState) {
    if (pendingState.revision > state.revision) state = pendingState;
    pendingState = null;
  }
  revision = state.revision; dirty = false;
  const d = state.divisions[division], active = current(d), r = history < 0 ? active : d.rounds[history];
  if (active) heat = Math.min(heat, active.groups.length - 1);
  else { heat = run = 0; history = -1; }
  const done = active ? Object.values(active.results).filter(x => x.times.every(t => t !== null)).length : 0;
  app.innerHTML = `<section class="page-heading"><div><span class="eyebrow">RACE CONTROL</span><h1>${e(state.title)}</h1><p>두 번의 기회, 가장 빠른 한 번의 기록.</p></div><div class="export"><a class="button ghost" href="/api/csv">기록 CSV ↓</a><a class="button ghost" href="/api/export">전체 기록 JSON ↓</a></div></section>
  <nav class="division-tabs">${Object.entries(state.divisions).map(([key, v]) => `<button data-division="${key}" class="${key === division ? 'selected' : ''}">${v.name}<span>${v.participants.length}명</span></button>`).join('')}</nav>
  <div class="stats"><div><small>현재 라운드</small><strong>${active?.name || '참가자 등록'}</strong></div><div><small>참가 인원</small><strong>${active?.entrantIds.length ?? d.participants.length}<em>명</em></strong></div><div><small>기록 입력 완료</small><strong>${done}<em>/ ${active?.entrantIds.length || 0}명</em></strong></div><div><small>${active?.advance === 0 ? '결승 상태' : '다음 라운드'}</small><strong>${active ? active.advance ? `상위 ${active.advance}위` : active.status === 'completed' ? '최종 확정' : '우승 결정' : `상위 ${nextCount(division)}위`}</strong></div></div>
  <div id="stale" class="notice" hidden>새 변경 사항이 있습니다. 입력 내용은 유지했습니다. <button id="refresh">최신 내용 불러오기</button></div>
  <p class="notice">부문별 경기와 기록은 따로 보관됩니다. 어와나 예선 종료 후 일반부 탭에서 예선을 시작하세요. 탭 선택만으로 TV는 바뀌지 않으며, 시작 또는 TV 표시 버튼을 누르면 전환됩니다.</p>
  ${!active ? registration(d) : racePanel(d, active)}
  ${manualGroups(d, active)}
  ${roster(d)}
  ${r ? `<section class="card"><div class="section-head"><div><span class="eyebrow">LEADERBOARD</span><h2>${history < 0 ? '현재 순위' : '이전 라운드 기록'}</h2></div><label>기록 보기 <select id="history"><option value="-1" ${history < 0 ? 'selected' : ''}>현재 · ${active.name}</option>${d.rounds.slice(0, -1).map((old, i) => `<option value="${i}" ${history === i ? 'selected' : ''}>${old.name} · 보존 기록</option>`).join('')}</select></label></div><p class="hint">${r.advance ? `상위 ${r.advance}위까지 진출 · 진행 중 순위는 잠정 순위입니다.` : '결승 순위'} 최고 기록 동점은 공동 순위로 표시합니다. 진출 기준 순위의 동점자는 모두 진출합니다. 결승 동점은 재경기로 결정합니다.</p><div class="table-scroll">${ranking(d, r)}</div></section>` : ''}
  <details class="card"><summary>행사 이름 및 운영 기록</summary><form id="title-form" class="inline-form"><label>행사 이름<input name="title" value="${e(state.title)}" maxlength="60" required></label><button class="ghost">이름 저장</button></form><button id="audit" class="ghost">최근 변경 내역 보기</button><div id="audit-list"></div></details>
  ${backupPanel()}
  <details class="card reset-panel"><summary>리허설 종료 · 경기 기록 초기화</summary><p>어와나와 일반부의 모든 라운드·조 편성·주행 기록·순위를 초기화합니다. 참가자 이름, 스티커 번호, 자동차 이름과 사진 정보는 유지합니다. 초기화 후 각 부문에서 예선을 다시 시작할 수 있습니다.</p><p class="hint">초기화 전 기록은 자동으로 백업합니다. 백업에 실패하면 초기화하지 않습니다. 직접 보관하려면 먼저 <a href="/api/export">전체 기록 JSON 다운로드</a>를 누르세요.</p><form id="reset-form" class="inline-form"><label>확인 문구<input name="confirmation" placeholder="기록 초기화" autocomplete="off" pattern="기록 초기화" required></label><button class="danger" type="submit">두 부문 경기 기록 초기화</button></form>${state.lastReset ? '<p class="hint">최근 초기화·복원 전 기록: <a href="/api/reset-backup">백업 JSON 다운로드</a></p>' : ''}</details>`;
}
function backupPanel() {
  return `<details class="card"><summary>다른 노트북에서 사용 · 명단과 사진 백업 / 복원</summary><p>같은 서버 주소의 <b>/host</b>에 접속하면 명단·사진·기록이 그대로 보입니다. 각 노트북의 localhost는 서로 다른 저장소입니다. 서버 노트북을 바꿀 때는 아래 백업을 옮겨 복원하세요.</p><p><a class="button ghost" href="/api/export">명단·사진·모든 기록 백업 ↓</a></p><p class="hint">복원하면 두 부문의 현재 명단과 기록을 선택한 백업으로 교체합니다. 교체 전 데이터는 자동 백업합니다. CSV가 아닌 전체 백업 JSON을 선택하세요.</p><form id="restore-form" class="inline-form"><label>백업 파일<input id="backup-file" name="backup" type="file" accept=".json,application/json" required></label><label>확인 문구<input name="confirmation" placeholder="백업 복원" pattern="백업 복원" required autocomplete="off"></label><button class="primary">백업 가져오기</button></form>${state.lastReset ? '<a href="/api/reset-backup">최근 초기화·복원 직전 백업 다운로드</a>' : ''}</details>`;
}
function registration(d) {
  return `<section class="card"><div class="section-head"><div><span class="eyebrow">01 / CHECK IN</span><h2>이름부터 등록해요</h2></div><button id="prepare-groups" class="primary" ${d.participants.length < nextCount(division) ? 'disabled' : ''}>수동 조 편성하기 →</button></div><p>이름만 입력해도 등록됩니다. 번호를 비워 두면 ${division === 'open' ? '41' : '1'}번부터 자동으로 부여하며, 아래 명단에서 당일 스티커 번호·자동차 이름·사진 두 장을 나중에 추가할 수 있습니다.</p><form id="single-participant-form" class="inline-form"><label>선수 이름 · 필수<input name="name" maxlength="40" placeholder="예: 김하늘" required></label><label>스티커 번호 · 나중에 가능<input name="car" maxlength="12" placeholder="비워 두면 자동 번호"></label><label>자동차 이름 · 나중에 가능<input name="carName" maxlength="24" placeholder="예: 번개호"></label><button class="primary">이름 등록 +</button></form><div class="excel-paste"><h3>엑셀 명단 한 번에 붙여넣기</h3><p class="hint">엑셀의 셀 영역을 복사(Ctrl+C)하고 아래에 붙여넣기(Ctrl+V) 하세요. 이름 열만 복사해도 됩니다. 사진은 등록 후 참가자별로 추가하세요.</p><form id="participants-form"><label>복사한 열 순서<select id="paste-format" name="format"><option value="auto">자동 인식 · 제목 행 포함 가능</option><option value="name">이름만</option><option value="number-name-car">번호 / 이름 / 자동차 이름</option><option value="name-car">이름 / 자동차 이름</option></select></label><label for="entries">명단 붙여넣기</label><textarea id="entries" name="entries" rows="6" placeholder="번호&#9;이름&#9;자동차 이름&#10;1&#9;김하늘&#9;번개호&#10;2&#9;박서준&#9;노란 로켓" required></textarea><p class="hint">제목 행: 번호 · 이름 · 자동차 이름. 번호와 자동차 이름은 빈칸으로 두어도 됩니다. 문자 번호(예: A01)를 쓰는 경우 열 순서를 직접 선택하세요.</p><div class="form-actions"><button id="preview-roster" class="ghost" type="button">붙여넣은 명단 확인</button><button class="primary" type="submit">명단 한 번에 추가</button></div><div id="paste-preview" aria-live="polite"></div></form></div><p class="hint">확정 인원: 어와나 40명(1~40번) · 일반부 18명(41~58번). 예선 시작 후 추가·삭제는 잠기지만, 개인 정보와 사진은 계속 수정할 수 있습니다.</p></section>`;
}
function groupPlayers() {
  const d=state.divisions[division],r=current(d);
  return (r?.entrantIds || d.participants.map(p=>p.id)).map(id=>d.participants.find(p=>p.id===id));
}
function groupGrid(groups,players) {
  return groups.map((group,h)=>`<fieldset><legend>${h+1}조 · ${group.filter(Boolean).length}명</legend>${Array.from({length:4},(_,lane)=>{const id=group[lane]||'';return `<label>${lane+1}레인<select name="slot-${h}-${lane}" data-group-slot data-previous="${id}"><option value="" ${!id?'selected':''}>빈 레인</option>${players.map(p=>`<option value="${p.id}" ${p.id===id?'selected':''}>#${e(p.car)} ${e(p.name)}</option>`).join('')}</select></label>`;}).join('')}<button type="button" class="small ghost" data-remove-group="${h}">이 조 없애기</button></fieldset>`).join('');
}
function readGroups() {
  return [...app.querySelectorAll('.manual-grid fieldset')].map(el=>[...el.querySelectorAll('[data-group-slot]')].map(select=>select.value||null));
}
function updateGroupSummary() {
  const groups=readGroups(),players=groupPlayers(),assigned=new Set(groups.flat().filter(Boolean));
  const missing=players.filter(p=>!assigned.has(p.id));
  $('#group-summary').innerHTML=missing.length?`<b>미배치 ${missing.length}명</b> · ${missing.map(p=>'#'+e(p.car)+' '+e(p.name)).join(' / ')}<br>빈 레인에서 이 선수를 선택하거나 ‘조 추가’를 누르세요.`:`<b>${players.length}명 모두 배치 완료</b> · ${groups.filter(g=>g.some(Boolean)).length}개 조`;
  app.querySelectorAll('.manual-grid fieldset').forEach((el,i)=>{el.querySelector('legend').textContent=`${i+1}조 · ${groups[i].filter(Boolean).length}명`;});
}
function manualGroups(d, r) {
  if (r && (r.status !== 'active' || Object.values(r.results).some(rec=>rec.times.some(t=>t!==null) || rec.tieBreak!==null))) return '<details class="card"><summary>수동 조 편성</summary><p class="hint">기록 입력이 시작된 라운드는 조를 변경할 수 없습니다. 다음 라운드가 만들어지면 첫 기록 입력 전에 조를 조정할 수 있습니다.</p></details>';
  if (d.participants.length < nextCount(division)) return '';
  const groups = r?.groups || orderedGroups(d.participants.map(p=>p.id)),players=groupPlayers();
  return `<details class="card manual-panel" ${r ? '' : 'open'}><summary>수동 조 편성 · ${r?.name || '예선 준비'}</summary><p>‘빈 레인’을 선택하면 뒤 선수들이 출전순대로 한 칸씩 이동합니다. 기존 빈 레인은 유지하고, 마지막 조가 꽉 차면 새 조를 자동으로 추가합니다. 이미 배치된 선수를 고르면 두 자리가 바뀝니다.</p><p class="hint">${r?'첫 기록을 입력하기 전까지만 변경할 수 있습니다.':'편성을 마친 뒤 아래 버튼을 누르면 이 순서로 예선이 시작됩니다.'}</p><form id="groups-form"><div class="form-actions"><button id="number-groups" type="button" class="ghost">번호순 자동 편성</button><span class="hint">스티커 번호순으로 4명씩 새로 배치합니다. 수동 조정 후 저장할 수 있습니다.</span></div><p id="group-summary" class="notice" aria-live="polite"><b>${players.length}명 모두 배치 완료</b> · ${groups.length}개 조</p><div class="manual-grid">${groupGrid(groups,players)}</div><div class="form-actions"><button id="add-group" type="button" class="ghost">+ 조 추가</button><button class="primary" type="submit">${r?'조 편성 저장':'이 편성으로 예선 시작'}</button></div><p class="hint">모든 선수를 한 번씩 배치해야 저장됩니다. 모두 빈 조는 저장할 때 제외합니다. 다음 라운드는 기존 출전순에서 탈락자만 제외하여 자동 편성됩니다.</p></form></details>`;
}
function rosterPreview() {
  const entries=parseRoster($('#entries').value,$('#paste-format').value);
  $('#paste-preview').innerHTML=`<p><b>${entries.length}명</b>을 추가합니다. 기존 명단은 유지됩니다.</p><div class="table-scroll paste-table"><table><thead><tr><th>스티커 번호</th><th>이름</th><th>자동차 이름</th></tr></thead><tbody>${entries.map(p=>`<tr><td>${e(p.car||'자동 번호')}</td><td>${e(p.name)}</td><td>${e(p.carName||'나중에 입력')}</td></tr>`).join('')}</tbody></table></div>`;
}
function preview(src, label) {
  return src ? `<img src="${e(src)}" alt="${e(label)}">` : `<span class="photo-placeholder">${label === '선수 사진' ? '●' : '▰'}<small>${label}</small></span>`;
}
function roster(d) {
  if (!d.participants.length) return '';
  const p = d.participants.find(p=>p.id===editorId);
  return `<section class="card roster"><div class="section-head"><div><span class="eyebrow">DRIVER GARAGE</span><h2>참가자 명단 · ${d.participants.length}명</h2></div><label>이름 / 번호 검색<input id="roster-search" type="search" placeholder="찾을 이름 또는 번호"></label></div><p class="hint">참가자 카드의 ‘정보·사진 수정’을 누르세요. 사진은 선택 후 저장해야 다른 노트북과 TV에도 반영됩니다.</p>${p ? `<div id="participant-editor" class="participant-editor"><h3>#${e(p.car)} ${e(p.name)} 정보 수정</h3><form id="participant-edit-form"><div class="editor-fields"><label>선수 이름<input name="name" value="${e(p.name)}" maxlength="40" required></label><label>스티커 번호<input name="car" value="${e(p.car)}" maxlength="12" required></label><label>자동차 이름<input name="carName" value="${e(p.carName || '')}" maxlength="24" placeholder="나중에 입력해도 됩니다"></label></div><div class="photo-fields">${[['photoData','photoUrl','선수 사진'],['carPhotoData','carPhotoUrl','자동차 사진']].map(([input,field,label])=>`<div class="photo-field"><div id="preview-${input}" class="photo-preview ${field==='carPhotoUrl'?'car-photo':''}">${preview(p[field],label)}</div><label>${label}<input type="file" accept="image/jpeg,image/png,image/webp" data-photo="${input}" aria-label="${label} 선택"></label><button class="small ghost" type="button" data-remove-photo="${input}">사진 지우기</button></div>`).join('')}</div><p class="hint">JPG·PNG·WebP 사진을 선택하세요. 자동으로 크기를 줄여 저장합니다. 선수 사진은 정사각형 중앙 기준, 자동차는 전체 모습이 보이게 표시합니다. 사진이 없어도 등록할 수 있습니다.</p><div class="form-actions"><button class="primary" id="save-participant">정보·사진 저장</button><button type="button" id="cancel-edit" class="ghost">닫기</button></div></form></div>` : ''}<div class="roster-grid">${d.participants.map(p=>`<article class="roster-card" data-roster-name="${e((p.name+' '+p.car+' '+p.carName).toLowerCase())}"><div class="roster-photos"><div class="mini-profile">${preview(p.photoUrl,'선수 사진')}</div><div class="mini-car">${preview(p.carPhotoUrl,'자동차 사진')}</div></div><div class="roster-info"><small>스티커 #${e(p.car)}</small><h3>${e(p.name)}</h3><p>${e(p.carName || '자동차 이름을 추가해 주세요')}</p><button class="small ghost" data-edit="${p.id}">정보·사진 수정</button>${!current(d)?` <button class="small ghost" data-delete="${p.id}">삭제</button>`:''}</div></article>`).join('')}</div></section>`;
}
async function selectPhoto(input) {
  const file = input.files?.[0]; if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20000000) { notify('20MB 이하 JPG·PNG·WebP 사진을 선택하세요.',true); input.value='';return; }
  const owner = editorId, field = input.dataset.photo;
  mediaBusy++;dirty=true;input.disabled=true; const save=$('#save-participant');if(save)save.disabled=true;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1,512/Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    let data=canvas.toDataURL('image/jpeg',.82);
    if(data.length>240000)data=canvas.toDataURL('image/jpeg',.55);
    if(data.length>240000)throw Error('사진을 더 작은 크기로 선택해 주세요.');
    if(owner!==editorId)return;
    photoDraft[field]=data;
    $('#preview-'+field).innerHTML=preview(data,field==='photoData'?'선수 사진':'자동차 사진');
    notify('사진을 준비했습니다. 정보·사진 저장을 눌러 주세요.');
  } catch(err) { notify(err.message || '이 사진을 열 수 없습니다. JPG로 변환 후 다시 선택하세요.',true); }
  finally {mediaBusy--;input.disabled=false;if(save)save.disabled=mediaBusy>0;}
}
app.addEventListener('input', event => {
  if(event.target.id==='entries') $('#paste-preview').innerHTML='';
  if(event.target.id==='roster-search') for(const card of app.querySelectorAll('[data-roster-name]')) card.hidden=!card.dataset.rosterName.includes(event.target.value.trim().toLowerCase());
});
function racePanel(d, r) {
  const ids = lanes(r, heat, run), data = rows(d, r);
  const ties = r.advance ? [] : data.filter(p => Number.isFinite(p.best) && data.some(q => q.id !== p.id && q.best === p.best));
  const display = state.display;
  const winner = r.winnerId && d.participants.find(p => p.id === r.winnerId);
  return `${winner ? `<section class="winner-banner"><span>CHAMPION · ${d.name}</span><h2>🏆 ${e(winner.name)} <small>#${e(winner.car)}</small></h2></section>` : ''}
  <div class="host-grid"><section class="card"><div class="section-head"><div><span class="eyebrow">02 / TIMEKEEPING</span><h2>${r.name} 기록 입력</h2></div><span class="tag">${r.status === 'completed' ? '종료 · 읽기 전용' : '진행 중'}</span></div>
  <div class="race-controls"><label>경기 조<select id="heat">${r.groups.map((g, i) => `<option value="${i}" ${heat === i ? 'selected' : ''}>${i + 1}조 · ${g.filter(Boolean).length}명${g.filter(Boolean).every(id => r.results[id].times.every(t => t !== null)) ? ' ✓' : ''}</option>`).join('')}</select></label><label>주행<select id="run"><option value="0" ${run === 0 ? 'selected' : ''}>1차 주행</option><option value="1" ${run === 1 ? 'selected' : ''}>2차 주행</option></select></label><button id="broadcast" class="ghost">이 경기를 TV에 표시</button></div>
  <form id="records-form"><div class="lane-inputs">${ids.map((id, i) => {
    const p = d.participants.find(p => p.id === id), value = id && r.results[id].times[run];
    return `<div class="lane-input lane-${i + 1}"><span class="lane-label">기록칸 ${i + 1}</span>${id ? `<div class="driver"><span class="car">#${e(p.car)}</span><b>${e(p.name)}</b></div><label for="time-${id}">기록 (초)<input id="time-${id}" name="${id}" value="${value === null ? '' : fmt(value)}" placeholder="0.000" autocomplete="off" inputmode="decimal" required ${r.status !== 'active' ? 'disabled' : ''}></label><button type="button" class="small ghost" data-dnf="${id}" ${r.status !== 'active' ? 'disabled' : ''}>미완주 DNF</button>` : '<div class="empty">빈 레인</div>'}</div>`;
  }).join('')}</div><label>수정 사유 <span class="muted">기존 기록을 수정할 때 필수</span><input name="reason" maxlength="200" placeholder="예: 2레인 스톱워치 재확인" ${r.status !== 'active' ? 'disabled' : ''}></label><div class="form-actions"><button class="primary" ${r.status !== 'active' ? 'disabled' : ''}>${heat + 1}조 ${run + 1}차 기록 저장</button><button type="button" id="next" class="ghost">다음 주행 →</button></div></form>
  <p class="hint">저장 전 빈칸은 미입력입니다. 새 라운드 기록은 0.000부터 시작하며, 입력 전에는 순위에 반영하지 않습니다. DNF는 다른 한 번의 유효 기록에 영향을 주지 않습니다.</p></section>
  <aside class="card"><span class="eyebrow">03 / RACE DIRECTOR</span><h2>진행 및 TV 화면</h2><p class="broadcast-note">현재 송출: ${state.divisions[display.division].name}<br>${display.mode === 'ranking' ? '전체 순위' : `${display.heat + 1}조 · ${display.run + 1}차 주행`}</p><button id="rank-tv" class="ghost full">이 부문 순위 TV에 표시</button><p class="hint">TV 화면은 자동으로 갱신됩니다. 옆 순위는 8명씩 순환합니다. 전체 순위 전용 화면은 모든 순위를 한 번에 보여줍니다.</p><p><a href="/leaderboard" target="_blank" rel="noopener">전체 순위 · 자동 전환 ↗</a> · <a href="/leaderboard?division=awana" target="_blank" rel="noopener">어와나 전용 ↗</a> · <a href="/leaderboard?division=open" target="_blank" rel="noopener">일반부 전용 ↗</a> · <a href="/leaderboard?division=both" target="_blank" rel="noopener">두 부문 함께 ↗</a></p><p class="hint">전체 순위 자동 화면은 어와나 16강부터 두 부문을 나란히 보여줍니다. 각 부문의 새 라운드는 빈칸부터 시작합니다.</p><hr><h3>${r.advance ? `${r.name} 종료 → 상위 ${r.advance}위까지 · 동점자 포함 자동 편성` : '결승 종료 → 최종 순위 확정'}</h3><p class="hint">모든 기록 입력 후 진행할 수 있습니다. 진출 기준 순위의 최고 기록 동점자는 함께 진출하므로 정원보다 많아질 수 있습니다. 종료하면 기록으로 진출자를 선발하고, 이전 조·1차 레인 출전순에서 탈락자만 제외하여 4명씩 자동 편성합니다. 스티커 번호는 유지됩니다. 종료한 라운드 기록은 보존됩니다.</p><button id="finish" class="primary full" ${r.status !== 'active' ? 'disabled' : ''}>${r.name} 종료${r.advance ? ' 및 다음 조 자동 편성' : ' 및 결과 확정'}</button><hr><details ${r.index > 0 ? 'open' : ''}><summary>${r.name} 현재 조 편성 · ${r.groups.length}개 조</summary>${r.groups.map((group, i) => `<div class="schedule"><b>${i + 1}조</b>${group.map((id, j) => { if(!id)return `<p>${j+1}레인 · 빈칸</p>`; const p = d.participants.find(p => p.id === id); return `<p>#${e(p.car)} ${e(p.name)} <small>편성 ${j + 1}레인</small></p>`; }).join('')}</div>`).join('')}</details></aside></div>
  ${ties.length && r.status === 'active' ? `<details class="card"><summary>동점자 재경기 입력 · ${ties.length}명</summary><p>최고 기록이 같은 참가자끼리 재경기를 진행하세요. 결승 동점자 모두의 재경기 기록이 필요합니다. 재경기도 동점이면 다시 경기한 기록으로 모두 갱신하세요.</p><form id="tie-form" class="inline-form"><label>동점 참가자<select name="id">${ties.map(p => `<option value="${p.id}">#${e(p.car)} ${e(p.name)} · 최고 ${fmt(p.best)} / 재경기 ${fmt(p.tieBreak)}</option>`).join('')}</select></label><label>재경기 기록 (초 또는 DNF)<input name="time" placeholder="3.215" required></label><label>재경기 사유<input name="reason" placeholder="예: 16위 진출선 동점 재경기" maxlength="200" required></label><button class="primary">재경기 저장</button></form></details>` : ''}`;
}
async function action(name, body = {}, onSuccess = () => {}) {
  if (saving || mediaBusy) { if (mediaBusy) notify('사진을 준비하고 있습니다. 잠시 후 저장해 주세요.'); return false; }
  saving = true;
  const controls = [...app.querySelectorAll('input, select, textarea, button')].map(el => [el, el.disabled]);
  for (const [el] of controls) el.disabled = true;
  try {
    state = await api(name, { revision, division, ...body });
    onSuccess();
    dirty = false; render(); notify('저장했습니다. 관객 화면에 반영됩니다.'); return true;
  } catch (err) {
    notify(err.message, true);
    if (err.status === 409) $('#stale').hidden = false;
    if (err.status === 401) setLogin(false);
    return false;
  } finally {
    saving = false;
    for (const [el, disabled] of controls) el.disabled = disabled;
    if (!dirty && pendingState) render();
  }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('login', { pin: $('#pin').value }); $('#pin').value = ''; state = await api('state'); setLogin(true); }
  catch (err) { notify(err.message, true); }
});
$('#logout').addEventListener('click', async () => { if (clean()) { try { await api('logout', {}); setLogin(false); } catch (err) { notify(err.message, true); } } });
app.addEventListener('input', event => { if (event.target.closest('form')) dirty = true; });
app.addEventListener('change', async event => {
  if (event.target.dataset?.photo) { await selectPhoto(event.target); return; }
  if (event.target.id === 'backup-file') { dirty = true; return; }
  const id = event.target.id;
  if (saving) {
    if (['heat', 'run', 'history'].includes(id)) event.target.value = id === 'heat' ? heat : id === 'run' ? run : history;
    return;
  }
  if (id === 'car-owner') { $('#car-name-input').value = state.divisions[division].participants.find(p => p.id === event.target.value)?.carName || ''; return; }
  if (event.target.hasAttribute?.('data-group-slot')) {
    const select=event.target, previous=select.dataset.previous;
    if(!select.value && previous) {
      const index=[...app.querySelectorAll('[data-group-slot]')].indexOf(select),groups=readGroups();
      groups[Math.floor(index/4)][index%4]=previous;
      $('.manual-grid').innerHTML=groupGrid(clearGroupSlot(groups,index),groupPlayers());
      dirty=true;updateGroupSummary();
      notify('뒤 선수들을 순서대로 이동했습니다. 조 편성을 저장해 주세요.');return;
    }
    const other=select.value && [...app.querySelectorAll('[data-group-slot]')].find(el=>el!==select && el.value===select.value);
    if(other){other.value=previous;other.dataset.previous=previous;}
    select.dataset.previous=select.value;dirty=true;updateGroupSummary();return;
  }
  if(id==='paste-format'){ $('#paste-preview').innerHTML='';dirty=true;return; }
  if (!['heat', 'run', 'history'].includes(id)) return;
  if (!clean()) { event.target.value = id === 'heat' ? heat : id === 'run' ? run : history; return; }
  if (id === 'heat') heat = Number(event.target.value);
  if (id === 'run') run = Number(event.target.value);
  if (id === 'history') history = Number(event.target.value);
  render();
});
app.addEventListener('submit', async event => {
  event.preventDefault(); if (saving || mediaBusy) return;
  const form = event.target, fd = new FormData(form), r = current(state.divisions[division]);
  if (form.getAttribute('id') === 'single-participant-form') await action('participants', { entries:[{name:fd.get('name'),car:fd.get('car'),carName:fd.get('carName')}] });
  if (form.getAttribute('id') === 'participant-edit-form') {
    await action('participant-update', {id:editorId,name:fd.get('name'),car:fd.get('car'),carName:fd.get('carName'),...photoDraft}, () => {editorId=null;photoDraft={};});
  }
  if (form.getAttribute('id') === 'restore-form') {
    const file = fd.get('backup');
    if (!file?.size || file.size > 100000000) { notify('100MB 이하의 백업 JSON 파일을 선택하세요.',true); return; }
    try {
      const backup = JSON.parse(await file.text());
      await action('restore', {backup,confirmation:fd.get('confirmation')}, () => {division=state.display.division;heat=run=0;history=-1;editorId=null;photoDraft={};});
    } catch { notify('백업 파일을 읽을 수 없습니다. 전체 백업 JSON 파일인지 확인하세요.',true); }
    return;
  }
  if (form.getAttribute('id') === 'participants-form') {
    try { await action('participants', { entries:parseRoster(fd.get('entries'),fd.get('format')||'auto') }); }
    catch(err){notify(err.message,true);}
  }
  if (form.getAttribute('id') === 'groups-form') {
    const groups=readGroups().filter(group=>group.some(Boolean));
    const assigned=groups.flat().filter(Boolean),players=groupPlayers();
    if(assigned.length!==players.length || new Set(assigned).size!==players.length){updateGroupSummary();notify('미배치 선수를 모두 조에 넣어 주세요.',true);return;}
    await action(r?'groups':'start',{groups,...(r?{roundId:r.id}:{})},()=>{heat=run=0;history=-1;});
  }
  if (form.getAttribute('id') === 'records-form') {
    const records = Object.fromEntries(lanes(r, heat, run).filter(Boolean).map(id => [id, fd.get(id).trim().toUpperCase()]));
    await action('records', { roundId: r.id, heat, run, records, reason: fd.get('reason') });
  }
  if (form.getAttribute('id') === 'tie-form') await action('tiebreak', { roundId: r.id, ...Object.fromEntries(fd) });
  if (form.getAttribute('id') === 'car-name-form') await action('car-name', { id: fd.get('id'), carName: fd.get('carName').trim() });
  if (form.getAttribute('id') === 'title-form') await action('title', { title: fd.get('title') });
  if (form.getAttribute('id') === 'reset-form') {
    if (await action('reset-records', { confirmation: fd.get('confirmation') }, () => { heat = run = 0; history = -1; })) notify('두 부문의 경기 기록을 초기화했습니다. 참가자와 스티커 번호는 유지되며, 이전 기록은 자동 백업했습니다.');
  }
});
app.addEventListener('click', async event => {
  try {
  const b = event.target.closest('button'); if (!b || saving || mediaBusy) return;
  if(b.id==='preview-roster'){rosterPreview();return;}
  if(b.id==='number-groups'){const players=groupPlayers();$('.manual-grid').innerHTML=groupGrid(numberedGroups(players),players);dirty=true;updateGroupSummary();return;}
  if(b.id==='add-group' || b.dataset.removeGroup!==undefined){
    const groups=readGroups(),players=groupPlayers();
    if(b.id==='add-group'){if(groups.length>=players.length){notify('조는 참가자 수만큼만 추가할 수 있습니다.',true);return;}groups.push([null,null,null,null]);}
    else groups.splice(Number(b.dataset.removeGroup),1);
    $('.manual-grid').innerHTML=groupGrid(groups,players);dirty=true;updateGroupSummary();return;
  }
  if (b.dataset.edit && clean()) { editorId=b.dataset.edit;photoDraft={};render();$('#participant-editor').scrollIntoView({behavior:'smooth',block:'center'}); }
  if (b.id === 'cancel-edit') { if (clean()) {editorId=null;photoDraft={};dirty=false;render();} return; }
  if (b.dataset.removePhoto) { const field=b.dataset.removePhoto;photoDraft[field]='';dirty=true;$('#preview-'+field).innerHTML=field==='photoData'?'선수 사진':'자동차 사진';return; }
  if (b.dataset.dnf) { document.getElementById('time-' + b.dataset.dnf).value = 'DNF'; dirty = true; return; }
  if (b.dataset.division && clean()) { division = b.dataset.division; editorId=null;photoDraft={}; heat = run = 0; history = -1; render(); }
  if (b.dataset.delete && confirm('이 참가자를 삭제할까요?')) await action('participant-delete', { id: b.dataset.delete });
  if (b.id === 'prepare-groups') { const panel=$('.manual-panel');if(panel){panel.open=true;panel.scrollIntoView({behavior:'smooth',block:'start'});}return; }
  if (b.id === 'refresh' && clean()) { state = await api('state'); render(); }
  if (b.id === 'broadcast' || b.id === 'rank-tv') { if (clean()) await action('display', { heat, run, mode: b.id === 'broadcast' ? 'race' : 'ranking' }); }
  const r = current(state.divisions[division]);
  if (b.id === 'next' && clean()) {
    if (!r.groups[heat].filter(Boolean).every(id => r.results[id].times[run] !== null) && !confirm('현재 주행 기록이 아직 없습니다. 다음 주행으로 이동할까요?')) return;
    let nextHeat = heat, nextRun = run;
    if (run === 0) nextRun = 1; else if (heat < r.groups.length - 1) { nextHeat++; nextRun = 0; } else { notify('마지막 주행입니다. 모든 기록을 확인한 뒤 라운드를 종료하세요.'); return; }
    await action('display', { heat: nextHeat, run: nextRun, mode: 'race' }, () => { heat = nextHeat; run = nextRun; });
  }
  if (b.id === 'finish' && clean() && confirm(`${r.name}을 종료할까요?${r.advance ? ` 상위 ${r.advance}위의 동점자까지 모두 새 라운드로 등록되고 4명씩 조가 자동 편성됩니다. 새 기록은 0으로 초기화됩니다.` : ' 최종 순위가 확정됩니다.'} 기존 기록은 보존되며 종료 후 수정할 수 없습니다.`)) { await action('finish', { roundId: r.id }, () => { heat = run = 0; history = -1; }); }
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
  const session = await api('session'); passwordRequired = session.passwordRequired !== false; setLogin(session.authenticated);
  connect(next => {
    if (next.revision < state.revision) return;
    if (saving || dirty || editorId) {
      if (!pendingState || next.revision >= pendingState.revision) pendingState = next;
      if (dirty && loggedIn && next.revision !== revision) $('#stale').hidden = false;
      return;
    }
    state = next;
    if (loggedIn) render();
  });
} catch (err) { notify('서버에 연결할 수 없습니다. 새로고침해 주세요. ' + err.message, true); }
