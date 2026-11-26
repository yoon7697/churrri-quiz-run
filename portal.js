'use strict';
const app=document.querySelector('#app');
const header=document.querySelector('#siteHeader');
const leaving=document.querySelector('#leaving');
const defaultSettings={bots:29,quiz:'all',lives:3,reveal:3,move:15,contact:true,push:false,hazards:true,mode:'pads',division:'individual',pace:'auto',questionCount:'all',questionOrder:'ordered',optionOrder:'ordered'};
const builtInQuizzes=[
  {id:'all',title:'우리 반 종합 퀴즈',questions:sampleQuestions},
  {id:'math',title:'수학 발판 퀴즈',questions:[sampleQuestions[1],sampleQuestions[5],sampleQuestions[9]]},
];
const quizList=()=>[...builtInQuizzes,...Workshop.list()];
const quizById=id=>quizList().find(quiz=>quiz.id===id)||builtInQuizzes[0];
function obstacleFields(settings){
  return selectField('hazards','장애물',[['on','ON'],['off','OFF']],settings.hazards?'on':'off');
}
function countOptions(quiz){
  return [['all',`전체 ${quiz.questions.length}문제`],...quiz.questions.map((_,i)=>[i+1,`${i+1}문제`])];
}
const colors=[['보라','#7160dc'],['분홍','#fb608e'],['민트','#28c6ad'],['노랑','#ffb636']];
const testNotice='<p class="notice"><strong>로컬 테스트 대기실</strong> · 같은 화면에서 입장 흐름을 체험할 수 있어요. 다른 기기에서는 접속할 수 없습니다.</p>';
const escapeText=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let room=null,student=null,frame=null,pendingExit=null,page='',lastMatch=null;
const portalSound=QuizSound.local();
const refreshSound=QuizSound.bind(document.getElementById('sound-home'),()=>portalSound.enabled,()=>{portalSound.set(!portalSound.enabled);document.querySelectorAll('#online-stage iframe').forEach(refreshArenaSound);});
QuizSound.unlockOnGesture(portalSound.unlock);
function receiveArenaSound(event,arena){
  if(!arena||event.source!==arena.contentWindow||event.data?.type!=='quizrun-sound')return false;
  const {action,value}=event.data;
  if(action==='set'&&typeof value==='boolean'){
    portalSound.set(value);
    refreshSound();
    arena.contentWindow.postMessage({type:'quizrun-sound-state',enabled:portalSound.enabled},'*');
  }
  if(action==='unlock')portalSound.unlock();
  if(action==='play')portalSound.play(value);
  return true;
}
const refreshArenaSound=arena=>arena?.contentWindow.postMessage({type:'quizrun-sound-state',enabled:portalSound.enabled},'*');
let preferences={...defaultSettings,bots:19,push:true};
try{const saved=JSON.parse(localStorage.getItem('quizrun-preferences')||'{}');preferences={...preferences,...saved,...ArenaEvent.settings(saved)};}catch{}

