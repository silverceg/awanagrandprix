import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,mutate,currentRound,standings,lanesFor} from '../lib/race.js';

test('진출자는 최고 기록으로 선발하되 기존 조·1차 레인 순서를 유지하며 4명씩 편성',()=>{
  for(const [division,count] of [['awana',45],['open',18]]){
    const state=freshState();
    mutate(state,'participants',{division,entries:Array.from({length:count},(_,i)=>({name:`선수${i}`,car:String(100+i),carName:`자동차${i}`}))});
    mutate(state,'start',{division});const d=state.divisions[division],originalParticipants=structuredClone(d.participants);
    while(currentRound(d).advance){
      const old=currentRound(d),appearance=old.groups.flat();
      // Faster participants are at the end, so ranking order differs from appearance order.
      appearance.forEach((id,i)=>old.results[id].times=[5000-i*10,6000-i*10]);
      const selected=standings(d).slice(0,old.advance).map(p=>p.id);
      const expected=appearance.filter(id=>selected.includes(id));
      const oldRecords=structuredClone(old.results);
      mutate(state,'finish',{division,roundId:old.id});const next=currentRound(d);
      assert.deepEqual(old.advancedIds,selected);
      assert.notDeepEqual(expected,selected);
      assert.deepEqual(next.groups.flat(),expected);
      assert.deepEqual(next.entrantIds,expected);
      assert.deepEqual(next.groups,Array.from({length:expected.length/4},(_,i)=>expected.slice(i*4,i*4+4)));
      assert.deepEqual(old.results,oldRecords);
      assert.deepEqual(d.participants,originalParticipants); // Sticker numbers never change.
      for(const rec of Object.values(next.results))assert.deepEqual(rec,{times:[null,null],scoreMs:0,tieBreak:null});
      for(let h=0;h<next.groups.length;h++)for(const id of next.groups[h])assert.equal(lanesFor(next,h,1).indexOf(id),lanesFor(next,h,0).indexOf(id));
    }
  }
});
