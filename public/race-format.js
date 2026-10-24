// Shared by server and all screens: run-indexed storage, physical-lane display.
export const isFour = r => r?.format === 'four-lanes';
export const runCount = r => isFour(r) ? 4 : 2;
export function laneRecords(r, id) {
  const result = [null, null, null, null];
  const group = r?.groups.find(g => g.includes(id));
  if (!group) return result;
  const start = group.indexOf(id);
  r.results[id].times.forEach((time, run) => { result[isFour(r) ? (start + run) % 4 : start] = time; });
  return result;
}
export const phases = ['본선 1라운드', '본선 2라운드', '본선 3라운드', '본선 4라운드'];
export const legacyOrder = state => !!state.meeting && state.meeting.order !== 'round-robin';
export function groupNumber(state, division, heat) {
  const awana = state.divisions.awana;
  const offset = awana.rounds.at(-1)?.groups.length || Math.ceil((awana.participants.length || 40) / 4);
  return heat + 1 + (division === 'open' ? offset : 0);
}
export function eventSchedule(state) {
  const list = [];
  const add = (division, heat, run, phase=run) => list.push({division,heat,run,phase});
  // Saved events keep their old cursor meaning until the host explicitly changes order.
  if (legacyOrder(state)) {
    for (const [phase,division,runs] of [[0,'awana',[0,1]],[1,'open',[0,1,2,3]],[2,'awana',[2,3]]]) {
      const r=state.divisions[division].rounds.at(-1);
      if(isFour(r))r.groups.forEach((_,heat)=>runs.forEach(run=>add(division,heat,run,phase)));
    }
  } else {
    for(let run=0;run<4;run++)for(const division of ['awana','open']) {
      const r=state.divisions[division].rounds.at(-1);
      if(isFour(r))r.groups.forEach((_,heat)=>add(division,heat,run));
    }
  }
  return list;
}
export const scheduledRace = state => state.meeting?.status === 'active' ? eventSchedule(state)[state.meeting.cursor] : null;
