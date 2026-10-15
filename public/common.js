export const $ = selector => document.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = value => value === 'DNF' ? 'DNF' : value == null ? '—' : (value / 1000).toFixed(3);
export const current = d => d.rounds.at(-1);
export const nextCount = key => key === 'awana' ? 16 : 8;
export function numberedGroups(players) {
  const ids=[...players].sort((a,b)=>a.car.localeCompare(b.car,'ko',{numeric:true})).map(p=>p.id);
  return Array.from({length:Math.ceil(ids.length/4)},(_,i)=>ids.slice(i*4,i*4+4));
}
// Keep intentional gaps; use spare slots at the end before adding a heat.
export function clearGroupSlot(groups, index) {
  const slots=groups.flatMap(group=>Array.from({length:4},(_,i)=>group[i]||null));
  if(!Number.isInteger(index) || index<0 || index>=slots.length) throw Error('조 편성 위치를 확인하세요.');
  let carry=slots[index];
  const lastOccupied=slots.findLastIndex(Boolean);
  slots[index]=null;
  for(let i=index+1;carry && i<slots.length;i++) {
    if(slots[i] || i>lastOccupied) [slots[i],carry]=[carry,slots[i]];
  }
  if(carry) slots.push(carry,null,null,null);
  return Array.from({length:slots.length/4},(_,i)=>slots.slice(i*4,i*4+4));
}
export function orderedGroups(ids) {
  if (!ids.length) return [];
  const count = Math.ceil(ids.length / 4), size = Math.floor(ids.length / count), extra = ids.length % count;
  let offset = 0;
  return Array.from({length:count},(_,i)=>{const group=ids.slice(offset,offset+size+(i<extra?1:0));offset+=group.length;return group;});
}
export function parseRoster(value, format = 'auto') {
  if (!['auto','name','name-car','number-name-car'].includes(format)) throw Error('열 순서를 선택하세요.');
  if (typeof value !== 'string' || value.length > 100000) throw Error('명단은 100명 이내로 나누어 붙여넣으세요.');
  const source=value.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const sep=source.includes('\t')?'\t':source.includes(',')?',':null;
  const table=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"' && (quoted || !cell.length)) { if(quoted && source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(!quoted && (ch===sep || ch==='\n')) {row.push(cell.trim());cell='';if(ch==='\n'){table.push(row);row=[];}}
    else cell+=ch;
  }
  if(quoted)throw Error('따옴표가 닫히지 않았습니다. 엑셀에서 셀 영역을 다시 복사하세요.');
  row.push(cell.trim());table.push(row);
  const nonempty=table.map((cells,i)=>({cells,line:i+1})).filter(r=>r.cells.some(Boolean));
  if(!nonempty.length)throw Error('엑셀에서 명단을 복사해 붙여넣으세요.');
  const label=s=>s.replace(/[\s_-]/g,'').toLowerCase();
  const fields={car:['번호','스티커번호','차량번호','선수번호','car'],name:['이름','선수이름','참가자이름','참가자','성명','name'],carName:['자동차이름','차이름','차량이름','carname']};
  const first=nonempty[0].cells.map(label), mapping=Object.fromEntries(Object.entries(fields).map(([key,names])=>[key,first.findIndex(v=>names.includes(v))]));
  const header=mapping.name>=0 && first.every(v=>!v||Object.values(fields).flat().includes(v));
  if(header){for(const names of Object.values(fields))if(first.filter(v=>names.includes(v)).length>1)throw Error('제목 행의 같은 항목이 두 번 들어 있습니다.');nonempty.shift();}
  if(!nonempty.length || nonempty.length>100)throw Error('등록할 참가자는 1~100명이어야 합니다.');
  return nonempty.map(({cells,line})=>{
    let p;
    if(header){if(cells.some((v,i)=>v && !Object.values(mapping).includes(i)))throw Error(`${line}행: 제목이 없는 열에 값이 있습니다. 이름·번호·자동차 이름 열만 복사하세요.`);p=Object.fromEntries(Object.entries(mapping).map(([key,index])=>[key,index<0?'':cells[index]||'']));}
    else {
      const mode=format==='auto'?(cells.length===1?'name':cells.length===2 && !/^\d+$/.test(cells[0]) && cells[0]!==''?'name-car':'number-name-car'):format;
      const max=mode==='name'?1:mode==='name-car'?2:3;
      if(cells.slice(max).some(Boolean))throw Error(`${line}행: 선택한 열 형식과 맞지 않습니다. 이름·번호·자동차 이름 열만 복사하세요.`);
      p=mode==='name'?{name:cells[0],car:'',carName:''}:mode==='name-car'?{name:cells[0],car:'',carName:cells[1]||''}:{car:cells[0]||'',name:cells[1]||'',carName:cells[2]||''};
    }
    if(!p.name)throw Error(`${line}행: 이름이 비어 있습니다.`);
    for(const [key,max] of [['name',40],['car',12],['carName',24]])if(p[key].length>max || /[\u0000-\u001f]/.test(p[key]))throw Error(`${line}행: 이름 40자·번호 12자·자동차 이름 24자 이내, 셀 안 줄바꿈 없이 입력하세요.`);
    return p;
  });
}
export function rows(d, r = current(d)) {
  if (!r) return [];
  const data = r.entrantIds.map(id => {
    const rec = r.results[id], complete = rec.times.every(t => t !== null), valid = rec.times.filter(t => typeof t === 'number');
    return { ...d.participants.find(p => p.id === id), ...rec, complete, best: complete && valid.length ? Math.min(...valid) : Infinity };
  });
  const compare = (a, b) => a.best - b.best || (!r.advance ? (typeof a.tieBreak === 'number' ? a.tieBreak : Infinity) - (typeof b.tieBreak === 'number' ? b.tieBreak : Infinity) : 0) || 0;
  data.sort((a, b) => compare(a, b) || a.car.localeCompare(b.car, 'ko', { numeric: true }));
  data.forEach((row, i) => { row.rank = Number.isFinite(row.best) ? (i && compare(row, data[i - 1]) === 0 ? data[i - 1].rank : i + 1) : null; });
  return data;
}
export function lanes(r, heat, run) {
  const result = [null, null, null, null];
  r.groups[heat]?.forEach((id, i) => { result[i] = id; });
  return result;
}
export function ranking(d, r, limit = Infinity, offset = 0) {
  const list = rows(d, r).filter(p => p.complete).slice(offset, offset + limit);
  return `<table><thead><tr><th>순위</th><th>참가자</th><th>1차</th><th>2차</th><th>최고 기록</th><th>재경기</th></tr></thead><tbody>${list.map(p => `<tr class="${p.rank && p.rank <= (r.advance || 3) ? 'qualifier' : ''}"><td><b class="rank">${p.rank || '—'}</b></td><td><span class="car">#${escape(p.car)}</span> <strong>${escape(p.name)}</strong>${p.carName ? `<small class="participant-car-name">${escape(p.carName)}</small>` : ''}${r.advancedIds?.includes(p.id) ? '<small class="tag">진출 확정</small>' : ''}</td><td>${fmt(p.times[0])}</td><td>${fmt(p.times[1])}</td><td class="best">${Number.isFinite(p.best) ? fmt(p.best) : p.complete ? 'DNF' : '대기'}</td><td>${fmt(p.tieBreak)}</td></tr>`).join('')}</tbody></table>`;
}
export async function api(path, body) {
  const res = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { const err = new Error(data.error); err.status = res.status; throw err; }
  return data;
}
export function connect(onState) {
  const stream = new EventSource('/api/events');
  const status = $('#connection');
  stream.addEventListener('state', e => { status.textContent = '● 실시간 연결'; status.classList.remove('offline'); onState(JSON.parse(e.data)); });
  stream.onerror = () => { status.textContent = '● 연결 끊김 · 재연결 중'; status.classList.add('offline'); };
  return stream;
}
