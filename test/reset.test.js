import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../lib/store.js';
import {createApp} from '../server.js';
import {lanesFor} from '../lib/race.js';

function seed(store){
  const act=(action,body)=>store.update(action,{revision:store.read().revision,...body});
  for(const [division,count] of [['awana',45],['open',18]]){
    act('participants',{division,entries:Array.from({length:count},(_,i)=>({name:`참가자${i}`,car:String(i+101),carName:`번개${i}`}))});
    const s=act('start',{division}),r=s.divisions[division].rounds[0];
    act('records',{division,roundId:r.id,heat:0,run:0,records:Object.fromEntries(lanesFor(r,0,0).filter(Boolean).map(id=>[id,'3.123']))});
  }
  return act;
}
test('리허설 초기화: 두 부문 기록 제거, 명단·번호 유지, 파일 백업과 재시작 보존',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-reset-'));let store=createStore(dir);
  try{
    const act=seed(store),before=store.read();
    assert.throws(()=>act('reset-records',{confirmation:'초기화'}),/정확히/);
    assert.deepEqual(store.read(),before);
    const after=act('reset-records',{confirmation:'기록 초기화'});
    assert.equal(after.revision,before.revision+1);
    for(const key of ['awana','open']){
      assert.deepEqual(after.divisions[key].participants,before.divisions[key].participants);
      assert.deepEqual(after.divisions[key].rounds,[]);
    }
    assert.deepEqual(after.display,{division:'awana',heat:0,run:0,mode:'race'});
    assert.deepEqual(JSON.parse(store.resetBackup()).state,before);
    assert.deepEqual(JSON.parse(readFileSync(join(dir,'rehearsal-backups',after.lastReset.backupFile),'utf8')).state,before);
    assert.equal(store.audit()[0].action,'reset-records');
    store.close();store=createStore(dir);assert.deepEqual(store.read(),after);
    store.update('start',{revision:after.revision,division:'awana'});
    assert.equal(store.read().divisions.awana.rounds[0].entrantIds.length,45);
    assert.equal(readdirSync(join(dir,'rehearsal-backups')).length,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('백업 파일 저장 실패 시 초기화 롤백',()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-reset-fail-'));const store=createStore(dir);
  try{
    const act=seed(store),before=store.read();
    writeFileSync(join(dir,'rehearsal-backups'),'backup path blocked for test');
    assert.throws(()=>act('reset-records',{confirmation:'기록 초기화'}));
    assert.deepEqual(store.read(),before);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('초기화 API 권한·확인문구·충돌 방지 및 TV 갱신',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-reset-api-'));const app=createApp({dataDir:dir,pin:'reset-test-123',production:false});let reader;
  try{
    seed(app.store);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${app.server.address().port}`;
    const login=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'reset-test-123'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const post=(body,auth=true)=>fetch(url+'/api/reset-records',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{cookie}:{})},body:JSON.stringify(body)});
    const before=app.store.read(),body={revision:before.revision,confirmation:'기록 초기화'};
    assert.equal((await post(body,false)).status,401);
    assert.equal((await post({...body,revision:0})).status,409);
    assert.equal((await post({...body,confirmation:''})).status,400);
    assert.equal((await fetch(url+'/api/reset-backup',{headers:{cookie}})).status,404);
    reader=(await fetch(url+'/api/events')).body.getReader();
    // A network read can contain only part of an SSE event.
    let pending='';const decoder=new TextDecoder();
    const readEvent=async()=>{
      while(!pending.includes('\n\n')){
        const chunk=await reader.read();assert.equal(chunk.done,false);
        pending+=decoder.decode(chunk.value,{stream:true});
      }
      const end=pending.indexOf('\n\n'),event=pending.slice(0,end);pending=pending.slice(end+2);return event;
    };
    await readEvent();
    assert.equal((await post(body)).status,200);
    const update=await readEvent();assert.match(update,/lastReset/);
    assert.equal((await fetch(url+'/api/reset-backup')).status,401);
    const file=await fetch(url+'/api/reset-backup',{headers:{cookie}});assert.equal(file.status,200);
    assert.deepEqual((await file.json()).state,before);
    assert.equal((await post(body)).status,409);
  }finally{if(reader)await reader.cancel();await app.close();rmSync(dir,{recursive:true,force:true});}
});
