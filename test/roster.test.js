import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../lib/store.js';
import {createApp} from '../server.js';
import {freshState,mutate} from './legacy-fixture.js';
import {boardData,renderBoard} from '../public/leaderboard.js';

const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
const temporary=()=>mkdtempSync(join(tmpdir(),'awana-roster-'));
test('기존 41명·18명 데이터 호환: 예선 조 편성, 전체 칸 수와 완주 후 진출',()=>{
  const s=freshState(),update=(name,body)=>mutate(s,name,body);
  assert.equal(boardData(s).count,40);
  for(const [division,count,fours,threes,advance] of [['awana',41,8,3,16],['open',18,3,2,8]]){
    seed(update,division,count);update('start',{division});const r=s.divisions[division].rounds[0];
    assert.equal(r.groups.filter(g=>g.length===4).length,fours);assert.equal(r.groups.filter(g=>g.length===3).length,threes);
    assert.equal(boardData(s).count,count);
    for(let heat=0;heat<r.groups.length;heat++)for(let run=0;run<2;run++) update('records',{division,roundId:r.id,heat,run,records:Object.fromEntries(r.groups[heat].map(id=>[id,(3+s.divisions[division].participants.findIndex(p=>p.id===id)/100+run/10).toFixed(3)]))});
    assert.equal(boardData(s).list.length,count);update('finish',{division,roundId:r.id});assert.equal(boardData(s).count,advance);assert.equal(boardData(s).list.length,0);
  }
});
function act(store){return (name,body={})=>store.update(name,{revision:store.read().revision,...body});}
function seed(fn,division='awana',count=45){fn('participants',{division,entries:Array.from({length:count},(_,i)=>({name:`선수${i+1}`}))});}
test('이름만 등록 후 번호·이름·차량·사진 수정, 경기 연결 유지 및 재시작 영속성',()=>{
  const dir=temporary();let store=createStore(dir);
  try{
    let update=act(store);seed(update);let p=store.read().divisions.awana.participants[0];
    assert.equal(p.car,'1');assert.equal(p.carName,'');
    update('start',{division:'awana'});const before=store.read().divisions.awana.rounds;
    update('participant-update',{division:'awana',id:p.id,name:'새 이름',car:'101',carName:'번개호',photoData:jpeg,carPhotoData:jpeg});
    p=store.read().divisions.awana.participants[0];assert.match(p.photoUrl,/^\/media\//);assert.equal(p.photoUrl,p.carPhotoUrl);
    assert.deepEqual(store.read().divisions.awana.rounds,before);assert.ok(store.media(p.photoUrl));
    const saved=store.read();assert.throws(()=>update('participant-update',{division:'awana',id:p.id,name:'중복',car:'2',carName:''}),/중복/);assert.deepEqual(store.read(),saved);
    assert.throws(()=>update('participant-update',{division:'awana',id:p.id,name:'실패',car:'102',carName:'',photoData:'data:image/svg+xml;base64,YQ=='}));assert.deepEqual(store.read(),saved);
    store.close();store=createStore(dir);update=act(store);assert.deepEqual(store.read(),saved);assert.ok(store.media(p.photoUrl));
    update('participant-update',{division:'awana',id:p.id,name:p.name,car:p.car,carName:p.carName,photoData:''});
    assert.equal(store.read().divisions.awana.participants[0].photoUrl,'');assert.equal(store.read().divisions.awana.participants[0].carPhotoUrl,p.carPhotoUrl);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('사진 포함 전체 백업을 다른 서버로 복원, 기존 데이터 자동 백업, 충돌·손상 차단',()=>{
  const a=temporary(),b=temporary(),source=createStore(a),target=createStore(b);
  try{
    const update=act(source);seed(update);seed(update,'open',18);const p=source.read().divisions.awana.participants[0];
    update('participant-update',{division:'awana',id:p.id,name:p.name,car:p.car,carName:'노란차',photoData:jpeg,carPhotoData:jpeg});update('start',{division:'awana'});
    update('start',{division:'open'});const round=source.read().divisions.awana.rounds[0];update('records',{division:'awana',roundId:round.id,heat:0,run:0,records:Object.fromEntries(round.groups[0].map(id=>[id,'3.123']))});
    const backup=source.export(),restore=act(target);restore('title',{title:'원래 행사'});const before=target.read();
    const result=restore('restore',{confirmation:'백업 복원',backup});assert.equal(result.revision,before.revision+1);
    assert.deepEqual(result.divisions,backup.state.divisions);assert.deepEqual(JSON.parse(target.resetBackup()).state,before);assert.ok(target.media(result.divisions.awana.participants[0].photoUrl));
    assert.throws(()=>target.update('restore',{revision:0,confirmation:'백업 복원',backup}),/변경/);
    for(const corrupt of [null,{state:freshState(),images:[]},{state:{...backup.state,divisions:{}}}]){assert.throws(()=>restore('restore',{confirmation:'백업 복원',backup:corrupt}));assert.deepEqual(target.read(),result);}
    const invalid=structuredClone(backup);invalid.state.divisions.awana.rounds[0].groups[0].push('missing');assert.throws(()=>restore('restore',{confirmation:'백업 복원',backup:invalid}));assert.deepEqual(target.read(),result);
    restore('reset-records',{confirmation:'기록 초기화'});const resetBackup=JSON.parse(target.resetBackup());assert.ok(resetBackup.images[p.photoUrl] || Object.keys(resetBackup.images).length===1);
    restore('restore',{confirmation:'백업 복원',backup:resetBackup});assert.deepEqual(target.read().divisions,backup.state.divisions);
  }finally{source.close();target.close();rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true});}
});
test('이전 버전 JSON 백업 호환, 사진 누락·백업 쓰기 실패 시 복원하지 않음',()=>{
  const dir=temporary(),store=createStore(dir);
  try{
    const update=act(store),legacy={state:freshState()};update('restore',{confirmation:'백업 복원',backup:legacy});
    const missing=structuredClone(legacy);mutate(missing.state,'participants',{division:'open',entries:[{name:'샘플'}]});missing.state.divisions.open.participants[0].photoUrl='/media/'+'a'.repeat(64)+'.jpg';
    const before=store.read();assert.throws(()=>update('restore',{confirmation:'백업 복원',backup:missing}),/사진/);assert.deepEqual(store.read(),before);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
  const blocked=temporary(),s=createStore(blocked);
  try{writeFileSync(join(blocked,'rehearsal-backups'),'blocked');const before=s.read();assert.throws(()=>act(s)('restore',{confirmation:'백업 복원',backup:{state:freshState()}}));assert.deepEqual(s.read(),before);}finally{s.close();rmSync(blocked,{recursive:true,force:true});}
});
test('전체 순위: 경기 전 이름 숨김, 45명 완료, 어와나16칸/일반부18칸 별도 전환',()=>{
  const s=freshState(),update=(name,body)=>mutate(s,name,body);seed(update);seed(update,'open',18);
  assert.equal(boardData(s).list.length,0);assert.equal((renderBoard(s).match(/class="entry empty"/g)||[]).length,63);assert.ok(!renderBoard(s).includes('선수1'));
  update('start',{division:'awana'});const r=s.divisions.awana.rounds[0];
  for(let heat=0;heat<r.groups.length;heat++)for(let run=0;run<2;run++){
    update('records',{division:'awana',roundId:r.id,heat,run,records:Object.fromEntries(r.groups[heat].map(id=>[id,(3+s.divisions.awana.participants.findIndex(p=>p.id===id)/100+run/10).toFixed(3)]))});
    if(heat===0&&run===0)assert.equal(boardData(s).list.length,0);
  }
  assert.equal(boardData(s).list.length,45);assert.equal((renderBoard(s).match(/class="entry tier-/g)||[]).length,45);
  update('finish',{division:'awana',roundId:r.id});assert.equal(boardData(s).count,16);assert.equal(boardData(s).list.length,0);
  update('start',{division:'open'});assert.equal(boardData(s).count,18);assert.equal(boardData(s,'awana').count,16);assert.equal(boardData(s,'open').list.length,0);assert.ok(!renderBoard(s).includes('선수1'));
});
test('HTTP 사진 조회·인증·백업 복원 및 전체 순위 경로',async()=>{
  const dir=temporary(),app=createApp({dataDir:dir,pin:'roster-test-123',production:false});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${app.server.address().port}`;
    const post=(name,body,cookie)=>fetch(url+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
    assert.equal((await post('restore',{revision:0})).status,401);assert.equal((await post('participant-update',{revision:0})).status,401);
    const login=await post('login',{pin:'roster-test-123'}),cookie=login.headers.get('set-cookie').split(';')[0];
    let res=await post('participants',{revision:0,division:'open',entries:[{name:'테스트'}]},cookie),s=await res.json(),p=s.divisions.open.participants[0];
    res=await post('participant-update',{revision:s.revision,division:'open',id:p.id,name:p.name,car:'42',carName:'달려라',photoData:jpeg},cookie);assert.equal(res.status,200);s=await res.json();
    assert.equal((await fetch(url+s.divisions.open.participants[0].photoUrl)).headers.get('content-type'),'image/jpeg');
    const backup=await (await fetch(url+'/api/export',{headers:{cookie}})).json();assert.equal(Object.keys(backup.images).length,1);
    assert.equal((await post('restore',{revision:s.revision,confirmation:'백업 복원',backup},cookie)).status,200);
    for(const path of ['/leaderboard','/leaderboard.js','/leaderboard.css'])assert.equal((await fetch(url+path)).status,200);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

