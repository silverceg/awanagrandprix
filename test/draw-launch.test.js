import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createApp} from '../server.js';
const names=['draw-intro.wav','draw-crowd.wav','draw-rhythm.wav'];
const source=readFileSync(new URL('../public/draw.js',import.meta.url),'utf8');

test('세 음원 HTTP 제공: 각각 5초 스테레오 WAV, 클리핑 없음',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'awana-audio-')),app=createApp({dataDir:dir,pin:''});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    for(const name of names){
      const res=await fetch(base+'/sounds/'+name);
      assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/^audio\/wav/);
      const data=Buffer.from(await res.arrayBuffer());
      assert.deepEqual(data,readFileSync(new URL('../public/sounds/'+name,import.meta.url)));
      assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');
      assert.equal(data.readUInt32LE(24),44100);assert.equal(data.readUInt16LE(22),2);assert.equal(data.readUInt16LE(34),16);
      assert.equal(data.readUInt32LE(40)/(44100*4),5);
      let peak=0;for(let i=44;i<data.length;i+=2)peak=Math.max(peak,Math.abs(data.readInt16LE(i))/32768);
      assert.ok(peak>.5&&peak<.86,`${name}: ${peak}`);
    }
    assert.equal((await fetch(base+'/sounds/missing.wav')).status,404);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('1→2→3→1 순환, 음소거·정지·다시 켜기·동작 줄이기',()=>{
  const created=[],buffers=names.map(id=>({id,duration:5}));
  const context=vm.createContext({reduced:{matches:false},soundOn:false,SOUND_URLS:names,launchBuffers:buffers,nextSound:0,master:{},audioContext:{state:'running',currentTime:10,createBufferSource(){const src={connect(){},disconnect(){},start(t,offset){this.started=t;this.offset=offset;},stop(t){this.stopped=t??'now';}};created.push(src);return src;}}});
  vm.runInContext(source.slice(source.indexOf('const sounding='),source.indexOf("$('#sound-volume')"))+source.slice(source.indexOf('function startRevealSound()'),source.indexOf('function arrivalSound()')),context);
  const play=()=>vm.runInContext('startRevealSound()',context),stop=()=>vm.runInContext('stopSound()',context);
  assert.equal(play(),0);assert.equal(context.nextSound,0);assert.equal(created.length,0);
  context.soundOn=true;
  for(const index of [0,1,2,0]){
    assert.equal(play(),5000);const src=created.at(-1);assert.equal(src.buffer,buffers[index]);
    assert.equal(src.started,10);assert.equal(src.offset,0);assert.equal(src.stopped,15);
    stop();assert.equal(src.stopped,'now');assert.equal(vm.runInContext('sounding.size',context),0);
  }
  context.soundOn=false;assert.equal(play(),0);assert.equal(context.nextSound,1);
  context.soundOn=true;context.audioContext.state='suspended';assert.equal(play(),0);assert.equal(context.nextSound,1);
  context.audioContext.state='running';context.reduced.matches=true;
  assert.equal(play(),2650);assert.equal(created.at(-1).buffer,buffers[1]);assert.equal(created.at(-1).offset,2.35);stop();
});

test('음원 사전 로딩 실패 시 순서를 유지하고 3개 모두 다시 준비',async()=>{
  let fail=true,calls=0;
  const context=vm.createContext({SOUND_URLS:names,launchBuffers:[],audioContext:{decodeAudioData:async bytes=>({bytes,duration:5})},fetch:async url=>{calls++;return {ok:!(fail&&url===names[1]),arrayBuffer:async()=>url};}});
  vm.runInContext(source.slice(source.indexOf('async function loadLaunch()'),source.indexOf('const sounding=')),context);
  await assert.rejects(vm.runInContext('loadLaunch()',context),/launch-load/);assert.equal(context.launchBuffers.length,0);
  fail=false;await vm.runInContext('loadLaunch()',context);assert.equal(context.launchBuffers.length,3);
  assert.deepEqual(Array.from(context.launchBuffers,b=>b.bytes),names);assert.equal(calls,6);
  await vm.runInContext('loadLaunch()',context);assert.equal(calls,6);
});