const menu=[
  ['online-teacher','🏠','방 만들기','학생들이 각자 기기에서 들어올 수 있는 온라인 방을 만들어요.','온라인 방 만들기','yellow'],
  ['online-join','🔑','코드로 참가','선생님이 알려 준 4자리 방 코드로 들어가요.','코드 입력','pink'],
  ['solo','🐇','혼자 하기','컴퓨터 토끼와 발판 퀴즈를 풀어요.','혼자 하기 설정','purple'],
  ['quizzes','📚','퀴즈 관리','문제를 만들거나 엑셀에서 불러와요.','퀴즈 관리 열기','plain'],
];
function options(entries,current){
  return entries.map(([value,label])=>`<option value="${escapeText(value)}" ${String(value)===String(current)?'selected':''}>${escapeText(label)}</option>`).join('');
}
function selectField(name,label,items,value){
  return `<label class="field">${label}<select name="${name}">${options(items,value)}</select></label>`;
}
function numberField(name,label,min,max,value){
  return `<label class="field">${label}<input type="number" name="${name}" min="${min}" max="${max}" value="${escapeText(value)}" required></label>`;
}
function fields(p,teacher=false){
  return `<div class="fields">
    ${teacher?selectField('mode','게임 모드',[['pads','정답 발판']],p.mode):numberField('bots','컴퓨터 상대 수',1,29,p.bots)}
    ${teacher?selectField('division','대결 방식',[['individual','개인전'],['teams','모둠전']],p.division):''}
    ${selectField('quiz','사용할 퀴즈',quizList().map(q=>[q.id,`${q.title} · ${q.questions.length}문제`]),quizById(p.quiz).id)}
    ${selectField('questionCount','출제할 문제 수',countOptions(quizById(p.quiz)),p.questionCount)}
    ${selectField('questionOrder','문제 순서',[['ordered','순서대로'],['random','무작위']],p.questionOrder)}
    ${selectField('optionOrder','선택지 순서',[['ordered','원본 유지'],['random','무작위']],p.optionOrder)}
    ${selectField('lives','초기 목숨',[[1,'1개'],[3,'3개'],[5,'5개'],['Infinity','무제한']],p.lives)}
    ${numberField('reveal','문제 공개 시간 (초)',1,30,p.reveal)}
    ${numberField('move','이동 제한 시간 (초)',3,60,p.move)}
    ${obstacleFields(p)}
    <label class="field switch"><input type="checkbox" name="contact" ${p.contact?'checked':''}> 캐릭터 충돌</label>
    <label class="field switch"><input type="checkbox" name="push" ${p.push?'checked':''}> 밀기 허용</label>
    ${teacher?selectField('pace','진행 방식',[['auto','자동 진행'],['manual','수동 진행']],p.pace):''}
  </div>`;
}
function readSettings(form,prior){
  const data=new FormData(form);
  const settings={...prior,contact:data.has('contact'),push:data.has('push')};
  if(data.has('hazards'))settings.hazards=data.get('hazards')==='on';
  for(const key of ['bots','reveal','move'])if(data.has(key))settings[key]=Number(data.get(key));
  for(const key of ['quiz','lives','mode','division','pace','questionCount','questionOrder','optionOrder'])if(data.has(key))settings[key]=data.get(key);
  return settings;
}
function heading(title,lead){
  return `<a class="back" href="#home">← 처음 화면</a><h1 class="page-title" tabindex="-1">${title}</h1><p class="lead">${lead}</p>`;
}
function renderHome(){
  return `<section class="hero"><div><h1>우리 반<br><em>퀴즈런</em></h1><p>문제를 읽고, 정답 발판까지 달려요.<br>제한 시간 안에 살아남는 교실 퀴즈 게임!</p></div><figure><img src="assets/hero.webp" alt="알록달록한 발판이 있는 3D 경기장을 달리는 토끼 캐릭터" fetchpriority="high"></figure></section>
  <nav class="menu-grid" aria-label="퀴즈런 메뉴">${menu.map(([route,icon,title,desc,action,color])=>`<a class="menu-card" href="#${route}"><span class="menu-icon" aria-hidden="true">${icon}</span><h2>${title}</h2><p>${desc}</p><span class="card-action ${color}">${action}<span aria-hidden="true">↗</span></span></a>`).join('')}</nav>
  <p class="notice home-note">온라인 방에서는 실시간으로 참가자를 확인할 수 있어요. <a href="#teacher">로컬 대기실 체험</a></p>`;
}
function ensureRoom(){
  if(!room)room={code:String(1000+Math.floor(Math.random()*9000)),roster:[],nextId:1,settings:{...preferences},started:false};
}
function renderTeacher(){
  ensureRoom();
  return heading('교사용 대기실','참가자를 관리하고 경기 옵션을 설정하세요.')+testNotice+`<div class="lobby-grid">
  <section><div class="panel"><h2>학생 입장 코드</h2><div class="room-code"><strong class="digits">${room.code}</strong><button type="button" class="pill" id="copy-code">코드 복사</button></div><div class="qr">QR코드 표시 영역<br>온라인 접속 주소가 연결되면 QR코드가 표시됩니다.</div><a class="pill" href="#join">학생 입장 체험 ↗</a><p id="copy-status" role="status"></p></div>
  <div class="panel"><h2>참가 학생 <span id="total">${room.roster.length} / 30명</span></h2><div id="roster"></div><button type="button" class="pill" id="sample-student" ${room.roster.length>=30?'disabled':''}>＋ 테스트 학생</button></div></section>
  <form class="panel" id="teacher-form"><h2>경기 설정</h2>${fields(room.settings,true)}<p class="notice">모둠전과 수동 진행은 설정 미리보기입니다. 로컬 테스트 경기는 컴퓨터 토끼와 개인전·자동 진행으로 실행됩니다.</p>
  <div class="actions"><button type="button" class="pill" id="close-room">방 종료</button><button class="solid">게임 시작</button></div></form></div>`;
}
function renderRoster(){
  const container=document.querySelector('#roster');
  if(!container||!room)return;
  document.querySelector('#total').textContent=`${room.roster.length} / 30명`;
  document.querySelector('#sample-student').disabled=room.roster.length>=30;
  container.innerHTML=room.roster.length?`<ul class="roster">${room.roster.map(p=>`<li>
  <input aria-label="학생 ${p.id} 이름" data-student="${p.id}" value="${escapeText(p.name)}" maxlength="16" required>
  <button type="button" class="pill" data-save="${p.id}">이름 저장</button><button type="button" class="pill" data-remove="${p.id}" aria-label="${escapeText(p.name)} 내보내기">내보내기</button></li>`).join('')}</ul>`:'<p class="lead">아직 참가 학생이 없어요.</p>';
}
function renderJoin(){
  return `<section class="narrow">${heading('코드로 참가','교사 대기실에 표시된 4자리 테스트 코드를 입력하세요.')}${testNotice}
  <form class="panel" id="join-form"><div class="fields"><label class="field">방 코드<input id="room-input" name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="0000" required></label><label class="field">닉네임<input name="nickname" maxlength="16" required></label>
  ${selectField('character','캐릭터',[['rabbit','토끼']], 'rabbit')}
  ${selectField('color','캐릭터 색상',colors.map(([label,value],i)=>[i,label]),0)}</div>
  <p id="join-error" class="error" role="alert"></p><div class="actions"><button class="solid">대기실 입장</button></div></form></section>`;
}
function renderSolo(){
  return `<section class="narrow">${heading('혼자 하기','컴퓨터 토끼와 정답 발판에서 대결해요.')}
  <form class="panel" id="solo-form"><h2>경기 설정</h2>${fields(preferences)}<div class="actions"><button class="solid">게임 시작 ↗</button></div></form></section>`;
}
function renderQuizzes(){return Workshop.page();}
const pages={home:renderHome,teacher:renderTeacher,join:renderJoin,solo:renderSolo,quizzes:renderQuizzes,'online-teacher':()=>Online.layout('teacher'),'online-join':()=>Online.layout('student')};
function go(route){
  history.replaceState(null,'','#'+route);
  render(route);
}
function render(route){
  frame=null;
  Online.unmount();
  const invite=/^online-join\/([1-9][0-9]{3})$/.exec(route);
  if(invite)route='online-join';
  page=Object.hasOwn(pages,route)?route:'home';
  document.body.classList.remove('arena-mode');header.inert=false;
  app.innerHTML=pages[page]();
  if(page==='teacher')renderRoster();
  if(page.startsWith('online-'))Online.mount(page==='online-teacher'?'teacher':'student',invite?.[1]);
  if(page==='join'&&room)document.querySelector('#room-input').value=room.code;
  window.scrollTo(0,0);
  app.querySelector('.page-title')?.focus();
}

