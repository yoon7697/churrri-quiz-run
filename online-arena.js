function createOnlineMatch(bridge) {
  const state={phase:'idle',lives:[1],winners:[],previous:[1],round:0,spectator:0,lost:false};
  let active=null, clock=0, target=null;
  function sync() {
    const current=bridge.game();
    clock=current.clock;
    if(current.state===active) return false;
    const previous=active;
    active=current.state;
    if(!active) {
      Object.assign(state,{phase:'idle',lives:[1],winners:[],previous:[1],round:0,lost:false,result:null});
      target=null;
      return true;
    }
    const me=active.players.find(p=>p.slot===bridge.slot);
    const mine=active.answers.find(a=>a.slot===bridge.slot);
    const toLocal=value=>(value+performance.now()-(Date.now()+clock))/1000;
    Object.assign(state,{
      phase:active.phase,round:active.round,lives:[me?.hp===-1?Infinity:me?.out?0:me?.hp??0],
      result:active.result?.id===state.result?.id?state.result:active.result,
      event:active.event, restoreAt:toLocal(active.restoreAt), until:toLocal(active.until),
      fallen:[me?.fallenAt!=null?toLocal(me.fallenAt):null],
      prior:active.prior,previous:[active.prior.includes(bridge.slot)?1:0],
      winners:active.winners.includes(bridge.slot)?[0]:[],
      lost:!!mine&&!mine.correct,revealAt:toLocal(active.revealAt),dropAt:toLocal(active.dropAt),
    });
    if(previous?.id!==active.id) clearInput();
    if(!candidates().some(p=>p.slot===target)) target=candidates()[0]?.slot??null;
    return previous?.phase!==active.phase||previous?.roundKey!==active.roundKey||previous?.players.find(p=>p.slot===bridge.slot)?.fallenAt!==me?.fallenAt;
  }
  function candidates() {
    const online=new Set(bridge.actors(performance.now()).map(p=>p.slot));
    return active?.players.filter(p=>p.hp!==0&&!p.out&&online.has(p.slot))||[];
  }
  function spectate(direction) {
    const rows=candidates(), index=rows.findIndex(p=>p.slot===target);
    if(rows.length)target=rows[(index+direction+rows.length)%rows.length].slot;
  }
  function targetPlayer() {
    const rows=candidates();
    return rows.find(p=>p.slot===target)||rows[0];
  }
  return {state,sync,spectate,targetPlayer,view:()=>active,
    time:()=>active?.until===null?0:Math.max(0,Math.ceil(((active?.until??0)-Date.now()-clock)/1000)),
    playable:()=>!active || ArenaEvent.moving(active.phase)&&state.lives[0]>0&&state.fallen[0]==null,
    question:()=>active?.entry||['',[],-1,'']};
}

function createOnlineHUD(match) {
  const element=id=>document.getElementById(id);
  const root=element('prompt'),watch=element('watch');
  function add(tag,text,parent=root) {
    const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;
  }
  function connect(){
    element('prev').onclick=()=>match.spectate(-1);
    element('next').onclick=()=>match.spectate(1);
  }
  function sync(){
    const game=match.view(),s=match.state;
    const watching=!!game&&s.lives[0]===0&&s.phase!=='end',target=watching?match.targetPlayer():null;
    document.body.classList.toggle('running',!!game&&s.phase!=='end');
    document.body.classList.toggle('spectating',watching||s.phase==='end');
    watch.hidden=!target;
    element('status').hidden=!game;
    if(!game)return;
    const write=(id,text)=>{const node=element(id);if(node.textContent!==text)node.textContent=text;};
    const count=game.players.filter(p=>p.hp!==0&&!p.out).length;
    write('alive',count+' / '+game.players.length);
    write('round',(game.round+1)+' / '+game.total);
    write('time',['countdown','question','move','drop'].includes(s.phase)?match.time()+'초':'—');
    write('hearts',s.lives[0]===Infinity?'♥ ∞':s.lives[0]>0?'♥'.repeat(s.lives[0]):'관전');
    if(target)write('target','관전 · '+target.name);
    if(s.phase==='countdown'&&root.firstChild)root.firstChild.textContent=String(Math.max(1,match.time()));
  }
  function change(){
    const s=match.state,game=match.view(),[question,options,correct,why]=match.question();
    root.dataset.phase=s.phase;
    root.hidden=['idle','move','end'].includes(s.phase);
    root.replaceChildren();
    if(s.phase==='countdown')add('h2',String(Math.max(1,match.time())));
    if(s.phase==='question'){
      add('p','라운드 '+(s.round+1)).className='round-intro';
      add('h2',question);
      const list=add('ol','');
      options.forEach((answer,i)=>{const li=add('li','',list);add('b',String(i+1),li);li.append(answer);});
    }
    if(['drop','restore','between'].includes(s.phase)){
      add('h2','정답은 '+(correct+1)+'번!').className='answer-title';
      add('p',options[correct]+(why?' · '+why:''));
      if(s.lost)add('p',s.lives[0]===Infinity?'오답 · 무제한 목숨':s.lives[0]===0?'마지막 목숨을 잃었습니다. 관전으로 전환합니다.':'목숨 1개 감소');
      if(!s.lost&&s.previous[0]>0&&s.fallen?.[0]==null)add('p','정답 · 목숨 유지');
      if(s.fallen?.[0]!=null)add('p','물에 빠졌어요 · 경기장 복원 대기');
      if(s.phase==='between')add('p','선생님이 다음 문제를 열 때까지 기다려요.');
    }

  }
  return {connect,sync,change,arenaReady(){element('loading').hidden=true;}};
}
