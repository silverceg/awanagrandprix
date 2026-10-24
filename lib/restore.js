import { isFour, eventSchedule } from '../public/race-format.js';
import { RaceError, freshState, plans, bestOf } from './race.js';

const check = (ok, message = '백업의 데이터 구조가 올바르지 않습니다.') => { if (!ok) throw new RaceError(message); };
export const mediaPath = /^\/media\/[a-f0-9]{64}\.jpg$/;
const str = (x, max, required = true) => typeof x === 'string' && x.length <= max && (!required || x.trim().length > 0) && !/[\u0000-\u001f]/.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(x) && !['__proto__','constructor','prototype'].includes(x);
const time = x => x === null || x === 'DNF' || (Number.isInteger(x) && x > 0 && x <= 999999);
const unique = a => Array.isArray(a) && new Set(a).size === a.length;
export function validateBackup(backup) {
  const s = backup?.state;
  check(s?.schema === 1 && str(s.title,60) && s.divisions && s.display);
  const out = freshState(); out.title = s.title;
  const allIds = new Set();
  for (const key of ['awana','open']) {
    const d = s.divisions[key];
    check(d && Array.isArray(d.participants) && d.participants.length <= 100 && Array.isArray(d.rounds) && d.rounds.length <= plans[key].length);
    const ids = new Set(), cars = new Set();
    out.divisions[key].participants = d.participants.map(p => {
      check(p && id(p.id) && !allIds.has(p.id) && str(p.name,40) && str(p.car,12) && !cars.has(p.car) && str(p.carName ?? '',24,false));
      ids.add(p.id); allIds.add(p.id); cars.add(p.car);
      const result = { id:p.id, name:p.name, car:p.car, carName:p.carName || '' };
      if(p.drawPending!==undefined){check(typeof p.drawPending==='boolean' && key==='awana' && (!p.drawPending || d.rounds.length===0));if(p.drawPending)result.drawPending=true;}
      for (const field of ['photoUrl','carPhotoUrl']) if (p[field]) { check(mediaPath.test(p[field]), '사진 주소가 지원되지 않습니다. 이 프로그램에서 내려받은 백업을 사용하세요.'); result[field] = p[field]; }
      return result;
    });
    out.divisions[key].rounds = d.rounds.map((r,index) => {
      check(!isFour(r) || (index===0 && d.rounds.length===1));
      check(r && id(r.id) && r.index === index && ['active','completed'].includes(r.status) && (index === d.rounds.length-1 || r.status === 'completed'));
      check(unique(r.entrantIds) && r.entrantIds.length > 0 && r.entrantIds.every(x => ids.has(x)));
      if (index === 0) check(r.entrantIds.length === ids.size);
      else check(r.entrantIds.length === d.rounds[index-1].advancedIds?.length && r.entrantIds.every(x => d.rounds[index-1].advancedIds?.includes(x)));
      check(Array.isArray(r.groups) && r.groups.length > 0 && r.groups.every(g => Array.isArray(g) && g.length > 0 && g.length <= 4 && g.some(x => x !== null)));
      const grouped = r.groups.flat().filter(x => x !== null);
      check(unique(grouped) && grouped.length === r.entrantIds.length && grouped.every(x => r.entrantIds.includes(x)));
      check(r.results && Object.keys(r.results).length === r.entrantIds.length);
      const results = Object.fromEntries(r.entrantIds.map(x => {
        const rec = r.results[x];
        check(rec && Array.isArray(rec.times) && rec.times.length === (isFour(r)?4:2) && rec.times.every(time) && time(rec.tieBreak));
        if (r.status === 'completed') check(rec.times.every(t => t !== null));
        const valid = rec.times.filter(t => typeof t === 'number');
        return [x,{times:[...rec.times],scoreMs:valid.length ? Math.min(...valid) : 0,tieBreak:rec.tieBreak}];
      }));
      const result = {id:r.id,index,...plans[key][index],...(isFour(r)?{format:'four-lanes',name:'본선 4라운드',advance:0}:{}),status:r.status,createdAt:str(r.createdAt,40)?r.createdAt:new Date().toISOString(),entrantIds:[...r.entrantIds],groups:r.groups.map(g=>[...g]),results};
      if (r.status === 'completed') {
        result.closedAt = str(r.closedAt,40)?r.closedAt:new Date().toISOString();
        if (result.advance) { check(unique(r.advancedIds) && r.advancedIds.length >= result.advance && r.advancedIds.length <= r.entrantIds.length && r.advancedIds.every(x=>r.entrantIds.includes(x))); result.advancedIds = [...r.advancedIds]; }
        else if(!isFour(r)) { check(r.entrantIds.includes(r.winnerId)); result.winnerId = r.winnerId; }
        if (result.advance && r.advancedIds.length > result.advance) {
          const valid=r.entrantIds.map(x=>({id:x,best:bestOf(results[x].times)})).filter(p=>Number.isFinite(p.best)).sort((a,b)=>a.best-b.best);
          check(valid.length>=result.advance);
          const expected=valid.filter(p=>p.best<=valid[result.advance-1].best).map(p=>p.id);
          check(expected.length===r.advancedIds.length && expected.every(x=>r.advancedIds.includes(x)), '동점 진출 명단과 기록이 일치하지 않습니다.');
        }
      }
      return result;
    });
  }
  const display = s.display, r = out.divisions[display.division]?.rounds.at(-1);
  check(['awana','open'].includes(display.division) && ['race','ranking'].includes(display.mode) && (isFour(r)?[0,1,2,3]:[0,1]).includes(display.run) && Number.isInteger(display.heat) && display.heat >= 0 && (r ? display.heat < r.groups.length : display.heat === 0));
  out.display = {division:display.division,heat:display.heat,run:display.run,mode:display.mode};
  if(s.drawReveal !== undefined) {
    check(s.drawReveal && id(s.drawReveal.eventId) && out.divisions.awana.participants.some(p=>p.id===s.drawReveal.participantId), '추첨 공개 정보가 올바르지 않습니다.');
    out.drawReveal={eventId:s.drawReveal.eventId,participantId:s.drawReveal.participantId};
  }
  if(s.meeting!==undefined){
    const meeting=s.meeting;
    check(meeting && (meeting.order===undefined || meeting.order==='round-robin'));
    out.meeting={status:meeting.status,cursor:meeting.cursor,...(meeting.order?{order:meeting.order}:{})};
    const schedule=eventSchedule(out);
    check(['awana','open'].every(k=>isFour(out.divisions[k].rounds.at(-1))));
    check(meeting && ['active','completed'].includes(meeting.status) && Number.isInteger(meeting.cursor) && meeting.cursor>=0 && (meeting.status==='completed'?meeting.cursor===schedule.length:meeting.cursor<schedule.length));
    for(let i=0;i<meeting.cursor;i++){
      const task=schedule[i], round=out.divisions[task.division].rounds.at(-1);
      check(round.groups[task.heat].filter(Boolean).every(id=>round.results[id].times[task.run]!==null),'완료된 경기 순서에 누락된 기록이 있습니다.');
    }
    if(meeting.status==='completed')check(['awana','open'].every(k=>out.divisions[k].rounds.at(-1).status==='completed'));
    else check(out.divisions[schedule[meeting.cursor].division].rounds.at(-1).status==='active');
    out.meeting={status:meeting.status,cursor:meeting.cursor,...(meeting.order?{order:meeting.order}:{})};
  }
  return out;
}