function arenaDocument(config){
  const payload=JSON.stringify({...config,sound:portalSound.enabled}).replace(/</g,'\\u003c');
  const encoded=document.querySelector('#arena-source').dataset.payload;
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const source=new TextDecoder().decode(bytes);
  return source.replace('<body>',()=>'<body><script>const PortalConfig='+payload+';<\/script>');
}

function openArena({practice=false,settings=preferences,returnTo='home',color=0,title,playerName}={}){
  const wasArena=!!frame;
  if(!practice)lastMatch={settings,returnTo,color,title,playerName};
  document.body.classList.add('arena-mode');header.inert=true;
  app.innerHTML=`<div class="arena-bar"><strong>${escapeText(title||'우리 반 퀴즈런')}</strong><div class="arena-actions">
  ${practice?'<span class="arena-label">로컬 테스트 · 교사 시작 대기 중</span><button class="pill" type="button" id="simulate">교사 시작 모의 실행</button>':''}
  <button class="pill" type="button" id="exit-game">나가기</button></div></div>`;
  frame=document.createElement('iframe');
  frame.className='arena-frame';frame.title=practice?'학생 대기실 연습 경기장':'퀴즈런 경기장';
  frame.setAttribute('sandbox','allow-scripts');
  const config={practice,color,playerName,questions:practice?null:QuizData.prepare(quizById(settings.quiz).questions,settings),settings:{...settings,lives:settings.lives==='Infinity'?'Infinity':Number(settings.lives)}};
  frame.srcdoc=arenaDocument(config);
  app.append(frame);
  frame.dataset.returnTo=returnTo;
  const openedFrame=frame;
  openedFrame.addEventListener("load",()=>{if(frame===openedFrame&&!leaving.open)openedFrame.focus();},{once:true});
  if(!wasArena)window.scrollTo(0,0);
  document.querySelector('#exit-game').focus();
}
function askExit(route){
  pendingExit=route;
  if(!leaving.open){leaving.returnValue='cancel';leaving.showModal();}
}
leaving.addEventListener('close',()=>{if(leaving.returnValue==='leave')go(pendingExit||'home');pendingExit=null;});
window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow)return;
  if(receiveArenaSound(event,frame))return;
  if(event.data==='quizrun-return-home')go('home');
  if(event.data==='quizrun-replay'&&lastMatch)openArena(lastMatch);
});
window.addEventListener('hashchange',()=>{
  const next=location.hash.slice(1)||'home';
  if(!frame){render(next);return;}
  history.replaceState(null,'','#'+page);
  askExit(next);
});
document.querySelector('.brand').addEventListener('click',event=>{if(frame){event.preventDefault();askExit('home');}});
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.dataset.dialogOpen){
    if(button.dataset.dialogOpen==='preferences')document.querySelector('#preference-fields').innerHTML=fields(preferences);
    document.getElementById(button.dataset.dialogOpen).showModal();
  }
  if(button.dataset.close)document.getElementById(button.dataset.close).close();
  if(button.id==='exit-game'&&frame)askExit(frame.dataset.returnTo);
  if(button.id==='simulate'&&room&&student){
    room.started=true;
    openArena({playerName:student.name,title:student.name+' · 테스트 경기',settings:room.settings,color:student.color,returnTo:'teacher'});
  }
  if(button.id==='close-room'){room=null;student=null;go('home');}
  if(button.id==='sample-student'&&room.roster.length<30){
    const id=room.nextId++;room.roster.push({id,name:'테스트 학생 '+id,color:0});renderRoster();
  }
  if(button.id==='copy-code'){
    const code=room.code;
    const result=document.querySelector('#copy-status');
    try{await navigator.clipboard.writeText(code);result.textContent='코드를 복사했어요.';}
    catch{result.textContent='방 코드 '+code+'를 직접 입력해 주세요.';}
  }
  if(button.dataset.save){
    const input=document.querySelector(`[data-student="${button.dataset.save}"]`);
    const name=input.value.trim();
    if(!name){input.setCustomValidity('이름을 입력하세요.');input.reportValidity();return;}
    const member=room.roster.find(p=>p.id===Number(button.dataset.save));
    member.name=name;renderRoster();
  }
  if(button.dataset.remove){
    room.roster=room.roster.filter(p=>p.id!==Number(button.dataset.remove));renderRoster();
  }
});
document.addEventListener('change',event=>{
  if(event.target.name!=='quiz')return;
  const form=event.target.form;
  const count=form?.elements.questionCount;
  if(!count)return;
  count.innerHTML=options(countOptions(quizById(event.target.value)),'all');
  if(form.id==='teacher-form'&&form.checkValidity())room.settings=readSettings(form,room.settings);
});
app.addEventListener('input',event=>{
  event.target.setCustomValidity?.('');
  const form=event.target.closest('#teacher-form');
  if(form?.checkValidity())room.settings=readSettings(form,room.settings);
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(!['preference-form','solo-form','teacher-form','join-form'].includes(form.id))return;
  event.preventDefault();
  if(form.id==='preference-form'){
    preferences=readSettings(form,preferences);
    try{localStorage.setItem('quizrun-preferences',JSON.stringify(preferences));}catch{}
    document.querySelector('#preferences').close();
    if(page==='solo')render('solo');
  }
  if(form.id==='solo-form')openArena({settings:readSettings(form,preferences),returnTo:'solo'});
  if(form.id==='teacher-form'){
    room.settings=readSettings(form,room.settings);room.started=true;
    openArena({settings:room.settings,title:'교사 · 테스트 경기',returnTo:'teacher'});
  }
  if(form.id==='join-form'){
    const data=new FormData(form),code=String(data.get('code')),name=String(data.get('nickname')).trim();
    const error=document.querySelector('#join-error');
    if(!room||room.code!==code){error.textContent='이 화면에서 만든 테스트 방의 코드인지 확인해 주세요.';return;}
    if(!name){error.textContent='닉네임을 입력해 주세요.';return;}
    if(room.roster.length>=30){error.textContent='참가 인원이 30명에 도달했어요.';return;}
    student={id:room.nextId++,name,color:Number(data.get('color'))};
    room.roster.push(student);
    openArena({playerName:name,practice:!room.started,settings:room.settings,color:student.color,title:name+(room.started?' · 테스트 경기':' · 학생용 대기실'),returnTo:'teacher'});
  }
});
document.addEventListener('DOMContentLoaded',()=>render(location.hash.slice(1)||'home'));
