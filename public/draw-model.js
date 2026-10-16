// The sticker is the draw result: 1–4 => heat 1, 5–8 => heat 2, etc.
export function numberDraw(participants) {
  const groups=Array.from({length:10},()=>Array(4).fill(null)), invalid=[], pending=[], seats=new Map();
  for(const p of participants) {
    if(p.drawPending===true){pending.push(p);continue;}
    const value=String(p.car ?? '').trim(),number=Number(value);
    if(!/^\d+$/.test(value) || number<1 || number>40) {invalid.push(p);continue;}
    const candidates=seats.get(number)||[];candidates.push(p);seats.set(number,candidates);
  }
  for(const [number,players] of seats) {
    if(players.length!==1) {invalid.push(...players);continue;}
    groups[Math.floor((number-1)/4)][(number-1)%4]=players[0];
  }
  return {groups,invalid,pending,count:groups.flat().filter(Boolean).length};
}
