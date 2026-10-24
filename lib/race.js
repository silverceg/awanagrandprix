import { randomUUID, randomInt } from 'node:crypto';
import { isFour, runCount, eventSchedule, scheduledRace } from '../public/race-format.js';
import { numberDraw } from '../public/draw-model.js';

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
function compare(a, b, useTieBreak = true) {
  const x = a.best ?? Infinity, y = b.best ?? Infinity;
  if (x !== y) return x < y ? -1 : 1;
  if (!useTieBreak) return 0;
  const tx = typeof a.tieBreak === 'number' ? a.tieBreak : Infinity;
  const ty = typeof b.tieBreak === 'number' ? b.tieBreak : Infinity;
  return tx === ty ? 0 : tx < ty ? -1 : 1;
}
export function standings(d, r = currentRound(d)) {
  if (!r) return [];
  const rows = r.entrantIds.map(id => {
    const p = d.participants.find(p => p.id === id);
    const rec = r.results[id];
    return { ...p, ...rec, best: isFour(r) ? (rec.times.some(t=>typeof t==='number') ? Math.min(...rec.times.filter(t=>typeof t==='number')) : rec.times.every(t=>t!==null) ? Infinity : null) : bestOf(rec.times), complete: rec.times.every(t => t !== null) };
  }).sort((a, b) => compare(a, b, !r.advance && !isFour(r)) || a.car.localeCompare(b.car, 'ko', { numeric: true }));
  rows.forEach((row, i) => {
    row.rank = Number.isFinite(row.best) ? (i && compare(row, rows[i - 1], !r.advance && !isFour(r)) === 0 ? rows[i - 1].rank : i + 1) : null;
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
  fail(Number.isInteger(run) && run >= 0 && run < runCount(r), '올바른 주행 차수를 선택하세요.');
  const lanes = [null, null, null, null];
  r.groups[heat].forEach((id, i) => { lanes[isFour(r) ? (i + run) % 4 : i] = id; });
  return lanes;
}
function text(value, label, max) {
  fail(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label}: 1~${max}자로 입력하세요.`);
  fail(!/[\u0000-\u001f]/.test(value), `${label}에 제어문자를 사용할 수 없습니다.`);
  return value.trim();
}
function carName(value = '') { return value === '' ? '' : text(value, '자동차 이름', 24); }
export function validateGroups(groups, ids) {
  fail(Array.isArray(groups) && groups.length > 0 && groups.length <= ids.length && groups.every(g => Array.isArray(g) && g.length > 0 && g.length <= 4 && g.some(id => id !== null)), '각 조에는 1~4명을 배치하세요. 모두 빈 조는 삭제하세요.');
  const flat = groups.flat().filter(id => id !== null), allowed = new Set(ids);
  fail(flat.length === ids.length && new Set(flat).size === ids.length && flat.every(id => allowed.has(id)), '모든 참가자를 중복·누락 없이 한 번씩 배치하세요.');
  return groups.map(g => [...g]);
}

export function makeFourRound(key, ids, groups) {
  const r = makeRound(key,0,ids,true);
  r.format='four-lanes'; r.name='본선 4라운드'; r.advance=0;
  if(groups) r.groups=groups;
  for(const rec of Object.values(r.results)) rec.times=[null,null,null,null];
  return r;
}
function startEvent(state) {
  fail(!state.meeting,'이미 경기 진행 순서가 시작되었습니다.');
  fail(['awana','open'].every(k=>isFour(currentRound(state.divisions[k]))),'어와나와 일반부의 조 편성을 모두 저장하세요.');
  fail(['awana','open'].every(k=>currentRound(state.divisions[k]).status==='active'),'종료된 경기는 기록 초기화 후 다시 시작하세요.');
  state.meeting={status:'active',cursor:0,order:'round-robin'};
  state.display={...eventSchedule(state)[0],mode:'race'};
}
function advanceEvent(state, body) {
  const task=scheduledRace(state), schedule=eventSchedule(state);
  fail(task,'진행 중인 경기가 없습니다.');
  const r=currentRound(state.divisions[task.division]);
  fail(body.division===task.division && body.roundId===r.id && body.heat===task.heat && body.run===task.run,'현재 자동 진행 경기에서 다음 경기로 이동하세요.');
  fail(r.groups[task.heat].filter(Boolean).every(id=>r.results[id].times[task.run]!==null),'현재 주행의 모든 기록을 먼저 저장하세요. 미완주는 DNF로 입력하세요.');
  state.meeting.cursor++;
  // A converted event may already contain results later in the new schedule.
  while(state.meeting.cursor<schedule.length){
    const pending=schedule[state.meeting.cursor],round=currentRound(state.divisions[pending.division]);
    if(round.groups[pending.heat].some(id=>id && round.results[id].times[pending.run]===null))break;
    state.meeting.cursor++;
  }
  const next=schedule[state.meeting.cursor];
  for(const d of Object.values(state.divisions)){
    const round=currentRound(d);
    if(Object.values(round.results).every(rec=>rec.times.every(t=>t!==null))){round.status='completed';round.closedAt ||= new Date().toISOString();}
  }
  if(next) state.display={...next,mode:'race'};
  else { state.meeting.status='completed'; state.display={...task,mode:'ranking'}; }
}
export function mutate(state, action, body) {
  if(action==='round-robin-order'){
    fail(body.confirmation==='본선 4라운드 적용','확인 문구를 확인하세요.');
    fail(['awana','open'].every(k=>isFour(currentRound(state.divisions[k]))),'두 부문의 4레인 조 편성을 먼저 준비하세요.');
    state.meeting={status:'active',cursor:0,order:'round-robin'};
    const schedule=eventSchedule(state);
    const cursor=schedule.findIndex(t=>{
      const r=currentRound(state.divisions[t.division]);
      return r.groups[t.heat].some(id=>id && r.results[id].times[t.run]===null);
    });
    for(const d of Object.values(state.divisions)){
      const r=currentRound(d);r.name='본선 4라운드';
      r.status=Object.values(r.results).every(rec=>rec.times.every(t=>t!==null))?'completed':'active';
      if(r.status==='active')delete r.closedAt;
      else r.closedAt ||= new Date().toISOString();
    }
    state.meeting.cursor=cursor<0?schedule.length:cursor;
    state.meeting.status=cursor<0?'completed':'active';
    state.display={...schedule[cursor<0?schedule.length-1:cursor],mode:cursor<0?'ranking':'race'};
    return;
  }
  if(action==='start-event'){startEvent(state);return;}
  if(action==='next-race'){advanceEvent(state,body);return;}
  if(action==='four-lane-reset'){
    fail(body.confirmation==='4회 경기로 전환','확인 문구에 4회 경기로 전환을 입력하세요.');
    for(const [key,d] of Object.entries(state.divisions)){
      const old=d.rounds[0];
      if(old) d.rounds=[makeFourRound(key,d.participants.map(p=>p.id),validateGroups(old.groups,d.participants.map(p=>p.id)))];
    }
    delete state.meeting;
    state.display={division:'awana',heat:0,run:0,mode:'race'};
    return;
  }

  if (action === 'reset-records') {
    fail(body.confirmation === '기록 초기화', '확인란에 기록 초기화를 정확히 입력하세요.');
    for (const d of Object.values(state.divisions)) d.rounds = [];
    delete state.meeting;
    state.display = { division: 'awana', heat: 0, run: 0, mode: 'race' };
    return;
  }
  if (action === 'title') { state.title = text(body.title, '행사 이름', 60); return; }
  const key = body.division;
  fail(Object.hasOwn(plans, key), '부문을 선택하세요.');
  const d = state.divisions[key], r = currentRound(d);
  if(action==='prepare-number-draw'){
    fail(key==='awana' && !r,'어와나 경기 준비 전에만 추첨을 준비할 수 있습니다.');
    fail(body.confirmation==='번호 추첨 준비','확인 문구를 정확히 입력하세요.');
    d.participants.forEach((p,i)=>{p.car=`대기${i+1}`;p.drawPending=true;});
    delete state.drawReveal;return;
  }
  if(action==='assign-draw-number'){
    fail(key==='awana' && !r,'어와나 경기 준비 전에만 추첨 번호를 지정할 수 있습니다.');
    const p=d.participants.find(p=>p.id===body.id);
    fail(p,'참가자를 선택하세요.');
    const value=String(body.number??'').trim(),number=Number(value);
    fail(/^\d+$/.test(value) && Number.isInteger(number) && number>=1 && number<=40,'뽑은 번호를 1~40 사이로 입력하세요.');
    fail(!d.participants.some(q=>q.id!==p.id && !q.drawPending && Number(q.car)===number),`${number}번은 이미 다른 선수에게 배정되었습니다.`);
    p.car=String(number);delete p.drawPending;
    state.drawReveal={eventId:randomUUID(),participantId:p.id};return;
  }
  if (action === 'draw-reveal') {
    fail(key === 'awana', '조 추첨 화면은 어와나 전용입니다.');
    const draw=numberDraw(d.participants),p=draw.groups.flat().find(p=>p?.id===body.id);
    fail(p, '1~40번 중 중복되지 않는 선수 번호를 먼저 등록하세요.');
    state.drawReveal={eventId:randomUUID(),participantId:p.id};
    return;
  }
  if (action === 'start-number-draw') {
    fail(key === 'awana', '일반부는 기존 수동 조 편성을 사용하세요.');
    const draw=numberDraw(d.participants);
    fail(draw.count===40 && draw.invalid.length===0 && d.participants.length===40, '어와나 1~40번을 중복·누락 없이 모두 등록한 후 시작하세요.');
    return mutate(state,'start',{...body,groups:draw.groups.map(g=>g.map(p=>p.id))});
  }
  if (action === 'participants') {
    fail(!r, '경기 준비 후에는 참가자 명단을 변경할 수 없습니다.');
    fail(Array.isArray(body.entries) && body.entries.length > 0 && body.entries.length + d.participants.length <= 100, '부문당 1~100명의 참가자를 등록할 수 있습니다.');
    const prepareDraw=key==='awana' && body.prepareDraw===true;
    const entries=prepareDraw?body.entries.map(entry=>({...entry,car:''})):body.entries;
    const cars = new Set(d.participants.map(p => p.car));
    // Reserve explicit sticker numbers before assigning automatic numbers in the same paste.
    const reserved = new Set(cars);
    for (const entry of entries) {
      fail(entry && typeof entry === 'object', '참가자 입력 형식을 확인하세요.');
      if (entry.car) { const car = text(entry.car, '차량 번호', 12); fail(!reserved.has(car), `차량 번호 ${car}가 중복됩니다.`); reserved.add(car); }
    }
    for (const entry of entries) {
      const name = text(entry.name, '이름', 40);
      let car = entry.car;
      if (!car) { let n = key === 'open' ? 41 : 1; const candidate=n=>prepareDraw?`대기${n}`:String(n); while (reserved.has(candidate(n))) n++; car = candidate(n); reserved.add(car); }
      car = text(car, '차량 번호', 12);
      fail(!cars.has(car), `차량 번호 ${car}가 중복됩니다.`);
      cars.add(car); d.participants.push({ id: randomUUID(), name, car, carName: carName(entry.carName),...(prepareDraw?{drawPending:true}:{}) });
    }
  } else if (action === 'participant-update') {
    const p = d.participants.find(p => p.id === body.id);
    fail(p, '참가자를 찾을 수 없습니다.');
    if(p.drawPending)fail(!body.car || body.car===p.car,'추첨 번호는 위쪽 번호 지정 화면에서 입력하세요.');
    const name = text(body.name, '이름', 40), car = p.drawPending?p.car:text(body.car, '스티커 번호', 12);
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
    fail(!r, '경기 준비 후에는 참가자를 삭제할 수 없습니다.');
    fail(d.participants.some(p => p.id === body.id), '참가자를 찾을 수 없습니다.');
    d.participants = d.participants.filter(p => p.id !== body.id);
    if(state.drawReveal?.participantId===body.id) delete state.drawReveal;
  } else if (action === 'start') {
    fail(!r, '이미 경기 준비가 완료되었습니다.');
    fail(!d.participants.some(p=>p.drawPending),'번호 추첨 대기 중인 선수에게 먼저 번호를 지정하세요.');
    fail(d.participants.length > 0, '참가자를 먼저 등록하세요.');
    const ids = d.participants.map(p => p.id);
    const groups = body.groups === undefined ? null : validateGroups(body.groups, ids);
    const next = makeFourRound(key, groups ? groups.flat().filter(id => id !== null) : ids, groups);
    if (groups) next.groups = groups;
    d.rounds.push(next);
    if(!state.meeting && ['awana','open'].every(k=>isFour(currentRound(state.divisions[k])))) startEvent(state);
  } else if (action === 'groups') {
    fail(!state.meeting,'자동 경기 시작 후에는 조 편성을 바꿀 수 없습니다.');
    fail(r?.status === 'active' && body.roundId === r.id, '현재 진행 중인 라운드를 확인하세요.');
    fail(Object.values(r.results).every(rec => rec.times.every(t => t === null) && rec.tieBreak === null), '기록 입력이 시작된 라운드는 조 편성을 바꿀 수 없습니다.');
    const groups = validateGroups(body.groups, r.entrantIds);
    r.groups = groups; r.entrantIds = groups.flat().filter(id => id !== null);
    if (state.display.division === key) state.display = { division:key,heat:0,run:0,mode:'race' };
  } else if (action === 'display') {
    fail(r, '먼저 조 편성을 저장하세요.');
    lanesFor(r, body.heat, body.run);
    fail(['race', 'ranking'].includes(body.mode), '올바른 화면 모드를 선택하세요.');
    state.display = { division: key, heat: body.heat, run: body.run, mode: body.mode };
  } else if (action === 'records') {
    fail(r?.status === 'active' && body.roundId === r.id, '진행 중인 라운드만 수정할 수 있습니다. 화면을 새로고침하세요.');
    if(isFour(r)) {
      const task=scheduledRace(state);
      fail(task,'두 부문 조를 모두 저장한 뒤 경기를 시작하세요.');
      const schedule=eventSchedule(state), position=schedule.findIndex(t=>t.division===key && t.heat===body.heat && t.run===body.run);
      fail(position>=0 && position<=state.meeting.cursor,'앞 순서 경기를 먼저 완료하세요.');
    }
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
    if(body.advance===true) advanceEvent(state,body);
  } else if (action === 'tiebreak') {
    fail(r?.status === 'active' && body.roundId === r.id, '진행 중인 라운드가 아닙니다.');
    fail(!isFour(r),'4회 경기의 최고 기록 동점은 공동 순위로 표시합니다.');
    const rows = standings(d), row = rows.find(p => p.id === body.id);
    fail(row && Number.isFinite(row.best), '두 번의 기록 입력을 완료한 참가자만 재경기를 등록할 수 있습니다.');
    fail(rows.filter(p => p.best === row.best).length > 1, '같은 최고 기록을 가진 참가자가 있을 때만 재경기를 입력하세요.');
    text(body.reason, '재경기 사유', 200);
    r.results[body.id].tieBreak = parseTime(body.time);
  } else if (action === 'finish') {
    fail(r?.status === 'active' && body.roundId === r.id, '이미 종료되었거나 진행 중인 라운드가 아닙니다.');
    fail(!isFour(r),'4회 경기는 마지막 기록 저장 후 다음 경기를 누르면 자동 종료됩니다.');
    const rows = standings(d);
    fail(rows.every(p => p.complete), '모든 참가자의 1차·2차 기록을 입력해야 종료할 수 있습니다. 미완주는 DNF로 입력하세요.');
    const valid = rows.filter(p => Number.isFinite(p.best));
    if (r.advance) {
      fail(valid.length >= r.advance, `유효 기록을 가진 참가자가 ${r.advance}명 미만입니다. 기록을 확인하세요.`);
      const cutoff = valid[r.advance - 1].best;
      r.status = 'completed'; r.closedAt = new Date().toISOString();
      r.advancedIds = valid.filter(p => p.best <= cutoff).map(p => p.id);
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
