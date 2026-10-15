import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freshState,mutate,lanesFor} from '../lib/race.js';
import {createApp} from '../server.js';
import {parseRoster,orderedGroups} from '../public/common.js';
import {renderBoard} from '../public/leaderboard.js';
import {validateBackup} from '../lib/restore.js';

function seed(s,key,count){mutate(s,'participants',{division:key,entries:Array.from({length:count},(_,i)=>({name:key+i,car:String(i+1),carName:'차'+i}))});return s.divisions[key].participants.map(p=>p.id);}
function finish(s,key){const r=s.divisions[key].rounds.at(-1);for(let heat=0;heat<r.groups.length;heat++)for(let run=0;run<2;run++)mutate(s,'records',{division:key,roundId:r.id,heat,run,records:Object.fromEntries(r.groups[heat].map(id=>[id,(3+s.divisions[key].participants.findIndex(p=>p.id===id)/100+run/10).toFixed(3)]))});mutate(s,'finish',{division:key,roundId:r.id});}

test('엑셀 TSV: 제목 순서·빈 번호·이름만·CSV 따옴표·문자 번호',()=>{
  assert.deepEqual(parseRoster('자동차 이름\t이름\t번호\r\n번개\t김하늘\t01\r\n\t박서준\t\r\n'),[{name:'김하늘',car:'01',carName:'번개'},{name:'박서준',car:'',carName:''}]);
  assert.deepEqual(parseRoster('김하늘\n박서준').map(p=>p.name),['김하늘','박서준']);
  assert.equal(parseRoster('김하늘\t번개')[0].carName,'번개');
  assert.equal(parseRoster('A01\t김하늘','number-name-car')[0].car,'A01');
  assert.equal(parseRoster('1,김하늘,"빠른, 차"')[0].carName,'빠른, 차');
  assert.equal(parseRoster('번호\t이름\t자동차 이름\n1\t김하늘\t"번개 ""일호"""')[0].carName,'번개 "일호"');
});
test('엑셀 잘못된 행은 조용히 버리지 않고 오류 안내',()=>{
  for(const input of ['', '1\t\t번개', '번호\t이름\t\n1\t김하늘\t잃어버릴값','번호\t이름\t이름\n1\t김\t박','1\t김\t차\t추가', '1\t"김\n하늘"\t차','1\t"미완성'])assert.throws(()=>parseRoster(input));
  assert.throws(()=>parseRoster(Array(101).fill('김하늘').join('\n')));
});
test('혼합 번호 붙여넣기: 직접 지정한 번호를 먼저 예약하고 빈칸 자동 배정',()=>{
  const s=freshState();mutate(s,'participants',{division:'open',entries:parseRoster('번호\t이름\n\t자동\n1\t지정\n\t다음')});
  assert.deepEqual(s.divisions.open.participants.map(p=>p.car),['2','1','3']);
});
test('수동 조 편성: 40/18명 중복 없이 배치, 2차 선수 순서 유지, 변경 후 백업 복원',()=>{
  const s=freshState();
  for(const [division,count] of [['awana',40],['open',18]]){
    const ids=seed(s,division,count),groups=orderedGroups(ids.reverse());
    assert.ok(groups.every(g=>g.length>=3&&g.length<=4));
    mutate(s,'start',{division,groups});const r=s.divisions[division].rounds[0];
    assert.deepEqual(r.groups,groups);assert.deepEqual(lanesFor(r,0,1),groups[0]);
    const savedResults=structuredClone(r.results),swapped=groups.map(g=>[...g]);
    [swapped[0][0],swapped[1][1]]=[swapped[1][1],swapped[0][0]];
    mutate(s,'groups',{division,roundId:r.id,groups:swapped});
    assert.deepEqual(r.groups,swapped);assert.deepEqual(r.results,savedResults);
  }
  assert.deepEqual(validateBackup({state:s}).divisions,s.divisions);
});
test('누락·중복·타 부문·빈 조·5명 조·기록 시작 후 변경 거절',()=>{
  const s=freshState(),ids=seed(s,'awana',16),foreign=seed(s,'open',18);
  const groups=orderedGroups(ids);
  for(const invalid of [[],[[]],groups.slice(1),[[...ids.slice(0,5)],...groups.slice(1)],[[foreign[0],...groups[0].slice(1)],...groups.slice(1)],[[ids[4],...groups[0].slice(1)],...groups.slice(1)]]){
    assert.throws(()=>mutate(s,'start',{division:'awana',groups:invalid}));
    assert.equal(s.divisions.awana.rounds.length,0);
  }
  mutate(s,'start',{division:'awana',groups});const r=s.divisions.awana.rounds[0];
  assert.throws(()=>mutate(s,'groups',{division:'awana',roundId:'old',groups}));
  mutate(s,'records',{division:'awana',roundId:r.id,heat:0,run:0,records:Object.fromEntries(groups[0].map(id=>[id,'DNF']))});
  assert.throws(()=>mutate(s,'groups',{division:'awana',roundId:r.id,groups}),/기록 입력/);
});
test('수동 예선의 출전순 유지: 기록 선발 후 4명씩, 이전 기록 보존',()=>{
  const s=freshState(),ids=seed(s,'awana',40),groups=orderedGroups(ids.reverse());
  mutate(s,'start',{division:'awana',groups});finish(s,'awana');
  const [old,next]=s.divisions.awana.rounds;
  const expected=groups.flat().filter(id=>old.advancedIds.includes(id));
  assert.deepEqual(next.groups.flat(),expected);assert.ok(next.groups.every(g=>g.length===4));
  assert.equal(old.status,'completed');assert.ok(Object.values(next.results).every(rec=>rec.times.every(t=>t===null)&&rec.scoreMs===0));
});
test('통합 순위: 예선 단독 → 어와나16 + 일반부18 → 일반부8, 고정 화면 유지',()=>{
  const s=freshState();seed(s,'awana',40);seed(s,'open',18);
  assert.equal((renderBoard(s).match(/class="entry empty"/g)||[]).length,40);
  mutate(s,'start',{division:'awana'});finish(s,'awana');
  let html=renderBoard(s);assert.match(html,/combined-board/);assert.equal((html.match(/class="entry empty"/g)||[]).length,34);
  assert.ok(!html.includes('awana0'));assert.ok(!html.includes('open0'));
  assert.ok(!renderBoard(s,'awana').includes('combined-board'));
  assert.equal((renderBoard(s,'awana').match(/class="entry empty"/g)||[]).length,16);
  mutate(s,'start',{division:'open'});html=renderBoard(s);
  assert.match(html,/on-air" data-board-division="open"/);
  assert.equal((renderBoard(s,'open').match(/class="entry empty"/g)||[]).length,18);
  finish(s,'open');assert.equal((renderBoard(s).match(/class="entry empty"/g)||[]).length,24);
  mutate(s,'reset-records',{confirmation:'기록 초기화'});assert.ok(!renderBoard(s).includes('combined-board'));
  assert.match(renderBoard(s,'both'),/combined-board/);
});
test('HTTP 수동 편성 저장·재시작 보존·충돌 차단 및 명단 일괄 등록 롤백',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-manual-'));let app=createApp({dataDir:dir,pin:'',production:false});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    const post=async(action,body)=>{const res=await fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:app.store.read().revision,division:'open',...body})});return {status:res.status,data:await res.json()};};
    assert.equal((await post('participants',{entries:parseRoster(Array.from({length:18},(_,i)=>'선수'+i).join('\n'))})).status,200);
    const before=app.store.read();assert.equal((await post('participants',{entries:[{name:'추가'},{name:''}]})).status,400);assert.deepEqual(app.store.read(),before);
    const groups=orderedGroups(before.divisions.open.participants.map(p=>p.id));
    assert.equal((await post('start',{groups})).status,200);
    const r=app.store.read().divisions.open.rounds[0],changed=groups.toReversed();
    assert.equal((await post('groups',{roundId:r.id,groups:changed})).status,200);
    assert.equal((await post('groups',{revision:0,roundId:r.id,groups})).status,409);
    const saved=app.store.read();await app.close();app=createApp({dataDir:dir,pin:'',production:false});
    assert.deepEqual(app.store.read(),saved);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
