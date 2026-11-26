const stick=document.querySelector('#stick'), jumpButton=document.querySelector('#jump');
const sprintButton=document.querySelector('#sprint');
const locationLabel=document.querySelector('#location'),keys=new Set();
const joystick={id:null,x:0,z:0},player=Rules.spawn();
let jumpRequested=false,pushRequested=false,touchSprint=false;
const pushButton=document.querySelector('#push'),pushCaption=document.querySelector('#push-caption');
pushButton.onclick=()=>{pushRequested=true;};
function setTouchSprint(active){
  touchSprint=active;sprintButton.setAttribute('aria-pressed',String(active));
}
sprintButton.onclick=()=>setTouchSprint(!touchSprint);
function clearStick(){
  joystick.id=null;joystick.x=joystick.z=0;
  stick.firstElementChild.style.transform='';
}
function clearInput(){
  keys.clear();jumpRequested=false;pushRequested=false;
  const id=joystick.id;clearStick();
  if(id!==null&&stick.hasPointerCapture(id))stick.releasePointerCapture(id);
  setTouchSprint(false);
}
function moveStick(e){
  if(e.pointerId!==joystick.id)return;
  const rect=stick.getBoundingClientRect();
  const x=e.clientX-rect.left-rect.width/2,z=e.clientY-rect.top-rect.height/2;
  const scale=Math.max(26,Math.hypot(x,z));joystick.x=x/scale;joystick.z=z/scale;
  stick.firstElementChild.style.transform='translate('+joystick.x*22+'px,'+joystick.z*22+'px)';
}
stick.onpointerdown=e=>{
  if(joystick.id!==null)return;
  e.preventDefault();joystick.id=e.pointerId;stick.setPointerCapture(e.pointerId);moveStick(e);
};
stick.onpointermove=moveStick;
function releaseStick(e){if(e.pointerId===joystick.id)clearStick();}
stick.onlostpointercapture=stick.onpointerup=stick.onpointercancel=releaseStick;
jumpButton.onpointerdown=e=>{e.preventDefault();jumpRequested=true;};
function handleKey(e,down){
  if(document.getElementById?.('setup')?.open)return;
  if(e.code==='ControlLeft'){
    if(down&&!e.target?.isContentEditable&&!['INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName)){
      e.preventDefault();
      if(!e.repeat)pushRequested=true;
    }
    return;
  }
  const movementHeld=[...keys].some(code=>/^(Key[WASD]|Arrow)/.test(code));
  if(e.code==='Space'&&!movementHeld&&!e.shiftKey&&['BUTTON','INPUT','SELECT'].includes(e.target?.tagName))return;
  if(!['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','ShiftLeft','ShiftRight'].includes(e.code))return;
  e.preventDefault();
  if(down){keys.add(e.code);if(e.code==='Space'&&!e.repeat)jumpRequested=true;}
  else keys.delete(e.code);
}
onkeydown=e=>handleKey(e,true);onkeyup=e=>handleKey(e,false);
onblur=clearInput;document.addEventListener('visibilitychange',clearInput);
function resetRoundPlayer(){
  Object.assign(player,Rules.spawn(),{z:0,y:Rules.surface(0,0)});
  clearInput();
}
function play(park,match,hud,practice=false,lobby=null,sound=null,results=null){
  let nextPushAt=0,lastGame;
  const start=settings=>{
    nextPushAt=0;player.impulse=null;player.barAt=null;player.barContactAt=null;player.shovedAt=null;park.clearGestures?.();
    sound?.presentation.reset();
    resetRoundPlayer();park.startMatch();match.start(performance.now()/1000,settings);hud.change();hud.sync(performance.now()/1000);
  };
  let last=performance.now(),accumulator=0;
  const measure=new URLSearchParams(location.search).has('perf');
  let sampleStart=0,frames=0,samples=[];
  function sample(now,cost){
    if(!sampleStart)sampleStart=now;
    samples.push(cost);frames++;
    if(now-sampleStart<5000)return;
    samples.sort((a,b)=>a-b);
    let out=document.querySelector('#stats');
    if(!out){out=document.createElement('output');out.id='stats';document.querySelector('main').append(out);}
    out.textContent=park.mode+' · '+frames+' frames / '+((now-sampleStart)/1000).toFixed(1)+' s · '+((frames-1)*1000/(now-sampleStart)).toFixed(1)+' FPS · draw p95 '+samples[Math.floor(frames*.95)].toFixed(1)+' ms';
    sampleStart=0;samples=[];frames=0;
  }
  const axis=(a,b)=>Number(keys.has(a)||keys.has(b));
  function frame(now){
    lobby?.place(player);
    const dt=Math.min(.50,(now-last)/1000);accumulator+=dt;last=now;park.advance(dt);
    const dx=axis('KeyD','ArrowRight')-axis('KeyA','ArrowLeft')+joystick.x;
    const dz=axis('KeyS','ArrowDown')-axis('KeyW','ArrowUp')+joystick.z;
    const seconds=now/1000;
    if(lobby&&match.sync())hud.change();
    const state=match?.state;
    const previousPhase=state?.phase;
    if(!lobby && state && state.phase!=='idle' && state.phase!=='end' && match.next(seconds,()=>Rules.answerPad(player),park.botAnswer)){
      if(previousPhase==='restore'){
        player.impulse=null;
        if(state.returning?.[0]!=null||player.y<=Rules.deck.water||!Number.isFinite(Rules.surface(player.x,player.z))){
          Object.assign(player,Motion.position(Motion.roundSpawn(0)),{vy:0,standing:true});
        }
        park.restoreBots?.(state.returning);
      }
      park.phaseChanged(state);hud.change();
    }
    if(state && state.phase==='idle')park.freePlay();
    const move=lobby?match.playable():!state||state.phase==='idle'||(ArenaEvent.moving(state.phase)&&state.lives[0]>0&&state.fallen?.[0]==null);
    const [worldX,worldZ]=park.direction(move?dx:0,move?dz:0);
    const sprinting=move&&(touchSprint||keys.has('ShiftLeft')||keys.has('ShiftRight'));
    const phase=state?.phase;
    const arenaState=lobby?match.view():state&&{...state,until:state.until*1000,dropAt:state.dropAt*1000,restoreAt:state.restoreAt*1000};
    const clock=lobby?Date.now()+lobby.game().clock:now;
    if(lobby&&arenaState?.id!==lastGame){lastGame=arenaState?.id;nextPushAt=0;}
    if(lobby?.launch(player,clock))sound?.play('bump');
    if(typeof Impact!=='undefined'){
      const pushAllowed=Impact.enabled(arenaState,clock)&&move;
      if(pushRequested&&pushAllowed&&now>=nextPushAt){
        nextPushAt=now+Impact.cooldown;
        park.animatePush(now);
        if(lobby){lobby.sample(player,park.heading,Math.hypot(worldX,worldZ),sprinting,now);lobby.push();}
        else park.push?.(player,now,sprinting,state);
      }
      const count=Math.max(0,Math.ceil((nextPushAt-now)/1000));
      pushButton.hidden=!arenaState?.push||!move||!['move','drop'].includes(phase);
      pushButton.disabled=count>0;
      const label=count?'밀기 '+count+'초':'밀기';
      if(pushCaption.textContent!==label){
        pushCaption.textContent=label;
        pushButton.setAttribute('aria-label',count?label:'밀기 (왼쪽 Ctrl)');
      }
    }
    pushRequested=false;
    sound?.presentation.sync(arenaState&&{...arenaState,life:state?.lives[0],
      fallen:state?.fallen?.[0]!=null,winner:state?.winners.length>0},clock);
    const ceremony=results?.(state,clock);
    while(accumulator+1e-9>=1/60){
      const step=1/60,simTime=seconds-accumulator+step;
      const simClock=clock-(seconds-simTime)*1000;
      const water=ArenaEvent.waterLevel(arenaState,simClock);
      const wet=ArenaEvent.waterPhysics(arenaState,water);
      const floor=ArenaEvent.floor(arenaState,simClock,match?.question()[2],water);
      const solid=ArenaEvent.barActive(arenaState,simClock);
      const event=state?.event;
      if(move){
        const before={...player};
        const support=ArenaEvent.support(solid?ArenaEvent.frames(event,simClock):null,player,floor);
        const returning=player.y< -5;
        const jumping=jumpRequested&&before.standing&&Number.isFinite(support(before.x,before.z));
        Rules.step(player,worldX,worldZ,jumpRequested,1/60,sprinting,practice&&(!lobby||!match.view()),support,!wet);
        if(jumping)sound?.play('jump');
        if(!lobby&&player.impulse){
          const movement=Impact.offset(player,simClock-step*1000,simClock);
          if(movement){player.x+=movement.x;player.z+=movement.z;}
        }
        if(lobby&&returning&&player.y===0&&player.z===Rules.spawn().z)lobby.markRespawn(player);
        if(!(returning&&player.y===0&&player.z===Rules.spawn().z)){
          lobby?.reconcile(player,step,support,simClock);
          const wantX=player.x,wantZ=player.z;
          let hit;
          const push=ArenaEvent.resolve(before,player,event,simClock-step*1000,simClock,solid,collision=>{
            if(!hit||collision.speed>hit.speed)hit=collision;
          });
          if(!lobby&&hit&&Impact.rebound(player,hit,simClock)){
            player.vy=Impact.hop;player.standing=false;player.onBar=false;
          }
          if(push>.025)sound?.play('bump');
          lobby?.predictBar(player.x-wantX,player.z-wantZ,simClock);
        }
        if(before.y>water&&player.y<=water&&(!wet||phase==='move'||phase==='restore'))sound?.play('splash');
        if(wet&&player.y<=water){
          if(phase==='move'&&!lobby)Object.assign(player,ArenaEvent.waterSpawn(player));
          accumulator=0;jumpRequested=false;
          if(!lobby&&ArenaEvent.live(phase)){match.drown(0,seconds);hud.change();}
          break;
        }
      }
      if(!lobby&&park.stepCrowd){
        const bar=ArenaEvent.frames(state?.event,simClock);
        park.stepCrowd(player,state,simTime,1/60,{move,sprinting,dx:worldX,dz:worldZ},floor,bar,solid,water);
      }
      jumpRequested=false;accumulator-=1/60;
    }
    const i=Rules.standingPad(player);
    const label=i>=0?(i+1)+'번 발판':player.standing?'중앙 통로':player.y>=0?'점프 중':'광장으로 복귀 중';
    const signal=lobby?.confirmed();
    const roomLabel=lobby&&state?.phase==='move'&&state.lives[0]>0 ? ' · 서버 확인 '+(signal>=0?(signal+1)+'번':'미선택') : '';
    const positionLabel=state?.fallen?.[0]!=null?'물에 빠졌어요 · 복원 대기':state?.lives[0]===0&&state.phase!=='idle'?'관전 중':label+roomLabel;
    if(locationLabel.textContent!==positionLabel)locationLabel.textContent=positionLabel;
    const before=performance.now();park.draw(player,seconds,worldX,worldZ,state,sprinting,ceremony);if(measure)sample(now,performance.now()-before);hud?.sync(seconds);lobby?.sample(player,park.heading,Math.hypot(worldX,worldZ),sprinting,now);requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return start;
}
async function startGame(){
  const config=typeof PortalConfig==='undefined'?null:PortalConfig;
  const practice=config?.practice===true;
  const playCue=QuizSound.arena(config);
  const sound={play:playCue,presentation:createGamePresentation(playCue)};
  const lobby=config?.online ? createLobbyBridge(config.online) : null;
  const bots=practice?0:(config?.settings.bots??29);
  const questions=config?.questions??(config?.settings.quiz==='math'?[sampleQuestions[1],sampleQuestions[5],sampleQuestions[9]]:sampleQuestions);
  const match=lobby?createOnlineMatch(lobby):createSurvival(questions);
  const hud=lobby?createOnlineHUD(match):createSurvivalHUD(match,!!config);
  const renderResult=QuizResults.arena(hud.resultActions);
  let soloResult;
  const results=(state,clock)=>{
    if(state?.phase!=='end'){
      soloResult=null;
      return renderResult(null,clock);
    }
    if(lobby)return renderResult(state.result,clock);
    soloResult??={
      winners:state.winners,ceremonyAt:state.winners.length?state.endedAt:null,
      players:state.lives.map((hp,i)=>({slot:i,hp:hp===Infinity?-1:hp,color:i?i%4:config?.color??0,
        name:i?'토끼 '+(i+1):config?.playerName??'나'})),
    };
    return renderResult(soloResult,clock);
  };
  if(config)document.querySelector('nav').hidden=true;
  let start,pending;
  hud.connect(settings=>{
    if(start)start(settings);
    else{pending=settings;hud.waitForArena();}
  });
  const model=await Promise.all([cloudPadFromGLB(THREE,padBytes),cloudPadFromGLB(THREE,rabbitBytes),loadCrowdAtlas(),cloudPadFromGLB(THREE,spongeBarBytes)]);
  start=play(buildPark(document.querySelector('#world'),model,match,{bots,color:config?.color??0,lobby}),match,hud,practice,lobby,sound,results);
  lobby?.ready();
  hud.arenaReady();
  if(config&&!practice)start({...config.settings,bots,lives:Number(config.settings.lives)});
  else if(pending)start(pending);
}
startGame().catch(e=>{
  console.error(e);
  const setup=document.querySelector('#setup');
  if(setup.open)setup.close();
  document.querySelector('#loading').hidden=true;
  document.querySelector('#play').disabled=true;
  document.querySelector('#error').hidden=false;
});
