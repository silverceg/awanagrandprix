import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,mutate} from '../lib/race.js';
import {numberedGroups,parseRoster} from '../public/common.js';

test('이름만 등록하면 어와나 1~40번, 일반부 41~58번 자동 배정',()=>{
  const state=freshState();
  for(const [division,count,start] of [['awana',40,1],['open',18,41]]) {
    mutate(state,'participants',{division,entries:parseRoster(Array.from({length:count},(_,i)=>'선수'+i).join('\n'))});
    const players=state.divisions[division].participants;
    assert.deepEqual(players.map(p=>p.car),Array.from({length:count},(_,i)=>String(start+i)));
    const groups=numberedGroups(players);
    assert.deepEqual(groups.flat(),players.map(p=>p.id));
    mutate(state,'start',{division,groups});
    assert.deepEqual(state.divisions[division].rounds[0].entrantIds,players.map(p=>p.id));
  }
});
test('일반부 나누어 등록·예약 번호 회피·기존 수동 번호 보존',()=>{
  const state=freshState(),division='open';
  mutate(state,'participants',{division,entries:[{name:'기존',car:'1'},{name:'지정',car:'43'}]});
  mutate(state,'participants',{division,entries:[{name:'자동1'},{name:'직접41',car:'41'},{name:'자동2'}]});
  assert.deepEqual(state.divisions.open.participants.map(p=>p.car),['1','43','42','41','44']);
  mutate(state,'participants',{division,entries:[{name:'추가'}]});
  assert.equal(state.divisions.open.participants.at(-1).car,'45');
});
