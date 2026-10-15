import test from 'node:test';
import assert from 'node:assert/strict';
import {clearGroupSlot,numberedGroups} from '../public/common.js';
import {freshState,mutate} from '../lib/race.js';

const groups=n=>numberedGroups(Array.from({length:n},(_,i)=>({id:String(i+1),car:String(i+1)})));
test('40명 첫 조 4레인을 비우면 출전순 그대로 11조 자동 생성',()=>{
  const before=groups(40),after=clearGroupSlot(before,3);
  assert.deepEqual(after[0],['1','2','3',null]);
  assert.deepEqual(after[1],['4','5','6','7']);
  assert.deepEqual(after[10],['40',null,null,null]);
  assert.deepEqual(after.flat().filter(Boolean),before.flat());
  assert.deepEqual(before,groups(40));
});
test('일반부 18명은 마지막 조의 여유 칸 사용, 기존 중간 빈 레인 보존',()=>{
  const first=clearGroupSlot(groups(18),3),second=clearGroupSlot(first,7);
  assert.equal(first.length,5);assert.deepEqual(first[4],['16','17','18',null]);
  assert.equal(second.length,5);assert.equal(second[0][3],null);assert.equal(second[1][3],null);
  assert.deepEqual(second[4],['15','16','17','18']);
  assert.deepEqual(second.flat().filter(Boolean),groups(18).flat());
  assert.deepEqual(clearGroupSlot(second,3),second);
});
test('수동으로 바꾼 출전순 유지, 어느 칸을 비워도 누락·중복 없음',()=>{
  const original=groups(40);[original[0][0],original[4][2]]=[original[4][2],original[0][0]];
  for(let index=0;index<40;index++){
    const after=clearGroupSlot(original,index);
    assert.equal(after.flat()[index],null);
    assert.deepEqual(after.flat().filter(Boolean),original.flat());
    assert.equal(new Set(after.flat().filter(Boolean)).size,40);
    assert.equal(after.length,11);
  }
});
test('자동 이동한 11개 조로 예선 시작 및 다시 편성 저장 가능',()=>{
  const state=freshState();mutate(state,'participants',{division:'awana',entries:Array.from({length:40},(_,i)=>({name:'선수'+(i+1)}))});
  const players=state.divisions.awana.participants,shifted=clearGroupSlot(numberedGroups(players),3);
  mutate(state,'start',{division:'awana',groups:shifted});
  const r=state.divisions.awana.rounds[0];assert.deepEqual(r.groups,shifted);assert.equal(r.entrantIds.length,40);
  const again=clearGroupSlot(shifted,7);mutate(state,'groups',{division:'awana',roundId:r.id,groups:again});
  assert.deepEqual(r.groups,again);assert.equal(r.entrantIds.length,40);
});
