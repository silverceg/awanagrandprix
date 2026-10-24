import { $, escape as e, fmt, current, rows, lanes, ranking, api, connect, nextCount, parseRoster, orderedGroups, numberedGroups, clearGroupSlot, numberDraw, isFour, laneRecords, runCount, eventSchedule, scheduledRace, phases, groupNumber, legacyOrder } from './common.js';

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
  app.innerHTML = `<section class="page-heading"><div><span class="eyebrow">RACE CONTROL</span><h1>${e(state.title)}</h1><p>네 레인을 한 번씩! 네 번 중 가장 빠른 기록.</p></div><div class="export"><a class="button ghost" href="/api/csv">기록 CSV ↓</a><a class="button ghost" href="/api/export">전체 기록 JSON ↓</a></div></section>
  <nav class="division-tabs">${Object.entries(state.divisions).map(([key, v]) => `<button data-division="${key}" class="${key === division ? 'selected' : ''}">${v.name}<span>${v.participants.length}명</span></button>`).join('')}</nav>
  <div class="stats"><div><small>현재 라운드</small><strong>${state.meeting?.status==='completed'?'본선 종료':scheduledRace(state)?phases[scheduledRace(state).run]:'본선 준비'}</strong></div><div><small>참가 인원</small><strong>${active?.entrantIds.length ?? d.participants.length}<em>명</em></strong></div><div><small>기록 입력 완료</small><strong>${done}<em>/ ${active?.entrantIds.length || 0}명</em></strong></div><div><small>경기 방식</small><strong>본선 4라운드</strong></div></div>
  <div id="stale" class="notice" hidden>새 변경 사항이 있습니다. 입력 내용은 유지했습니다. <button id="refresh">최신 내용 불러오기</button></div>
  ${meetingPanel()}
  ${numberDrawPanel(d,active)}
  ${!active ? registration(d) : racePanel(d, active)}
  ${manualGroups(d, active)}
  ${roster(d)}
  ${r ? `<section class="card"><div class="section-head"><div><span class="eyebrow">LEADERBOARD</span><h2>${history < 0 ? '현재 순위' : '이전 라운드 기록'}</h2></div><label>기록 보기 <select id="history"><option value="-1" ${history < 0 ? 'selected' : ''}>현재 · ${active.name}</option>${d.rounds.slice(0, -1).map((old, i) => `<option value="${i}" ${history === i ? 'selected' : ''}>${old.name} · 보존 기록</option>`).join('')}</select></label></div><p class="hint">${isFour(r)?'각 레인 기록과 네 번 중 최고 기록입니다. 한 번이라도 기록이 있으면 잠정 순위에 반영되며, 최고 기록 동점은 공동 순위입니다.':'이전 규칙으로 저장된 기록입니다. 새 경기는 위의 4회 경기 전환을 이용하세요.'}</p><div class="table-scroll">${ranking(d, r)}</div></section>` : ''}
  <details class="card"><summary>행사 이름 및 운영 기록</summary><form id="title-form" class="inline-form"><label>행사 이름<input name="title" value="${e(state.title)}" maxlength="60" required></label><button class="ghost">이름 저장</button></form><button id="audit" class="ghost">최근 변경 내역 보기</button><div id="audit-list"></div></details>
  ${backupPanel()}
  <details class="card reset-panel"><summary>리허설 종료 · 경기 기록 초기화</summary><p>어와나와 일반부의 모든 라운드·조 편성·주행 기록·순위를 초기화합니다. 참가자 이름, 스티커 번호, 자동차 이름과 사진 정보는 유지합니다. 초기화 후 두 부문 조를 다시 편성하면 본선 1라운드 1조부터 시작합니다.</p><p class="hint">초기화 전 기록은 자동으로 백업합니다. 백업에 실패하면 초기화하지 않습니다. 직접 보관하려면 먼저 <a href="/api/export">전체 기록 JSON 다운로드</a>를 누르세요.</p><form id="reset-form" class="inline-form"><label>확인 문구<input name="confirmation" placeholder="기록 초기화" autocomplete="off" pattern="기록 초기화" required></label><button class="danger" type="submit">두 부문 경기 기록 초기화</button></form>${state.lastReset ? '<p class="hint">최근 초기화·복원 전 기록: <a href="/api/reset-backup">백업 JSON 다운로드</a></p>' : ''}</details>`;
}
function backupPanel() {
  return `<details class="card"><summary>다른 노트북에서 사용 · 명단과 사진 백업 / 복원</summary><p>같은 서버 주소의 <b>/host</b>에 접속하면 명단·사진·기록이 그대로 보입니다. 각 노트북의 localhost는 서로 다른 저장소입니다. 서버 노트북을 바꿀 때는 아래 백업을 옮겨 복원하세요.</p><p><a class="button ghost" href="/api/export">명단·사진·모든 기록 백업 ↓</a></p><p class="hint">복원하면 두 부문의 현재 명단과 기록을 선택한 백업으로 교체합니다. 교체 전 데이터는 자동 백업합니다. CSV가 아닌 전체 백업 JSON을 선택하세요.</p><form id="restore-form" class="inline-form"><label>백업 파일<input id="backup-file" name="backup" type="file" accept=".json,application/json" required></label><label>확인 문구<input name="confirmation" placeholder="백업 복원" pattern="백업 복원" required autocomplete="off"></label><button class="primary">백업 가져오기</button></form>${state.lastReset ? '<a href="/api/reset-backup">최근 초기화·복원 직전 백업 다운로드</a>' : ''}</details>`;
}
function registration(d) {
  return `<section class="card"><div class="section-head"><div><span class="eyebrow">01 / CHECK IN</span><h2>이름부터 등록해요</h2></div><button id="prepare-groups" class="primary" ${(d.participants.some(p=>p.drawPending) || d.participants.length < nextCount(division)) ? 'disabled' : ''}>수동 조 편성하기 →</button></div><p>${division==='awana'?'이름과 자동차 이름을 먼저 등록하고 아래 명단에서 선수·자동차 사진을 저장하세요. 추첨 대기 상태로 보관되며, 위에서 번호를 지정할 때 TV에 공개됩니다.':'이름만 입력해도 등록됩니다. 번호를 비우면 41번부터 자동 부여합니다. 사진은 아래 명단에서 추가하세요.'}</p><form id="single-participant-form" class="inline-form"><label>선수 이름 · 필수<input name="name" maxlength="40" placeholder="예: 김하늘" required></label>${division==='open'?'<label>스티커 번호 · 나중에 가능<input name="car" maxlength="12" placeholder="비워 두면 자동 번호"></label>':''}<label>자동차 이름 · 나중에 가능<input name="carName" maxlength="24" placeholder="예: 번개호"></label><button class="primary">이름 등록 +</button></form><div class="excel-paste"><h3>엑셀 명단 한 번에 붙여넣기</h3><p class="hint">엑셀의 셀 영역을 복사(Ctrl+C)하고 아래에 붙여넣기(Ctrl+V) 하세요. 이름 열만 복사해도 됩니다. 사진은 등록 후 참가자별로 추가하세요.</p><form id="participants-form"><label>복사한 열 순서<select id="paste-format" name="format"><option value="auto">자동 인식 · 제목 행 포함 가능</option><option value="name">이름만</option><option value="number-name-car">번호 / 이름 / 자동차 이름</option><option value="name-car">이름 / 자동차 이름</option></select></label><label for="entries">명단 붙여넣기</label><textarea id="entries" name="entries" rows="6" placeholder="번호&#9;이름&#9;자동차 이름&#10;1&#9;김하늘&#9;번개호&#10;2&#9;박서준&#9;노란 로켓" required></textarea><p class="hint">${division==='awana'?'사전 등록은 이름·자동차 이름을 가져옵니다. 엑셀에 번호가 있어도 추첨 번호는 나중에 따로 지정합니다.':'제목 행: 번호 · 이름 · 자동차 이름. 번호와 자동차 이름은 빈칸으로 두어도 됩니다.'}</p><div class="form-actions"><button id="preview-roster" class="ghost" type="button">붙여넣은 명단 확인</button><button class="primary" type="submit">명단 한 번에 추가</button></div><div id="paste-preview" aria-live="polite"></div></form></div><p class="hint">어와나 39~40명(1~40번) · 일반부 18명(41~58번). 본선 시작 후 추가·삭제는 잠기지만, 개인 정보와 사진은 계속 수정할 수 있습니다.</p></section>`;
}
function groupPlayers() {
  const d=state.divisions[division],r=current(d);
  return (r?.entrantIds || d.participants.map(p=>p.id)).map(id=>d.participants.find(p=>p.id===id));
}
function drawPreview(id) {
  const p=state.divisions.awana.participants.find(p=>p.id===id);
  return p?`<div class="draw-selection"><div class="mini-profile">${preview(p.photoUrl,'선수 사진')}</div><div><b>${e(p.name)}</b><p>${e(p.carName||'자동차 이름 미등록')}</p><small>${p.drawPending?'번호 추첨 대기':'현재 #'+e(p.car)}</small></div><div class="mini-car">${preview(p.carPhotoUrl,'자동차 사진')}</div></div>`:'';
}
function numberDrawPanel(d,r) {
  if(division!=='awana')return '';
  const draw=numberDraw(d.participants),players=draw.groups.flat().filter(Boolean),choices=[...draw.pending,...d.participants.filter(p=>!p.drawPending)];
  if(r)return `<details class="card"><summary>조 추첨 화면 · 다시 보기</summary><a href="/draw" target="_blank" rel="noopener">조 추첨 화면 ↗</a><div class="inline-form"><label>이미 배정한 선수 재생<select id="draw-player">${players.map(p=>`<option value="${p.id}">#${e(p.car)} ${e(p.name)}</option>`).join('')}</select></label><button id="draw-reveal" class="ghost" ${players.length?'':'disabled'}>선택 선수 입장 장면 재생</button></div></details>`;
  return `<section class="card number-draw-panel"><div class="section-head"><div><span class="eyebrow">LIVE GROUP DRAW</span><h2>추첨 당일 · 번호만 지정</h2></div><a class="button primary" href="/draw" target="_blank" rel="noopener">조 추첨 관객 화면 ↗</a></div><p>먼저 아래에서 이름·자동차 이름·사진을 등록해 두세요. 추첨할 때 선수를 골라 뽑은 번호만 입력하면 사진과 함께 입장합니다.<br><b>1~4번 → 1조 · 5~8번 → 2조 · … · 37~40번 → 10조</b></p><p class="notice"><b>${draw.count} / ${d.participants.length}명 번호 배정</b> · 추첨 대기 ${draw.pending.length}명${draw.invalid.length?' · 번호 확인 필요 '+draw.invalid.map(p=>e(p.name)).join(', '):''}</p>
  ${!r?`<form id="assign-draw-form"><div class="inline-form"><label>추첨할 선수<select name="id" id="draw-assign-player" required>${choices.map(p=>`<option value="${p.id}">${p.drawPending?'[대기]':'#'+e(p.car)} ${e(p.name)}${p.carName?' · '+e(p.carName):''}</option>`).join('')}</select></label><label>뽑은 번호 (1~40)<input id="draw-number" name="number" type="number" min="1" max="40" step="1" placeholder="예: 5" required></label><button class="primary" ${!choices.length?'disabled':''}>번호 지정하고 입장</button></div><div id="draw-selected-preview">${drawPreview(choices[0]?.id)}</div></form><p class="hint">이미 사용한 번호는 중복 배정되지 않습니다. 관객 화면을 먼저 열고 효과음을 켜 두세요.</p>`:''}
  <div class="inline-form"><label>이미 배정한 선수 재생<select id="draw-player">${players.map(p=>`<option value="${p.id}">#${e(p.car)} ${e(p.name)} → ${Math.floor((Number(p.car)-1)/4)+1}조</option>`).join('')}</select></label><button id="draw-reveal" class="ghost" ${!players.length?'disabled':''}>선택 선수 입장 장면 재생</button>${!r?`<button id="start-number-draw" class="primary" ${![39,40].includes(d.participants.length)||draw.count!==d.participants.length||draw.invalid.length||draw.pending.length?'disabled':''}>이 10개 조로 경기 시작</button>`:''}</div>
  ${!r&&d.participants.some(p=>!p.drawPending)?'<details><summary>기존 명단으로 추첨 다시 준비</summary><p>이름·자동차 이름·사진을 유지하고, 어와나 전체 번호를 비워 추첨 대기로 돌립니다. 아직 본선을 시작하지 않았을 때만 사용할 수 있습니다.</p><button id="prepare-number-draw" class="ghost">명단 유지 · 번호 추첨 준비</button></details>':''}<p class="hint">39명 또는 40명 모두 번호를 배정하면 시작할 수 있습니다. 39명일 때 배정되지 않은 번호 자리는 빈 레인으로 유지됩니다. 불참자가 명단에 남아 있으면 시작 전에 삭제하세요. 일반부 조도 저장되어 있으면 본선 1라운드 1조부터 시작합니다.</p></section>`;
}
function groupGrid(groups,players) {
  return groups.map((group,h)=>`<fieldset><legend>${groupNumber(state,division,h)}조 · ${group.filter(Boolean).length}명</legend>${Array.from({length:4},(_,lane)=>{const id=group[lane]||'';return `<label>${lane+1}레인<select name="slot-${h}-${lane}" data-group-slot data-previous="${id}"><option value="" ${!id?'selected':''}>빈 레인</option>${players.map(p=>`<option value="${p.id}" ${p.id===id?'selected':''}>#${e(p.car)} ${e(p.name)}</option>`).join('')}</select></label>`;}).join('')}<button type="button" class="small ghost" data-remove-group="${h}">이 조 없애기</button></fieldset>`).join('');
}
function readGroups() {
  return [...app.querySelectorAll('.manual-grid fieldset')].map(el=>[...el.querySelectorAll('[data-group-slot]')].map(select=>select.value||null));
}
function updateGroupSummary() {
  const groups=readGroups(),players=groupPlayers(),assigned=new Set(groups.flat().filter(Boolean));
  const missing=players.filter(p=>!assigned.has(p.id));
  $('#group-summary').innerHTML=missing.length?`<b>미배치 ${missing.length}명</b> · ${missing.map(p=>'#'+e(p.car)+' '+e(p.name)).join(' / ')}<br>빈 레인에서 이 선수를 선택하거나 ‘조 추가’를 누르세요.`:`<b>${players.length}명 모두 배치 완료</b> · ${groups.filter(g=>g.some(Boolean)).length}개 조`;
  app.querySelectorAll('.manual-grid fieldset').forEach((el,i)=>{el.querySelector('legend').textContent=`${groupNumber(state,division,i)}조 · ${groups[i].filter(Boolean).length}명`;});
}
function manualGroups(d, r) {
  if(state.meeting || (r && !isFour(r)))return '';
  if (r && (r.status !== 'active' || Object.values(r.results).some(rec=>rec.times.some(t=>t!==null) || rec.tieBreak!==null))) return '<details class="card"><summary>수동 조 편성</summary><p class="hint">기록 입력이 시작된 라운드는 조를 변경할 수 없습니다. 전체 경기 시작 전까지만 조를 조정할 수 있습니다.</p></details>';
  if (d.participants.some(p=>p.drawPending) || d.participants.length < nextCount(division)) return '';
  const groups = r?.groups || orderedGroups(d.participants.map(p=>p.id)),players=groupPlayers();
  return `<details class="card manual-panel" ${r ? '' : 'open'}><summary>수동 조 편성 · ${r?.name || '본선 준비'}</summary><p>‘빈 레인’을 선택하면 뒤 선수들이 출전순대로 한 칸씩 이동합니다. 기존 빈 레인은 유지하고, 마지막 조가 꽉 차면 새 조를 자동으로 추가합니다. 이미 배치된 선수를 고르면 두 자리가 바뀝니다.</p><p class="hint">${r?'첫 기록을 입력하기 전까지만 변경할 수 있습니다.':'편성을 마친 뒤 아래 버튼을 누르면 조 편성이 저장됩니다.'}</p><form id="groups-form"><div class="form-actions"><button id="number-groups" type="button" class="ghost">번호순 자동 편성</button><span class="hint">스티커 번호순으로 4명씩 새로 배치합니다. 수동 조정 후 저장할 수 있습니다.</span></div><p id="group-summary" class="notice" aria-live="polite"><b>${players.length}명 모두 배치 완료</b> · ${groups.length}개 조</p><div class="manual-grid">${groupGrid(groups,players)}</div><div class="form-actions"><button id="add-group" type="button" class="ghost">+ 조 추가</button><button class="primary" type="submit">${r?'조 편성 저장':'이 조 편성 저장 · 경기 준비'}</button></div><p class="hint">모든 선수를 한 번씩 배치해야 저장됩니다. 모두 빈 조는 저장할 때 제외합니다. 두 부문 조가 모두 저장되면 본선 1라운드 1조부터 시작합니다. 이후 조 구성은 유지하며 레인만 한 칸씩 이동합니다.</p></form></details>`;
}
function rosterPreview() {
  const entries=parseRoster($('#entries').value,$('#paste-format').value);
  $('#paste-preview').innerHTML=`<p><b>${entries.length}명</b>을 추가합니다. 기존 명단은 유지됩니다.</p><div class="table-scroll paste-table"><table><thead><tr><th>스티커 번호</th><th>이름</th><th>자동차 이름</th></tr></thead><tbody>${entries.map(p=>`<tr><td>${division==='awana'?'추첨 대기':e(p.car||'자동 번호')}</td><td>${e(p.name)}</td><td>${e(p.carName||'나중에 입력')}</td></tr>`).join('')}</tbody></table></div>`;
}
function preview(src, label) {
  return src ? `<img src="${e(src)}" alt="${e(label)}">` : `<span class="photo-placeholder">${label === '선수 사진' ? '●' : '▰'}<small>${label}</small></span>`;
}
function roster(d) {
  if (!d.participants.length) return '';
  const p = d.participants.find(p=>p.id===editorId);
  return `<section class="card roster"><div class="section-head"><div><span class="eyebrow">DRIVER GARAGE</span><h2>참가자 명단 · ${d.participants.length}명</h2></div><label>이름 / 번호 검색<input id="roster-search" type="search" placeholder="찾을 이름 또는 번호"></label></div><p class="hint">참가자 카드의 ‘정보·사진 수정’을 누르세요. 사진은 선택 후 저장해야 다른 노트북과 TV에도 반영됩니다.</p>${p ? `<div id="participant-editor" class="participant-editor"><h3>${p.drawPending?'추첨 대기':'#'+e(p.car)} ${e(p.name)} 정보 수정</h3><form id="participant-edit-form"><div class="editor-fields"><label>선수 이름<input name="name" value="${e(p.name)}" maxlength="40" required></label><label>스티커 번호<input name="car" value="${p.drawPending?'':e(p.car)}" maxlength="12" ${p.drawPending?'readonly placeholder="추첨할 때 위에서 지정"':'required'}></label><label>자동차 이름<input name="carName" value="${e(p.carName || '')}" maxlength="24" placeholder="나중에 입력해도 됩니다"></label></div><div class="photo-fields">${[['photoData','photoUrl','선수 사진'],['carPhotoData','carPhotoUrl','자동차 사진']].map(([input,field,label])=>`<div class="photo-field"><div id="preview-${input}" class="photo-preview ${field==='carPhotoUrl'?'car-photo':''}">${preview(p[field],label)}</div><label>${label}<input type="file" accept="image/jpeg,image/png,image/webp" data-photo="${input}" aria-label="${label} 선택"></label><button class="small ghost" type="button" data-remove-photo="${input}">사진 지우기</button></div>`).join('')}</div><p class="hint">JPG·PNG·WebP 사진을 선택하세요. 자동으로 크기를 줄여 저장합니다. 선수 사진은 정사각형 중앙 기준, 자동차는 전체 모습이 보이게 표시합니다. 사진이 없어도 등록할 수 있습니다.</p><div class="form-actions"><button class="primary" id="save-participant">정보·사진 저장</button><button type="button" id="cancel-edit" class="ghost">닫기</button></div></form></div>` : ''}<div class="roster-grid">${d.participants.map(p=>`<article class="roster-card" data-roster-name="${e((p.name+' '+p.car+' '+p.carName).toLowerCase())}"><div class="roster-photos"><div class="mini-profile">${preview(p.photoUrl,'선수 사진')}</div><div class="mini-car">${preview(p.carPhotoUrl,'자동차 사진')}</div></div><div class="roster-info"><small>${p.drawPending?'번호 추첨 대기':'스티커 #'+e(p.car)}</small><h3>${e(p.name)}</h3><p>${e(p.carName || '자동차 이름을 추가해 주세요')}</p><button class="small ghost" data-edit="${p.id}">정보·사진 수정</button>${!current(d)?` <button class="small ghost" data-delete="${p.id}">삭제</button>`:''}</div></article>`).join('')}</div></section>`;
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

function followRace(){
  const task=scheduledRace(state) || state.display;
  division=task.division;heat=task.heat;run=task.run;history=-1;
}
function meetingPanel(){
  const legacy=Object.values(state.divisions).some(d=>d.rounds.some(r=>!isFour(r)));
  if(legacy)return '<section class="notice"><b>이전 2회·토너먼트 기록이 있습니다.</b><p>명단·사진·처음 조 편성은 유지하고 새 4회 경기를 준비할 수 있습니다. 기존 기록은 자동 백업 후 초기화됩니다.</p><button id="four-lane-reset">4회 경기로 전환</button></section>';
  const task=scheduledRace(state), total=eventSchedule(state).length,ready=['awana','open'].every(k=>isFour(current(state.divisions[k])));
  if(legacyOrder(state))return '<section class="notice"><b>이전 경기 진행 순서로 저장되어 있습니다.</b><p>본선 4라운드 순서로 변경하면 매 라운드 어와나부터 일반부까지 이어서 진행합니다. 명단·사진·조·기존 기록은 보존하고, 새 순서의 첫 미입력 경기부터 이어갑니다. 변경 전 상태도 자동 백업합니다.</p><button id="round-robin-order">기록 유지 · 본선 4라운드 적용</button></section>';
  const groupCount=ready?total/4:15;
  return `<section class="notice event-progress"><b>본선 1 → 2 → 3 → 4라운드 · 매 라운드 1~${groupCount}조 순서</b><p>어와나부터 일반부까지 모든 조가 한 번씩 달린 뒤 다음 라운드로 넘어갑니다. 레인은 1→2→3→4→1로 이동하며, 네 라운드 기록 중 가장 빠른 기록으로 순위를 정합니다.</p>${task?`<strong>진행 ${state.meeting.cursor+1}/${total} · ${phases[task.run]} · ${groupNumber(state,task.division,task.heat)}조 (${state.divisions[task.division].name})</strong> <button id="follow-race">현재 경기 입력으로 이동</button>`:state.meeting?.status==='completed'?'<strong>본선 4라운드 완료 · 두 부문 최종 순위를 확인하세요.</strong>':ready?'<button id="start-event">본선 경기 시작 · 1라운드 1조</button>':'<strong>두 부문의 조 편성을 먼저 저장하세요. 모두 준비되면 본선 1라운드 1조부터 자동 시작합니다.</strong>'}</section>`;

}
function racePanel(d,r){
  if(!isFour(r))return '<section class="card"><h2>이전 규칙 기록 보관</h2><p>아래 순위표에서 확인하고 전체 JSON으로 백업할 수 있습니다. 위의 4회 경기로 전환을 눌러 새 규칙을 시작하세요.</p></section>';
  const task=scheduledRace(state),live=task&&task.division===division&&task.heat===heat&&task.run===run;
  const ids=lanes(r,heat,run),schedule=eventSchedule(state),position=schedule.findIndex(t=>t.division===division&&t.heat===heat&&t.run===run);
  const editable=r.status==='active'&&!!task&&position>=0&&position<=state.meeting.cursor;
  const next=live?schedule[state.meeting.cursor+1]:null;
  return `<div class="host-grid"><section class="card"><div class="section-head"><h2>${d.name} · ${groupNumber(state,division,heat)}조 · 본선 ${run+1}라운드 기록</h2><span class="tag">${r.status==='completed'?'종료 · 읽기 전용':live?'현재 경기':'기록 조회'}</span></div>
  <div class="race-controls"><label>경기 조<select id="heat">${r.groups.map((g,i)=>`<option value="${i}" ${heat===i?'selected':''}>${groupNumber(state,division,i)}조 · ${g.filter(Boolean).length}명</option>`).join('')}</select></label><label>주행<select id="run">${[0,1,2,3].map(i=>`<option value="${i}" ${run===i?'selected':''}>본선 ${i+1}라운드</option>`).join('')}</select></label><button id="broadcast" class="ghost">이 경기를 TV에 표시</button></div>
  <p class="notice">현재 실제 레인 순서입니다. 다음 주행은 1→2→3→4→1로 이동합니다.</p>
  <form id="records-form"><div class="lane-inputs">${ids.map((id,i)=>{
    const player=d.participants.find(p=>p.id===id),rec=id&&r.results[id],value=rec?.times[run];
    return `<div class="lane-input lane-${i+1}"><span class="lane-label">${i+1}레인</span>${id?`<div class="driver"><span class="car">#${e(player.car)}</span><b>${e(player.name)}</b></div><label for="time-${id}">기록 (초)<input id="time-${id}" name="${id}" value="${value===null?'':fmt(value)}" placeholder="0.000" autocomplete="off" inputmode="decimal" required ${!editable?'disabled':''}></label><button type="button" class="small ghost" data-dnf="${id}" ${!editable?'disabled':''}>미완주 DNF</button><div class="host-lane-history">${laneRecords(r,id).map((t,l)=>`<span>${l+1}레인 <b>${fmt(t)}</b></span>`).join('')}</div>`:'<div class="empty">빈 레인</div>'}</div>`;
  }).join('')}</div><label>수정 사유 · 기존 기록을 고칠 때 필수<input name="reason" maxlength="200" placeholder="예: 스톱워치 재확인" ${!editable?'disabled':''}></label><div class="form-actions"><button class="primary" name="move" value="advance" ${!editable||!live?'disabled':''}>기록 저장 후 ${next?'다음 경기 →':'전체 경기 마치기'}</button><button class="ghost" name="move" value="stay" ${!editable?'disabled':''}>기록만 저장 · TV 유지</button><button type="button" id="next" class="ghost" ${!live?'disabled':''}>저장한 기록 확인 · 다음 경기 →</button></div></form>
  <p class="hint">${next?`다음: ${state.divisions[next.division].name} ${groupNumber(state,next.division,next.heat)}조 · 본선 ${next.run+1}라운드`:live?'마지막 주행입니다. 완료하면 두 부문의 최종 순위가 확정됩니다.':'현재 경기 입력으로 이동 버튼으로 진행 순서에 돌아가세요.'} 미입력은 —, 미완주는 DNF로 표시합니다. 네 번 중 가장 빠른 유효 기록으로 순위를 정하며 동점은 공동 순위입니다.</p></section>
  <aside class="card"><h2>진행 및 TV 화면</h2><p>현재 TV: ${state.divisions[state.display.division].name} ${groupNumber(state,state.display.division,state.display.heat)}조 · 본선 ${state.display.run+1}라운드</p><button id="rank-tv" class="ghost full">이 부문 순위 TV에 표시</button><p><a href="/leaderboard" target="_blank" rel="noopener">전체 순위 · 두 부문 함께 ↗</a></p><p><a href="/leaderboard?division=both" target="_blank" rel="noopener">두 부문 함께 ↗</a></p><p>TV 선수 카드에 1~4레인별 기록이 누적됩니다. 라운드가 바뀌어도 앞선 기록은 모두 보존됩니다.</p><details><summary>조별 최초 레인 배치</summary>${r.groups.map((g,h)=>`<div class="schedule"><b>${groupNumber(state,division,h)}조</b>${g.map((id,l)=>`<p>${l+1}레인 · ${id?e(d.participants.find(p=>p.id===id).name):'빈칸'}</p>`).join('')}</div>`).join('')}</details></aside></div>`;
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
  if(id==='draw-assign-player'){$('#draw-selected-preview').innerHTML=drawPreview(event.target.value);return;}
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
  if (form.getAttribute('id') === 'single-participant-form') await action('participants', { prepareDraw:division==='awana', entries:[{name:fd.get('name'),car:fd.get('car'),carName:fd.get('carName')}] });
  if(form.getAttribute('id')==='assign-draw-form'){await action('assign-draw-number',{id:fd.get('id'),number:fd.get('number')});return;}
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
    try { await action('participants', { prepareDraw:division==='awana', entries:parseRoster(fd.get('entries'),fd.get('format')||'auto') }); }
    catch(err){notify(err.message,true);}
  }
  if (form.getAttribute('id') === 'groups-form') {
    const groups=readGroups().filter(group=>group.some(Boolean));
    const assigned=groups.flat().filter(Boolean),players=groupPlayers();
    if(assigned.length!==players.length || new Set(assigned).size!==players.length){updateGroupSummary();notify('미배치 선수를 모두 조에 넣어 주세요.',true);return;}
    await action(r?'groups':'start',{groups,...(r?{roundId:r.id}:{})},()=>{if(state.meeting)followRace();else{heat=run=0;history=-1;}});
  }
  if (form.getAttribute('id') === 'records-form') {
    const records = Object.fromEntries(lanes(r, heat, run).filter(Boolean).map(id => [id, fd.get(id).trim().toUpperCase()]));
    const advance=isFour(r) && event.submitter?.value==='advance';
    await action('records', { roundId: r.id, heat, run, records, reason: fd.get('reason'), advance },()=>{if(advance)followRace();});
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
  if(b.id==='follow-race' && clean()){followRace();render();return;}
  if(b.id==='four-lane-reset' && clean()){
    if(confirm('기존 주행 기록은 백업하고, 명단·사진·처음 조 편성을 유지한 채 새 4회 경기를 준비할까요?'))
      await action('four-lane-reset',{confirmation:'4회 경기로 전환'},()=>{heat=run=0;history=-1;});
    return;
  }
  if(b.id==='start-event' && clean()){await action('start-event',{},followRace);return;}
  if(b.id==='preview-roster'){rosterPreview();return;}
  if(b.id==='prepare-number-draw' && clean()){if(confirm('어와나 전체 번호를 비우고 추첨 대기로 바꿀까요? 이름·자동차 이름·사진은 유지됩니다.'))await action('prepare-number-draw',{confirmation:'번호 추첨 준비'});return;}
  if(b.id==='draw-reveal' && clean()){await action('draw-reveal',{id:$('#draw-player').value});return;}
  if(b.id==='round-robin-order' && clean()){
    if(confirm('명단·사진·조·기록을 유지하고 매 라운드 전체 조를 진행하는 순서로 바꿀까요?'))await action('round-robin-order',{confirmation:'본선 4라운드 적용'},followRace);
    return;
  }
  if(b.id==='start-number-draw' && clean()){await action('start-number-draw',{},()=>{if(state.meeting)followRace();else{heat=run=0;history=-1;}});return;}
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
    if(isFour(r)){await action('next-race',{roundId:r.id,heat,run},followRace);return;}
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
    const moved=next.meeting?.cursor!==state.meeting?.cursor || next.meeting?.status!==state.meeting?.status;
    state = next;
    if(moved && state.meeting)followRace();
    if (loggedIn) render();
  });
} catch (err) { notify('서버에 연결할 수 없습니다. 새로고침해 주세요. ' + err.message, true); }

