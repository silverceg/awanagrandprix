import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPhotoFile,photoConflicts} from '../public/common.js';
import * as common from '../public/common.js';
import {freshState,mutate} from '../lib/race.js';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const players=[{id:'a',name:'김하늘',car:'1'},{id:'b',name:'박서준',car:'2',drawPending:true},{id:'c',name:'동명이인',car:'3'},{id:'d',name:'동명이인',car:'4'}];
test('사진 파일은 이름·확정 번호로만 연결하고 종류 접미사를 인식',()=>{
  assert.deepEqual(matchPhotoFile('김하늘.jpg',players),{id:'a',field:'photoData'});
  assert.deepEqual(matchPhotoFile('김하늘_자동차.PNG',players),{id:'a',field:'carPhotoData'});
  assert.deepEqual(matchPhotoFile('001_car.webp',players),{id:'a',field:'carPhotoData'});
  assert.deepEqual(matchPhotoFile('김하늘_선수.jpg',players,'carPhotoData'),{id:'a',field:'photoData'});
  assert.deepEqual(matchPhotoFile('박서준.jpg',players,'carPhotoData'),{id:'b',field:'carPhotoData'});
  assert.equal(matchPhotoFile('김하늘'.normalize('NFD')+'.jpg',players).id,'a');
});
test('동명이인·추첨 전 임시 번호·일부 이름은 자동 연결하지 않음',()=>{
  for(const file of ['동명이인.jpg','2.jpg','하늘.jpg','IMG_0001.jpg','모르는이름.png'])assert.equal(matchPhotoFile(file,players).id,'',file);
});
test('동일 선수·동일 종류의 중복 업로드를 막고 두 종류와 저장 완료는 구분',()=>{
  const rows=[{id:'a',field:'photoData'},{id:'a',field:'photoData'},{id:'a',field:'carPhotoData'},{id:'',field:'photoData'}];
  assert.deepEqual([...photoConflicts(rows)],[0,1]);
  rows[0].saved=true;assert.equal(photoConflicts(rows).size,0);
  rows[0].saved=false;rows[1].error='사진 오류';assert.equal(photoConflicts(rows).size,0);
});

async function batchHost() {
  let remote=freshState();mutate(remote,'participants',{division:'awana',prepareDraw:true,entries:[{name:'김하늘',carName:'번개호'},{name:'박서준'}]});
  const elements=new Map(),element=k=>{
    if(!elements.has(k))elements.set(k,{hidden:true,value:'',innerHTML:'',querySelectorAll:()=>[],addEventListener(){},classList:{add(){},remove(){}}});
    return elements.get(k);
  };
  const requests=[];let failAt=2,attempts=0;
  const context=vm.createContext({...common,e:common.escape,$:element,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    document:{querySelector:element},window:{addEventListener(){}},connect(){},
    api:async(name,body)=>{
      if(name==='state')return structuredClone(remote);
      if(name==='session')return {authenticated:true,passwordRequired:false};
      requests.push(structuredClone(body));attempts++;
      if(attempts===failAt)throw new Error('네트워크 오류');
      assert.equal(body.revision,remote.revision);
      const metadata={...body};delete metadata.photoData;delete metadata.carPhotoData;
      mutate(remote,name,metadata);remote.revision++;return structuredClone(remote);
    }});
  const source=(await readFile(new URL('../public/host.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  await vm.runInContext(`(async()=>{${source}\nglobalThis.batch={load(items){bulkMode=true;bulkPhotos=items;},save:saveBulkPhotos,inspect:()=>({items:bulkPhotos,revision,saving,dirty})};})();`,context);
  return {batch:context.batch,remote,requests,allow(){failAt=-1;}};
}
test('사진 일부 저장 실패: 완료된 사진을 다시 보내지 않고 나머지만 재시도',async()=>{
  const h=await batchHost(),p=h.remote.divisions.awana.participants;
  h.batch.load([{id:p[0].id,field:'photoData',data:'image-a'},{id:p[1].id,field:'carPhotoData',data:'image-b'}]);
  // Fresh metadata is read before upload, so a previous name edit is preserved.
  p[0].name='변경된 김하늘';h.remote.revision++;
  await h.batch.save();
  assert.equal(h.requests[0].name,'변경된 김하늘');assert.equal(h.requests[0].car,'');
  assert.equal(h.requests[0].carName,'번개호');assert.equal(h.batch.inspect().items[0].saved,true);
  assert.equal(h.batch.inspect().items[1].saved,undefined);assert.equal(h.batch.inspect().items[1].data,'image-b');
  assert.equal(h.batch.inspect().saving,false);
  h.allow();await h.batch.save();
  assert.equal(h.requests.length,3);assert.equal(h.requests[2].id,p[1].id);
  assert.equal(h.batch.inspect().items.every(p=>p.saved),true);assert.equal(h.batch.inspect().dirty,false);
});
test('중복 연결 상태에서는 사진 저장 요청을 보내지 않음',async()=>{
  const h=await batchHost(),id=h.remote.divisions.awana.participants[0].id;
  h.batch.load([{id,field:'photoData',data:'a'},{id,field:'photoData',data:'b'}]);
  await h.batch.save();assert.equal(h.requests.length,0);
});
