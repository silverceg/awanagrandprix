import { RaceError, freshState, plans } from './race.js';

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
      for (const field of ['photoUrl','carPhotoUrl']) if (p[field]) { check(mediaPath.test(p[field]), '사진 주소가 지원되지 않습니다. 이 프로그램에서 내려받은 백업을 사용하세요.'); result[field] = p[field]; }
      return result;
    });
    out.divisions[key].rounds = d.rounds.map((r,index) => {
      check(r && id(r.id) && r.index === index && ['active','completed'].includes(r.status) && (index === d.rounds.length-1 || r.status === 'completed'));
      check(unique(r.entrantIds) && r.entrantIds.length > 0 && r.entrantIds.every(x => ids.has(x)));
      if (index === 0) check(r.entrantIds.length === ids.size);
      else check(r.entrantIds.length === plans[key][index-1].advance && r.entrantIds.every(x => d.rounds[index-1].advancedIds?.includes(x)));
      check(Array.isArray(r.groups) && r.groups.length > 0 && r.groups.every(g => Array.isArray(g) && g.length > 0 && g.length <= 4));
      const grouped = r.groups.flat();
      check(unique(grouped) && grouped.length === r.entrantIds.length && grouped.every(x => r.entrantIds.includes(x)));
      check(r.results && Object.keys(r.results).length === r.entrantIds.length);
      const results = Object.fromEntries(r.entrantIds.map(x => {
        const rec = r.results[x];
        check(rec && Array.isArray(rec.times) && rec.times.length === 2 && rec.times.every(time) && time(rec.tieBreak));
        if (r.status === 'completed') check(rec.times.every(t => t !== null));
        const valid = rec.times.filter(t => typeof t === 'number');
        return [x,{times:[...rec.times],scoreMs:valid.length ? Math.min(...valid) : 0,tieBreak:rec.tieBreak}];
      }));
      const result = {id:r.id,index,...plans[key][index],status:r.status,createdAt:str(r.createdAt,40)?r.createdAt:new Date().toISOString(),entrantIds:[...r.entrantIds],groups:r.groups.map(g=>[...g]),results};
      if (r.status === 'completed') {
        result.closedAt = str(r.closedAt,40)?r.closedAt:new Date().toISOString();
        if (result.advance) { check(unique(r.advancedIds) && r.advancedIds.length === result.advance && r.advancedIds.every(x=>r.entrantIds.includes(x))); result.advancedIds = [...r.advancedIds]; }
        else { check(r.entrantIds.includes(r.winnerId)); result.winnerId = r.winnerId; }
      }
      return result;
    });
  }
  const display = s.display, r = out.divisions[display.division]?.rounds.at(-1);
  check(['awana','open'].includes(display.division) && ['race','ranking'].includes(display.mode) && [0,1].includes(display.run) && Number.isInteger(display.heat) && display.heat >= 0 && (r ? display.heat < r.groups.length : display.heat === 0));
  out.display = {division:display.division,heat:display.heat,run:display.run,mode:display.mode};
  return out;
}
