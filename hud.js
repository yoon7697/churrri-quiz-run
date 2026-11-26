function createSurvivalHUD(match,embedded=false){
  const byId=id=>document.getElementById(id);
  const setup=byId('setup'),prompt=byId('prompt'),watch=byId('watch'),status=byId('status');
  const play=byId('play'),group=byId('group');
  function reset(){prompt.hidden=true;watch.hidden=true;status.hidden=true;document.body.classList.remove('spectating','running');play.textContent='서바이벌 시작';group.hidden=false;}
  function connect(start){
    play.onclick=()=>{clearInput();if(!setup.open)setup.showModal();};
    byId('cancel').onclick=()=>setup.close();
    byId('settings').onsubmit=e=>{e.preventDefault();const data=new FormData(e.currentTarget);setup.close();
      start({reveal:Number(data.get('reveal')),move:Number(data.get('move')),lives:Number(data.get('lives')),contact:data.has('contact'),push:data.has('push'),hazards:data.get('hazards')!=='off'});};
    byId('prev').onclick=()=>match.spectate(-1);
    byId('next').onclick=()=>match.spectate(1);
  }
  function sync(now){
    const s=match.state;
    if(s.phase==='idle')return;
    const alive=s.lives.filter(hp=>hp>0).length,timer=Math.max(0,Math.ceil(s.until-now));
    const round=(s.round+1)+' / '+match.total;
    const time=['question','move','drop'].includes(s.phase)?timer+'초':'—';
    const watching=s.lives[0]===0&&s.phase!=='end'&&alive>0;
    document.body.classList.toggle('running',s.phase!=='end');
    document.body.classList.toggle('spectating',watching||s.phase==='end');
    group.hidden=true;status.hidden=false;watch.hidden=!watching;
    const write=(el,text)=>{if(el.textContent!==text)el.textContent=text;};
    write(byId('alive'),alive+' / '+s.lives.length);write(byId('round'),round);write(byId('time'),time);
    write(byId('hearts'),s.lives[0]===Infinity?'♥ ∞':s.lives[0]>0?'♥'.repeat(s.lives[0]):'관전');
    write(byId('target'),'관전 · 토끼 '+(s.spectator+1));
  }
  function change(){
    const s=match.state,[question,options,correct,why]=match.question();
    prompt.dataset.phase=s.phase;
    prompt.hidden=['move','idle','end'].includes(s.phase);prompt.replaceChildren();
    function add(tag,text,parent=prompt){const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;}
    if(s.phase==='question'){
      add('p','라운드 '+(s.round+1)).className='round-intro';
      add('h2',question);const list=add('ol','');
      options.forEach((answer,i)=>{const li=add('li','',list);add('b',String(i+1),li);li.append(answer);});
    }else if(['drop','restore'].includes(s.phase)){
      add('h2','정답은 '+(correct+1)+'번!').className='answer-title';add('p',options[correct]+' · '+why);
      if(s.fallen?.[0]!=null)add('p','물에 빠졌어요 · 경기장 복원 대기');
      if(s.lost)add('p',s.lives[0]===Infinity?'오답 · 무제한 목숨':s.lives[0]===0?'마지막 목숨을 잃었습니다. 관전으로 전환합니다.':'목숨 1개 감소');
      else if(s.previous[0]>0&&s.fallen?.[0]==null)add('p','정답 · 목숨 유지');
    }
  }
  const resultActions=[
    ['다시 하기',()=>{if(embedded)parent.postMessage('quizrun-replay','*');else play.click();}],
    [embedded?'처음 화면':'경기장 둘러보기',()=>{if(embedded)parent.postMessage('quizrun-return-home','*');else{match.state.phase='idle';reset();}}],
  ];
  function waitForArena(){
    byId('loading').hidden=false;
    play.disabled=true;
  }
  function arenaReady(){
    byId('loading').hidden=true;
    play.disabled=false;
  }
  return {connect,sync,change,waitForArena,arenaReady,resultActions};
}

function createGamePresentation(playCue){
  const get=id=>document.getElementById(id);
  const floodWarning=get('flood-warning'),floodSeconds=get('flood-seconds');
  const floodObstacle=get('flood-obstacle'),hazard=get('hazard');
  const time=get('time');
  const cues=QuizSound.sequence(playCue);
  function write(el,text){if(el.textContent!==text)el.textContent=text;}
  return {reset:cues.reset,sync(state,clock){
    const flood=ArenaEvent.floodCountdown(state,clock);
    const {phase,event}=state??{};
    const remaining=Math.max(0,Math.ceil(((state?.until??clock)-clock)/1000));
    const urgent=phase==='move'&&remaining>=1&&remaining<=3;
    const beat=urgent?String(remaining):'';
    if(time.dataset.beat!==beat)time.dataset.beat=beat;
    if(flood)write(floodSeconds,String(flood));
    floodWarning.hidden=!flood;
    const label=event?ArenaEvent.label(event):'';
    const obstacle=flood&&event.kind!=='flood'?label.replace('물 차오름 · ',''):'';
    floodObstacle.hidden=!obstacle;
    if(obstacle)write(floodObstacle,obstacle+(clock<event.start?' 등장!':' 작동 중'));
    hazard.hidden=!event||!!flood||phase!=='move';
    if(!hazard.hidden)write(hazard,label+(clock<event.start?' 등장!':''));
    cues.sync({id:state?.id,phase,round:state?.round,life:state?.life,
      fallen:state?.fallen,winner:state?.winner,remaining,flood});
  }};
}
