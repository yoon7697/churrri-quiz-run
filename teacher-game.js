const TeacherGame=(()=>{
  const label={countdown:'경기 시작 준비',question:'문제 공개',move:'정답 발판 선택',reveal:'정답 공개',drop:'추가 생존',restore:'경기장 복원',between:'교사 진행 대기',end:'경기 종료'};
  const mark=value=>value===-1?'무제한':String(value);
  const get=id=>document.getElementById(id);
  function layout(){
    const p={...defaultSettings};
    const settings=[
      selectField('quiz','사용할 퀴즈',quizList().map(q=>[q.id,q.title]),p.quiz),
      selectField('questionCount','출제할 문제 수',countOptions(quizById(p.quiz)),p.questionCount),
      selectField('questionOrder','문제 순서',[['ordered','순서대로'],['random','무작위']],p.questionOrder),
      selectField('optionOrder','선택지 순서',[['ordered','순서대로'],['random','무작위']],p.optionOrder),
      selectField('lives','초기 목숨',[[1,'1개'],[3,'3개'],[5,'5개'],['Infinity','무제한']],p.lives),
      numberField('reveal','문제 공개 시간 (초)',1,30,p.reveal),
      numberField('move','이동 제한 시간 (초)',3,60,p.move),
      selectField('pace','진행 방식',[['auto','자동 진행'],['manual','수동 진행']],p.pace),
    ];
    return `<section class="online-game-panel">
      <form id="online-game-form"><h2>온라인 경기 설정</h2><div class="fields">${settings.join('')}
      ${obstacleFields(p)}
      <label class="field">대결 방식<select disabled><option>개인전 · 모둠전 준비 중</option></select></label>
      <label class="field switch"><input type="checkbox" name="contact" checked> 캐릭터 충돌</label>
      <label class="field switch"><input type="checkbox" name="push"> 밀기 허용</label>
      </div><div class="actions"><button class="solid">게임 시작</button></div></form>
      <section id="online-game-live" hidden>
        <h2>경기 관리</h2><p id="teacher-phase" class="notice" aria-live="polite"></p>
        <p>남은 시간 <strong id="teacher-time"></strong> · 생존 <strong id="teacher-alive"></strong></p>
        <div id="teacher-question"></div><section id="teacher-results" aria-label="경기 결과" hidden></section>
        <div class="actions">
          <button type="button" id="online-game-next" class="solid" hidden>다음 문제</button>
          <button type="button" id="online-game-restart" class="solid" hidden>다시 하기</button>
          <button type="button" id="online-game-return" class="solid" hidden>대기실로 돌아가기</button>
          <button type="button" id="online-game-end" class="pill">게임 종료</button>
        </div>
      </section></section>`;
  }
  function bind(manage){
    const form=get('online-game-form');
    form.onsubmit=event=>{
      event.preventDefault();
      const settings=readSettings(form,defaultSettings),quiz=quizById(settings.quiz);
      settings.questionCount=settings.questionCount==='all'?quiz.questions.length:Number(settings.questionCount);
      settings.lives=settings.lives==='Infinity'?'Infinity':Number(settings.lives);
      manage(form.querySelector('button'),'start-game',{settings,title:quiz.title,questions:quiz.questions});
    };
    for(const [button,action] of [['next','next-round'],['restart','restart-game'],['return','return-lobby'],['end','end-game']]) {
      const target=get('online-game-'+button);
      target.onclick=()=>manage(target,action,{gameId:target.dataset.gameId});
    }
  }
  function sync(game,clock){
    const timer=get('teacher-time');
    if (!timer||!game) return;
    const text=game.until===null?'—':Math.max(0,Math.ceil((game.until-Date.now()-clock)/1000))+'초';
    if (timer.textContent!==text) timer.textContent=text;
  }
  function render(game,clock){
    get('online-game-form').hidden=!!game;
    get('online-game-live').hidden=!game;
    if(!game)return;
    get('teacher-phase').textContent=`${game.title} · ${game.round+1} / ${game.total}라운드 · ${label[game.phase]}`;
    get('teacher-alive').textContent=game.players.filter(p=>p.hp!==0&&!p.out).length+' / '+game.players.length;
    sync(game,clock);
    get('online-game-next').hidden=game.phase!=='between';
    for(const id of ['restart','return']){
      const button=get('online-game-'+id);
      button.hidden=game.phase!=='end';
      button.dataset.gameId=game.id;
    }
    get('online-game-end').hidden=game.phase==='end';
    const area=get('teacher-question');
    area.replaceChildren();
    if(game.entry&&game.phase!=='end') {
      const [title,options,correct,why]=game.entry;
      const h=document.createElement('h3');h.textContent=title;
      const list=document.createElement('ol');
      for(const option of options){const li=document.createElement('li');li.textContent=option;list.append(li);}
      const answer=document.createElement('p');answer.textContent='정답 '+(correct+1)+'번 · '+options[correct]+(why?' · '+why:'');
      area.append(h,list,answer);
    }
    const result=get('teacher-results');
    result.hidden=!game.result;
    if(game.result&&result.dataset.gameId!==game.result.id){
      QuizResults.render(result,game.result);
      result.dataset.gameId=game.result.id;
    }
  }
  function stats(game,slot){
    if(!game)return '';
    const player=game.players.find(p=>p.slot===slot);
    if(!player)return '이번 경기 미참가';
    const answer=game.answers.find(a=>a.slot===slot);
    const response=answer ? ' · '+(answer.choice<0?'미선택':(answer.choice+1)+'번')+' · '+(answer.correct?'정답':'오답'):'';
    return (player.out?'이탈':player.hp===0?'관전':'목숨 '+mark(player.hp))+response;
  }
  return {layout,bind,render,sync,stats};
})();
