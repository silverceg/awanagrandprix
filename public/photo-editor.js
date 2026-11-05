// Return a JPEG draft; the host's existing save action remains the only server write.
export async function editPhoto(source, car = false) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const dialog = document.createElement('dialog');
  dialog.className = 'photo-adjust-dialog';
  dialog.setAttribute('aria-labelledby','photo-adjust-title');
  dialog.innerHTML = `<h2 id="photo-adjust-title">${car?'자동차':'선수'} 사진 · 위치와 크기 조정</h2>
    <p>사진을 드래그해 옮기세요. 확대와 위치 막대로도 조정할 수 있습니다.</p>
    <div class="photo-adjust-layout"><canvas aria-label="저장할 사진 미리보기"></canvas><div class="photo-adjust-controls">
    <label>사진 비율<select data-adjust="ratio"><option value="1.7777777778">TV 가로 액자 · 16:9</option><option value="0.5">세로 액자 · 1:2</option><option value="0.75">세로 사진 · 3:4</option><option value="1">정사각형 · 1:1</option><option value="1.3333333333">자동차 가로 · 4:3</option><option value="original">원본 비율</option></select></label>
    <label>확대 <output data-readout="zoom">100%</output><input data-adjust="zoom" aria-label="사진 확대" type="range" min="1" max="5" step="0.01" value="1"></label>
    <label>좌우 위치<input data-adjust="x" aria-label="사진 좌우 위치" type="range" min="-100" max="100" step="1" value="0"></label>
    <label>위아래 위치<input data-adjust="y" aria-label="사진 위아래 위치" type="range" min="-100" max="100" step="1" value="0"></label>
    <button type="button" data-adjust-action="reset" class="ghost">사진 전체 보기 · 조정 초기화</button>
    <p class="hint">적용 후 ‘정보·사진 저장’을 누르면 현재 구도의 사진으로 교체됩니다. 원본 파일은 별도로 보관해 주세요.</p>
    </div></div><p class="photo-adjust-error" role="alert" hidden></p>
    <div class="form-actions"><button type="button" class="primary" data-adjust-action="apply">이 구도 적용</button><button type="button" class="ghost" data-adjust-action="cancel">취소</button></div>`;
  const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d');
  const control=name=>dialog.querySelector(`[data-adjust="${name}"]`);
  control('ratio').value=car?'1.3333333333':'1.7777777778';
  const draw=()=>{
    const ratio=control('ratio').value==='original'?image.naturalWidth/image.naturalHeight:Number(control('ratio').value);
    canvas.width=Math.max(1,Math.round(ratio>=1?512:512*ratio));
    canvas.height=Math.max(1,Math.round(ratio>=1?512/ratio:512));
    const zoom=Number(control('zoom').value),scale=Math.min(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight)*zoom;
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    const x=Number(control('x').value)*canvas.width/100,y=Number(control('y').value)*canvas.height/100;
    ctx.fillStyle='#e8f1fc';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,(canvas.width-w)/2+x,(canvas.height-h)/2+y,w,h);
    dialog.querySelector('[data-readout="zoom"]').textContent=Math.round(zoom*100)+'%';
  };
  draw();
  document.body.append(dialog);dialog.showModal();
  return new Promise(resolve=>{
    let finished=false,drag=null;
    const finish=value=>{if(finished)return;finished=true;dialog.close();dialog.remove();resolve(value);};
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
    dialog.addEventListener('input',draw);
    dialog.addEventListener('change',draw);
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();canvas.setPointerCapture(event.pointerId);
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,ox:Number(control('x').value),oy:Number(control('y').value)};
    });
    canvas.addEventListener('pointermove',event=>{
      if(!drag||drag.id!==event.pointerId)return;
      const rect=canvas.getBoundingClientRect();
      control('x').value=String(Math.max(-100,Math.min(100,drag.ox+(event.clientX-drag.x)*100/rect.width)));
      control('y').value=String(Math.max(-100,Math.min(100,drag.oy+(event.clientY-drag.y)*100/rect.height)));
      draw();
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drag=null;});
    dialog.addEventListener('click',event=>{
      const action=event.target.closest('[data-adjust-action]')?.dataset.adjustAction;
      if(action==='cancel')finish(null);
      if(action==='reset'){control('zoom').value='1';control('x').value=control('y').value='0';draw();}
      if(action==='apply'){
        try{
          let data=canvas.toDataURL('image/jpeg',.9);
          if(data.length>240000)data=canvas.toDataURL('image/jpeg',.65);
          if(data.length>240000)throw Error('사진 용량 초과');
          finish(data);
        }catch{const error=dialog.querySelector('.photo-adjust-error');error.hidden=false;error.textContent='사진을 적용하지 못했습니다. 다른 사진을 선택해 주세요.';}
      }
    });
  });
}
