const Workshop=(()=>{
  const key='quizrun-saved-quizzes-v1';
  const seed=[['대한민국의 수도는?',['부산','서울','인천','대구'],1,'대한민국의 수도는 서울입니다.'],['7×8은?',['54','48','56','64'],2,'7×8=56입니다.']];
  let saved=[],readError='',drafts=null,active=0,index=0,importing=false;
  try{
    const raw=localStorage.getItem(key);
    if(raw){
      saved=JSON.parse(raw);
      if(!Array.isArray(saved))throw Error();
    }
  }catch{saved=[];readError='이 브라우저에서 저장된 퀴즈를 읽을 수 없습니다.';}
  function persist(next){
    if(readError)throw Error('저장 공간을 읽을 수 없어 변경을 저장하지 못했습니다.');
    try{localStorage.setItem(key,JSON.stringify(next));}
    catch{throw Error('이 브라우저에 저장하지 못했습니다. 저장 공간이나 브라우저 설정을 확인하세요.');}
    saved=next;
  }
  const empty=()=>({entry:['',['','','',''],-1,'']});
  const find=id=>saved.find(q=>q.id===id);
  const draft=()=>drafts[active];
  const current=()=>draft().entries[index];
  function toast(message){document.querySelector('#workshop-status').textContent=message;}
  function emptyDraft(){return {title:'',entries:[empty()]};}
  function start(batch){drafts=batch;active=0;index=0;refresh();showErrors();}
  function refresh(){
    document.querySelector('#workshop-content').innerHTML=drafts?editor():cards();
    if(drafts)drawPreview();
  }
  function showErrors(){
    const list=document.querySelector('#validation');
    if(!list||!drafts)return;
    list.replaceChildren();
    const issues=QuizData.validate(draft());
    for(const issue of issues){
      const li=document.createElement('li');li.textContent=issue;list.append(li);
    }
    list.hidden=!issues.length;
  }
  function cards(){
    return saved.length?saved.map(q=>`<article class="panel saved-quiz"><div><h2>${escapeText(q.title)}</h2><p class="lead">${q.questions.length}문제</p></div><div class="quiz-buttons">
    ${[['edit','수정'],['copy','복제'],['remove','삭제'],['xlsx','엑셀 내보내기'],['json','JSON 내보내기']].map(([op,label])=>`<button class="pill" data-work="${op}" data-id="${escapeText(q.id)}">${label}</button>`).join('')}</div></article>`).join(''):'<div class="panel"><h2>저장된 퀴즈가 없어요</h2><p class="lead">문제를 직접 만들거나 기존 파일을 불러와 시작하세요.</p></div>';
  }
  function editor(){
    const q=draft(),selected=current(),[question,choices,correct,explanation]=selected?.entry??empty().entry;
    return `${drafts.length>1?`<label class="field batch-select">가져온 퀴즈 (${drafts.length}개)<select id="draft-choice">${options(drafts.map((d,i)=>[i,`${i+1}. ${d.title||'제목 없음'}`]),active)}</select></label>`:''}
    <div class="panel draft-title"><label class="field">퀴즈 제목<input data-quiz-field="title" maxlength="80" value="${escapeText(q.title)}"></label></div>
    <div class="workshop-grid">
      <aside class="panel"><h2>문제 목록</h2><p class="lead">${q.entries.length} / 50문제</p>
      <div class="question-list">${q.entries.map(({entry,row},i)=>`<button type="button" class="pill question-link" data-work="select" data-index="${i}" aria-pressed="${i===index}"><b>${i+1}.</b> ${escapeText(entry[0]||'새 문제')}${row?` <small>엑셀 ${row}행</small>`:''}</button>`).join('')}</div>
      <button class="pill" data-work="add" ${q.entries.length>=QuizData.max?'disabled':''}>＋ 문제 추가</button></aside>
      <section class="panel"><div class="form-head"><h2>${selected?`${index+1}번 문제`:'문제 입력'}</h2>${selected?`<div class="quiz-buttons"><button class="pill" data-work="up" ${index===0?'disabled':''}>↑ 위로</button><button class="pill" data-work="down" ${index===q.entries.length-1?'disabled':''}>↓ 아래로</button><button class="pill" data-work="drop">문제 삭제</button></div>`:''}</div>
      ${selected?`<label class="field">문제<textarea data-quiz-field="question" maxlength="500" rows="2">${escapeText(question)}</textarea></label>
      <fieldset class="answer-fields"><legend>선택지와 정답</legend>${choices.map((choice,i)=>`<div class="answer-field"><input type="radio" name="correct" value="${i}" data-quiz-field="correct" aria-label="정답 ${i+1}번" ${correct===i?'checked':''}><span class="pad-number pad-${i}">${i+1}</span><input data-option="${i}" aria-label="선택지 ${i+1}" maxlength="180" value="${escapeText(choice)}"></div>`).join('')}</fieldset>
      <label class="field">해설 (선택)<textarea data-quiz-field="explanation" maxlength="1200" rows="2">${escapeText(explanation)}</textarea></label>`:'<p>왼쪽에서 문제를 추가하세요.</p>'}</section>
    </div>
    <section class="panel"><h2>게임 미리보기</h2><div class="workshop-grid preview-grid"><div><h3>중앙 팝업</h3><div class="mini-popup" id="quiz-popup"></div></div><div><h3>경기장 전광판</h3><div id="quiz-board"></div></div></div></section>
    <ul id="validation" class="notice validation" aria-live="polite" hidden></ul>
    <div class="actions"><button class="pill" data-work="cancel">편집 취소</button><button class="solid" data-work="save">${drafts.length>1?'가져온 퀴즈 모두 저장':'퀴즈 저장'}</button></div>`;
  }
  function drawPreview(){
    const entry=current()?.entry??empty().entry;
    const [question,choices]=entry;
    document.querySelector('#quiz-popup').innerHTML=`<h3>${escapeText(question||'문제를 입력하세요.')}</h3><ol>${choices.map((choice,i)=>`<li><b class="pad-number pad-${i}">${i+1}</b> ${escapeText(choice||'선택지 '+(i+1))}</li>`).join('')}</ol>`;
    const board=ArenaArt.board([question||'문제를 입력하세요.',choices.map((v,i)=>v||'선택지 '+(i+1))]);
    board.setAttribute('aria-label','전광판 미리보기');
    document.querySelector('#quiz-board').replaceChildren(board);
  }
  function renderWorkshop(){
    drafts=null;
    return heading('퀴즈 관리','직접 만들거나, 파일에서 가져온 문제를 확인하고 저장하세요.')+
      `<div class="workshop-toolbar"><button class="solid" data-work="new">＋ 직접 만들기</button><button class="pill" data-work="import-xlsx">엑셀 불러오기</button><button class="pill" data-work="import-json">기존 퀴즈 불러오기(JSON)</button><button class="pill" data-work="template">엑셀 작성 양식 다운로드 ↓</button></div>
      <p id="workshop-status" role="status">${escapeText(readError)}</p><input type="file" id="workshop-file" hidden><div id="workshop-content">${cards()}</div>`;
  }
  function download(blob,name){
    const link=document.createElement('a');
    const url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  function packageDraft(d){
    return {id:d.id||crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2),title:QuizData.text(d.title),questions:d.entries.map(({entry:[q,o,c,e]})=>[QuizData.text(q),o.map(QuizData.text),c,QuizData.text(e)])};
  }
  app.addEventListener('click',async event=>{
    const button=event.target.closest('[data-work]');
    if(!button)return;
    const {work,id}=button.dataset,quiz=find(id);
    try{
      if(work==='new')start([emptyDraft()]);
      else if(work==='edit')start([{id,title:quiz.title,entries:structuredClone(quiz.questions).map(entry=>({entry}))}]);
      else if(work==='copy'){
        persist([...saved,packageDraft({title:quiz.title.slice(0,74)+' (복제)',entries:quiz.questions.map(entry=>({entry}))})]);refresh();toast('퀴즈를 복제했습니다.');
      }else if(work==='remove'){
        const dialog=document.querySelector('#delete-quiz');
        dialog.dataset.quiz=id;dialog.returnValue='cancel';
        dialog.querySelector('p').textContent=`“${quiz.title}” 퀴즈를 삭제할까요?`;
        dialog.showModal();
      }else if(work==='template'||work==='xlsx'){
        download(await QuizWorkbook.write(work==='template'?seed:quiz.questions),work==='template'?'퀴즈런-엑셀-작성-양식.xlsx':quiz.title.replace(/[\\/:*?"<>|]/g,'_')+'.xlsx');
      }else if(work==='json'){
        download(new Blob([JSON.stringify(QuizData.backup(quiz),null,2)],{type:'application/json'}),quiz.title.replace(/[\\/:*?"<>|]/g,'_')+'.quizrun.json');
      }else if(work.startsWith('import-')){
        const input=document.querySelector('#workshop-file');
        input.value='';input.accept=work==='import-xlsx'?'.xlsx':'.json';input.click();
      }else if(work==='cancel'){drafts=null;refresh();}
      else if(work==='save'){
        const invalid=drafts.findIndex(d=>QuizData.validate(d).length);
        if(invalid>=0){
          active=invalid;index=0;refresh();showErrors();toast('아래 오류를 수정한 뒤 다시 저장하세요.');return;
        }
        const updates=drafts.map(packageDraft);
        persist([...saved.map(q=>updates.find(u=>u.id===q.id)||q),...updates.filter(u=>!find(u.id))]);
        drafts=null;refresh();toast('퀴즈를 저장했습니다.');
      }else{
        const entries=draft().entries;
        if(work==='select')index=Number(button.dataset.index);
        if(work==='add'&&entries.length<QuizData.max){entries.push(empty());index=entries.length-1;}
        if(work==='drop'){entries.splice(index,1);index=Math.max(0,Math.min(index,entries.length-1));}
        const swap=work==='up'?index-1:work==='down'?index+1:index;
        if(swap!==index&&entries[swap]){
          [entries[index],entries[swap]]=[entries[swap],entries[index]];
          index=swap;
        }
        refresh();showErrors();
      }
    }catch(error){toast(error.message);}
  });
  document.querySelector('#delete-quiz').addEventListener('close',event=>{
    if(event.target.returnValue!=='delete'||page!=='quizzes')return;
    try{persist(saved.filter(q=>q.id!==event.target.dataset.quiz));refresh();toast('퀴즈를 삭제했습니다.');}
    catch(error){toast(error.message);}
  });
  app.addEventListener('input',event=>{
    if(!drafts)return;
    const {quizField,option}=event.target.dataset,{value}=event.target;
    if(quizField==='title'){draft().title=value;return;}
    if(!quizField&&option===undefined)return;
    const entry=current().entry;
    if(quizField==='question')entry[0]=value;
    if(quizField==='correct')entry[2]=Number(value);
    if(quizField==='explanation')entry[3]=value;
    if(option!==undefined)entry[1][Number(option)]=value;
    drawPreview();
  });
  app.addEventListener('change',async event=>{
    if(event.target.id==='draft-choice'){active=Number(event.target.value);index=0;refresh();showErrors();return;}
    if(event.target.id!=='workshop-file'||importing)return;
    const file=event.target.files[0];if(!file)return;
    importing=true;
    try{
      if(file.size>5*1024*1024)throw Error('5MB 이하의 퀴즈 파일을 선택해 주세요.');
      let batch;
      if(event.target.accept==='.xlsx'){
        if(!/\.xlsx$/i.test(file.name))throw Error('.xlsx 파일을 선택해 주세요.');
        batch=[QuizData.fromExcel(await QuizWorkbook.read(await file.arrayBuffer()),file.name.replace(/\.xlsx$/i,''))];
      }else{
        let data;
        try{data=JSON.parse(await file.text());}catch{throw Error('JSON 파일을 읽을 수 없습니다. 퀴즈왕 또는 퀴즈런에서 다시 내보내 주세요.');}
        batch=QuizData.decode(data);
      }
      if(page!=='quizzes'||!event.target.isConnected)return;
      start(batch);
      toast('가져온 문제를 확인하고 저장하세요.');
    }catch(error){if(page==='quizzes'&&event.target.isConnected)toast(error.message);}
    finally{importing=false;}
  });
  return {page:renderWorkshop,find,list:()=>saved};
})();
