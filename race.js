import { randomUUID, randomInt } from 'node:crypto';

export class RaceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (ok, message) => { if (!ok) throw new RaceError(message); };
export const plans = {
  awana: [{ name: '예선', advance: 16 }, { name: '준준결승', advance: 8 }, { name: '준결승', advance: 4 }, { name: '결승', advance: 0 }],
  open: [{ name: '예선', advance: 8 }, { name: '준결승', advance: 4 }, { name: '결승', advance: 0 }]
};
export function freshState() {
  return { schema: 1, revision: 0, title: '어와나 그랑프리', updatedAt: new Date().toISOString(),
    display: { division: 'awana', heat: 0, run: 0, mode: 'race' },
    divisions: {
      awana: { name: '어와나', participants: [], rounds: [] },
      open: { name: '일반부', participants: [], rounds: [] }
    } };
}
export const currentRound = d => d.rounds.at(-1);
export function parseTime(value) {
  if (value === 'DNF') return 'DNF';
  fail(typeof value === 'string' && /^\d{1,3}(\.\d{1,3})?$/.test(value.trim()), '기록은 초 단위 숫자(소수점 최대 3자리) 또는 DNF로 입력하세요.');
  const ms = Math.round(Number(value) * 1000);
  fail(ms > 0 && ms <= 999999, '기록은 0초 초과, 999.999초 이하여야 합니다.');
  return ms;
}
export const formatTime = ms => ms === 'DNF' ? 'DNF' : ms == null ? '—' : (ms / 1000).toFixed(3);
export function bestOf(times) {
  if (times.some(t => t === null)) return null;
  const valid = times.filter(t => typeof t === 'number');
  return valid.length ? Math.min(...valid) : Infinity;
}
function compare(a, b) {
  const x = a.best ?? Infinity, y = b.best ?? Infinity;
  if (x !== y) return x < y ? -1 : 1;
  const tx = typeof a.tieBreak === 'number' ? a.tieBreak : Infinity;
  const ty = typeof b.tieBreak === 'number' ? b.tieBreak : Infinity;
  return tx === ty ? 0 : tx < ty ? -1 : 1;
}
export function standings(d, r = currentRound(d)) {
  if (!r) return [];
  const rows = r.entrantIds.map(id => {
    const p = d.participants.find(p => p.id === id);
    const rec = r.results[id];
    return { ...p, ...rec, best: bestOf(rec.times), complete: rec.times.every(t => t !== null) };
  }).sort((a, b) => compare(a, b) || a.car.localeCompare(b.car, 'ko', { numeric: true }));
  rows.forEach((row, i) => {
    row.rank = Number.isFinite(row.best) ? (i && compare(row, rows[i - 1]) === 0 ? rows[i - 1].rank : i + 1) : null;
  });
  return rows;
}
export function makeRound(key, index, ids, preserveOrder = false) {
  const order = [...ids];
  if (!preserveOrder) for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const count = Math.ceil(order.length / 4);
  const groups = Array.from({ length: count }, () => []);
  order.forEach((id, i) => {
    if (preserveOrder) { groups[Math.floor(i / 4)].push(id); return; }
    const row = Math.floor(i / count), col = i % count;
    groups[row % 2 ? count - 1 - col : col].push(id);
  });
  return { id: randomUUID(), index, ...plans[key][index], status: 'active', createdAt: new Date().toISOString(),
    entrantIds: order, groups, results: Object.fromEntries(ids.map(id => [id, { times: [null, null], scoreMs: 0, tieBreak: null }])) };
}
export function lanesFor(r, heat, run) {
  fail(Number.isInteger(heat) && heat >= 0 && heat < r.groups.length, '올바른 조를 선택하세요.');
  fail(run === 0 || run === 1, '1차 또는 2차 주행을 선택하세요.');
  const lanes = [null, null, null, null];
  r.groups[heat].forEach((id, i) => { lanes[(i + 2 * run) % 4] = id; });
  return lanes;
}
function text(value, label, max) {
  fail(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label}: 1~${max}자로 입력하세요.`);
  fail(!/[\u0000-\u001f]/.test(value), `${label}에 제어문자를 사용할 수 없습니다.`);
  return value.trim();
}
function carName(value = '') { return value === '' ? '' : text(value, '자동차 이름', 24); }
export function mutate(state, action, body) {
  if (action === 'reset-records') {
    fail(body.confirmation === '기록 초기화', '확인란에 기록 초기화를 정확히 입력하세요.');
    for (const d of Object.values(state.divisions)) d.rounds = [];
    state.display = { division: 'awana', heat: 0, run: 0, mode: 'race' };
    return;
  }
  if (action === 'title') { state.title = text(body.title, '행사 이름', 60); return; }
  const key = body.division;
  fail(Object.hasOwn(plans, key), '부문을 선택하세요.');
  const d = state.divisions[key], r = currentRound(d);
  if (action === 'participants') {
    fail(!r, '예선 시작 후에는 참가자 명단을 변경할 수 없습니다.');
    fail(Array.isArray(body.entries) && body.entries.length > 0 && body.entries.length + d.participants.length <= 100, '부문당 1~100명의 참가자를 등록할 수 있습니다.');
    const cars = new Set(d.participants.map(p => p.car));
    for (const entry of body.entries) {
      const name = text(entry.name, '이름', 40);
      let car = entry.car;
      if (!car) { let n = 1; while (cars.has(String(n))) n++; car = String(n); }
      car = text(car, '차량 번호', 12);
      fail(!cars.has(car), `차량 번호 ${car}가 중복됩니다.`);
      cars.add(car); d.participants.push({ id: randomUUID(), name, car, carName: carName(entry.carName) });
    }
  } else if (action === 'participant-update') {
    const p = d.participants.find(p => p.id === body.id);
    fail(p, '참가자를 찾을 수 없습니다.');
    const name = text(body.name, '이름', 40), car = text(body.car, '스티커 번호', 12);
    fail(!d.participants.some(q => q.id !== p.id && q.car === car), `스티커 번호 ${car}가 중복됩니다.`);
    p.name = name; p.car = car; p.carName = carName(body.carName);
    for (const field of ['photoUrl', 'carPhotoUrl']) if (Object.hasOwn(body, field)) {
      fail(body[field] === '' || (typeof body[field] === 'string' && /^\/media\/[a-f0-9]{64}\.jpg$/.test(body[field])), '올바른 사진을 선택하세요.');
      p[field] = body[field];
    }
  } else if (action === 'car-name') {
    const p = d.participants.find(p => p.id === body.id);
    fail(p, '참가자를 찾을 수 없습니다.');
    p.carName = carName(body.carName);
  } else if (action === 'participant-delete') {
    fail(!r, '예선 시작 후에는 참가자를 삭제할 수 없습니다.');
    fail(d.participants.some(p => p.id === body.id), '참가자를 찾을 수 없습니다.');
    d.participants = d.participants.filter(p => p.id !== body.id);
  } else if (action === 'start') {
    fail(!r, '이미 예선이 시작되었습니다.');
    fail(d.participants.length >= plans[key][0].advance, `이 부문은 최소 ${plans[key][0].advance}명 이상 등록하세요.`);
    d.rounds.push(makeRound(key, 0, d.participants.map(p => p.id)));
    state.display = { division: key, heat: 0, run: 0, mode: 'race' };
  } else if (action === 'display') {
    fail(r, '먼저 예선을 시작하세요.');
    lanesFor(r, body.heat, body.run);
    fail(['race', 'ranking'].includes(body.mode), '올바른 화면 모드를 선택하세요.');
    state.display = { division: key, heat: body.heat, run: body.run, mode: body.mode };
  } else if (action === 'records') {
    fail(r?.status === 'active' && body.roundId === r.id, '진행 중인 라운드만 수정할 수 있습니다. 화면을 새로고침하세요.');
    const ids = lanesFor(r, body.heat, body.run).filter(Boolean);
    fail(body.records && typeof body.records === 'object' && Object.keys(body.records).length === ids.length && ids.every(id => Object.hasOwn(body.records, id)), '해당 조의 모든 참가자 기록을 입력하세요.');
    const correction = ids.some(id => r.results[id].times[body.run] !== null);
    if (correction) text(body.reason, '수정 사유', 200);
    const changed = [];
    for (const id of ids) {
      const value = parseTime(body.records[id]);
      if (value !== r.results[id].times[body.run]) changed.push(id);
      r.results[id].times[body.run] = value;
      const valid = r.results[id].times.filter(t => typeof t === 'number');
      r.results[id].scoreMs = valid.length ? Math.min(...valid) : 0;
    }
    // A changed base result invalidates all tie-breaks: the tied cohort may have changed.
    if (changed.length) for (const rec of Object.values(r.results)) rec.tieBreak = null;
  } else if (action === 'tiebreak') {
    fail(r?.status === 'active' && body.roundId === r.id, '진행 중인 라운드가 아닙니다.');
    const rows = standings(d), row = rows.find(p => p.id === body.id);
    fail(row && Number.isFinite(row.best), '두 번의 기록 입력을 완료한 참가자만 재경기를 등록할 수 있습니다.');
    fail(rows.filter(p => p.best === row.best).length > 1, '같은 최고 기록을 가진 참가자가 있을 때만 재경기를 입력하세요.');
    text(body.reason, '재경기 사유', 200);
    r.results[body.id].tieBreak = parseTime(body.time);
  } else if (action === 'finish') {
    fail(r?.status === 'active' && body.roundId === r.id, '이미 종료되었거나 진행 중인 라운드가 아닙니다.');
    const rows = standings(d);
    fail(rows.every(p => p.complete), '모든 참가자의 1차·2차 기록을 입력해야 종료할 수 있습니다. 미완주는 DNF로 입력하세요.');
    const valid = rows.filter(p => Number.isFinite(p.best));
    if (r.advance) {
      fail(valid.length >= r.advance, `유효 기록을 가진 참가자가 ${r.advance}명 미만입니다. 기록을 확인하세요.`);
      if (valid.length > r.advance) {
        const edge = valid[r.advance - 1];
        const tied = valid.filter(p => p.best === edge.best);
        const crossing = tied.some(p => valid.indexOf(p) < r.advance) && tied.some(p => valid.indexOf(p) >= r.advance);
        if (crossing) fail(tied.every(p => p.tieBreak !== null) && compare(edge, valid[r.advance]) !== 0, '진출선 동점입니다. 같은 최고 기록을 가진 참가자 모두의 재경기 기록을 입력하세요. 재경기도 동점이면 다시 진행하세요.');
      }
      r.status = 'completed'; r.closedAt = new Date().toISOString();
      r.advancedIds = valid.slice(0, r.advance).map(p => p.id);
      // Qualify by best time, then keep the previous heat / first-run lane order.
      const advancing = new Set(r.advancedIds);
      const appearanceOrder = r.groups.flat().filter(id => advancing.has(id));
      d.rounds.push(makeRound(key, r.index + 1, appearanceOrder, true));
      state.display = { division: key, heat: 0, run: 0, mode: 'race' };
    } else {
      fail(valid.length > 0, '유효 기록이 없어 우승자를 확정할 수 없습니다.');
      for (let i = 0; i < valid.length - 1; i++) {
        const tied = valid.filter(p => p.best === valid[i].best);
        if (tied.length > 1) fail(tied.every(p => p.tieBreak !== null) && compare(valid[i], valid[i + 1]) !== 0, '결승 동점입니다. 동점자 모두의 재경기 기록을 입력해 순위를 확정하세요.');
      }
      r.status = 'completed'; r.closedAt = new Date().toISOString();
      r.winnerId = valid[0].id;
      state.display = { division: key, heat: 0, run: 0, mode: 'ranking' };
    }
  } else throw new RaceError('알 수 없는 작업입니다.', 404);
}
