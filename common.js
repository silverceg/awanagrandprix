export const $ = selector => document.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = value => value === 'DNF' ? 'DNF' : value == null ? '—' : (value / 1000).toFixed(3);
export const current = d => d.rounds.at(-1);
export const nextCount = key => key === 'awana' ? 16 : 8;
export function rows(d, r = current(d)) {
  if (!r) return [];
  const data = r.entrantIds.map(id => {
    const rec = r.results[id], complete = rec.times.every(t => t !== null), valid = rec.times.filter(t => typeof t === 'number');
    return { ...d.participants.find(p => p.id === id), ...rec, complete, best: complete && valid.length ? Math.min(...valid) : Infinity };
  });
  const compare = (a, b) => a.best - b.best || (typeof a.tieBreak === 'number' ? a.tieBreak : Infinity) - (typeof b.tieBreak === 'number' ? b.tieBreak : Infinity) || 0;
  data.sort((a, b) => compare(a, b) || a.car.localeCompare(b.car, 'ko', { numeric: true }));
  data.forEach((row, i) => { row.rank = Number.isFinite(row.best) ? (i && compare(row, data[i - 1]) === 0 ? data[i - 1].rank : i + 1) : null; });
  return data;
}
export function lanes(r, heat, run) {
  const result = [null, null, null, null];
  r.groups[heat]?.forEach((id, i) => { result[(i + 2 * run) % 4] = id; });
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
