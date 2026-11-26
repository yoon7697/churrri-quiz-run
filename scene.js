async function loadCrowdAtlas(){
  const canvas=await Promise.all(crowdImages.map(async url=>{
    const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);return c;
  }));
  return canvas.map(c=>{const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return map;});
}
function buildPark(host,[pad,rabbit,maps,spongeBar],match,{bots=29,color=0,lobby=null}={}){
  const T=THREE,scene=new T.Scene(),camera=new T.PerspectiveCamera(65,1,.3,155);
  let renderer;try{renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{renderer=softwareRenderer();}
  host.append(renderer.domElement);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  scene.fog=new T.Fog('#b1dcff',42,99);
  scene.add(new T.HemisphereLight('#fff7ee','#c0a7e4',1.65));
  const sun=new T.DirectionalLight('#fff0d2',2.1);sun.position.set(-18,30,12);scene.add(sun);
  const rim=new T.DirectionalLight('#b7ebff',.73);rim.position.set(14,12,-18);scene.add(rim);
  const stadium=buildStadium(T,scene,pad,renderer.software),controls=createCameraControls(host),avoid=createCameraCollision(T,stadium.blockers);
  const drawBar=buildSpongeBars(T,scene,spongeBar);
  const shade=ArenaArt.sheet(64,64,g=>{let grad=g.createRadialGradient(32,32,0,32,32,32);grad.addColorStop(0,'#3d328f80');grad.addColorStop(.55,'#593f9540');grad.addColorStop(1,'#59409600');g.fillStyle=grad;g.fillRect(0,0,64,64);});
  const shadowMat=new T.MeshBasicMaterial({map:new T.CanvasTexture(shade),transparent:true,depthWrite:false});
  const shadowGeo=new T.PlaneGeometry(2.12,1.45);
  function contact(){const m=new T.Mesh(shadowGeo,shadowMat);m.rotation.x=-Math.PI/2;scene.add(m);return m;}
  const suitColors=['#7160dc','#fb608e','#28c6ad','#ffb636'];
  const award=buildCeremony(T,host,scene,camera,maps,rabbit,suitColors,renderer.software);
  function avatar(index){
    const palette=index?index%4:color,root=new T.Group(),lod=renderer.software && index>0;scene.add(root);root.scale.setScalar(.875);
    let model,arms=[],feet=[],ears=[];const shadow=contact();
    if(lod){
      model=new T.Mesh(new T.PlaneGeometry(2.54,2.54),new T.MeshBasicMaterial({map:maps[palette*4],transparent:true,alphaTest:.15,depthWrite:true}));root.add(model);model.position.y=1.06;
    }else{
      model=index?new T.Group():rabbit.clone(true);root.add(model);
      model.traverse(m=>{if(m.isMesh&&m.material.name==='Jersey'){m.material=m.material.clone();m.material.color.set(suitColors[palette]);}
        if(m.name.startsWith('Arm'))arms.push(m);if(m.name.startsWith('Boot'))feet.push(m);if(m.name.startsWith('Ear'))ears.push(m);});
    }
    return {root,model,arms,feet,ears,shadow,palette,lod,yaw:0};
  }
  const remoteDraw=lobby?buildLobbyRabbits(T,host,scene,camera,renderer,rabbit,maps,suitColors,lobby):null;
  const actors=Array.from({length:bots+1},(_,i)=>avatar(i));
  // Share each rabbit part across the crowd in one GPU draw per part.
  const batches=[];
  if(!renderer.software&&bots){
    rabbit.updateMatrixWorld(true);
    rabbit.traverse(part=>{if(!part.isMesh)return;
      const jersey=part.material.name==='Jersey',mat=part.material.clone();
      if(jersey)mat.color.setHex(0xffffff);
      const batch=new T.InstancedMesh(part.geometry,mat,actors.length-1);
      for(let i=1;i<actors.length;i++)if(jersey)batch.setColorAt(i-1,new T.Color(suitColors[actors[i].palette]));
      batch.frustumCulled=false;scene.add(batch);batches.push([batch,part.matrixWorld.clone()]);
    });
  }
  function poseNPCs(gathered){
    for(let i=1;i<actors.length;i++){
      const a=actors[i],[x,z]=gathered?Participants.formation(i-1):Participants.scattered(i-1);
      a.root.position.set(x,Rules.surface(x,z)+.02,z);
      a.yaw=gathered?(i%3-1)*.35:(i*2.399+1.2);
      if(!a.lod)a.root.rotation.y=a.yaw;
      a.shadow.position.set(x,Rules.surface(x,z)+.048,z);
    }
  }
  const hiddenInstance=new T.Matrix4().makeScale(0,0,0);
  const instanceMatrix=new T.Matrix4();
  function syncInstances(){
    if(!batches.length)return;
    for(let i=1;i<actors.length;i++){
      const root=actors[i].root;
      if(root.visible)root.updateMatrixWorld();
      for(const [batch,local] of batches){
        batch.setMatrixAt(i-1,root.visible?instanceMatrix.multiplyMatrices(root.matrixWorld,local):hiddenInstance);
      }
    }
    for(const [batch] of batches)batch.instanceMatrix.needsUpdate=true;
  }
  let cheerEnd=0,gathered=false,overview=false,free=true;poseNPCs(false);syncInstances();
  const targets=[],botPhysics=[];
  let pushingAt=-Infinity;
  const gather=document.querySelector('#group'),view=document.querySelector('#camera');
  gather.onclick=()=>{gathered=!gathered;if(gathered)cheerEnd=performance.now()/1000+1.2;poseNPCs(gathered);syncInstances();
    const [x,z]=gathered?Participants.formation(actors.length-1):[0,Rules.spawn().z];
    Object.assign(player,Rules.spawn(),{x,z,y:Rules.surface(x,z)});clearInput();overview=gathered;viewState();
    gather.setAttribute('aria-pressed',String(gathered));gather.textContent=gathered?'분산 배치':'한 발판에 모으기';};
  function viewState(){view.textContent=overview?'플레이 시점':'전체 보기';view.setAttribute('aria-pressed',String(overview));}
  view.onclick=()=>{overview=!overview;viewState();};
  const focus=new T.Vector3(0,0,Rules.spawn().z),pivot=new T.Vector3(),axis=new T.Vector3(),look=new T.Vector3(),eye=new T.Vector3(),farEye=new T.Vector3();
  let last=null,blend=0,boom=12,heading=Math.PI,grounded=true,landing=1,stride=0;
  new ResizeObserver(()=>{camera.aspect=host.clientWidth/Math.max(1,host.clientHeight);camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight,false);}).observe(host);
  function startMatch(){
    free=false;overview=false;viewState();poseNPCs(false);botPhysics.length=0;

  }
  function freePlay(){
    if(free)return;
    free=true;gathered=false;overview=false;viewState();
    gather.textContent='한 발판에 모으기';gather.setAttribute('aria-pressed','false');
    Object.assign(player,Rules.spawn());actors[0].root.visible=true;
    for(const a of actors){a.root.visible=true;a.shadow.visible=true;}
    poseNPCs(false);syncInstances();
  }
  function phaseChanged(s){
    if(s.phase==='move'){
      for(let i=1;i<actors.length;i++){
        targets[i]=s.choices[i]>=0?Participants.seat(i-1,s.choices[i]):null;
      }
    }
    if(s.phase==='end'&&s.winners.includes(0))cheerEnd=performance.now()/1000+4;
  }
  const contactSetting=document.querySelector('[name=contact]');
  function stepCrowd(player,state,time,dt,input,floor,bars,barEnabled,water){
    const phase=state?.phase??'idle';
    if(phase==='end')return;
    const wet=ArenaEvent.waterPhysics(state,water);
    const contact=CharacterContact.enabled(state,time,contactSetting.checked);
    const bodies=[];
    if(input.move)bodies.push({position:player,...input});
    for(let i=1;i<actors.length;i++){
      const sinkingOut=phase==='drop'&&!state.lives[i]&&state.previous[i]>0;
      if(phase!=='idle'&&(!state.lives[i]&&!sinkingOut||state.fallen[i]!=null))continue;
      const actor=actors[i],point=actor.root.position;
      if(phase==='idle'){bodies.push({position:point});continue;}
      const position=botPhysics[i]??={x:point.x,y:point.y-.02,z:point.z,standing:true,vy:0};
      const target=phase==='move'?targets[i]:null;
      let dx=0,dz=0;
      if(target){dx=target[0]-position.x;dz=target[1]-position.z;}
      else if(wet&&state.choices[i]===match.question()[2]){
        const [x,z]=Rules.pads[match.question()[2]],angle=time*.65+i*2.399;
        dx=x+Math.cos(angle)*(2+i%4)-position.x;
        dz=z+Math.sin(angle)*(2+i%3)-position.z;
      }
      const distance=Math.hypot(dx,dz),divisor=Math.max(distance,1);
      if(distance>.08){
        actor.yaw=Math.atan2(dx,dz);
        if(!actor.lod)actor.root.rotation.y=actor.yaw;
      }
      const sep=Math.min(...bars.map(bar=>Math.abs((position.x-bar.x)*bar.dz-(position.z-bar.z)*bar.dx)));
      const floodedGap=wet&&phase==='move'&&distance>1&&
        !Number.isFinite(floor(position.x+1.4*dx/divisor,position.z+1.4*dz/divisor));
      const jump=floodedGap||sep<2.4&&Math.sin(time*4+i)>-.40;
      const before={...position};
      const solid=barEnabled&&!sinkingOut;
      Rules.step(position,dx/divisor,dz/divisor,jump,dt,floodedGap||wet&&phase==='move'&&!position.standing,false,ArenaEvent.support(solid?bars:null,position,floor),!wet);
      const impulse=Impact.offset(position,(time-dt)*1000,time*1000);
      if(impulse){position.x+=impulse.x;position.z+=impulse.z;}
      let hit;
      const pushUsed=ArenaEvent.resolve(before,position,state.event,(time-dt)*1000,time*1000,solid,collision=>{
        if(!hit||collision.speed>hit.speed)hit=collision;
      });
      if(hit&&Impact.rebound(position,hit,time*1000)){
        position.vy=Impact.hop;position.standing=false;position.onBar=false;
      }
      if(wet&&position.y<=water){
        if(phase==='move')Object.assign(position,ArenaEvent.waterSpawn(position,i));
        else if(sinkingOut)state.fallen[i]=time;
        else if(ArenaEvent.live(phase))match.drown(i,time);
      }
      if(!sinkingOut&&state.fallen[i]==null)bodies.push({position,pushUsed});
      const hitAge=time*1000-Math.max(position.shovedAt??-Infinity,position.barAt??-Infinity);
      const recoil=-.53*Impact.gestureWeight(hitAge);
      if(actor.lod)actor.model.rotation.z=recoil*.55;
      else actor.root.rotation.x=recoil;
      point.set(position.x,position.y,position.z);
    }
    if(contact){
      const before=barEnabled?bodies.map(body=>({...body.position})):null;
      CharacterContact.resolve(bodies,dt,(x,z)=>wet?ArenaEvent.overlapSpace(x,z):Number.isFinite(floor(x,z)));
      if(before)for(const [i,body] of bodies.entries())ArenaEvent.resolve(before[i],body.position,state.event,time*1000,time*1000,true);
    }
    if(phase!=='idle')for(let i=1;i<actors.length;i++){
      const p=botPhysics[i];if(p)actors[i].root.position.set(p.x,p.y,p.z);
    }
  }
  function restoreBots(returning){
    for(let i=1;i<actors.length;i++){
      const p=botPhysics[i];
      if(!p)continue;
      if(returning?.[i]!=null||p.y<=Rules.deck.water||!Number.isFinite(Rules.surface(p.x,p.z))){
        const spawn=Motion.position(Motion.roundSpawn(i));
        Object.assign(p,spawn,{standing:true,vy:0});
      }
      p.onBar=false;p.impulse=null;
    }
  }
  function push(player,now,sprinting,state){
    const targets=botPhysics.flatMap((position,i)=>position&&state.lives[i]>0&&state.fallen[i]==null?[{position}]:[]);
    const hit=Impact.target(player,heading,targets);
    if(hit)Impact.shove(hit.candidate.position,hit,sprinting,now);
  }
  function botAnswer(i){
    return Rules.answerPad(actors[i].root.position);
  }
  function draw(p,t,x,z,s,sprinting,ceremony){
    const phase=s?.phase??'idle',answering=['drop','restore','between'].includes(phase);
    const correct=answering?match.question()[2]:-1;
    const elapsed=phase==='drop'?Math.max(0,t-s.dropAt):0;
    const restore=phase==='restore'?Rules.rise(t-s.restoreAt):0,splashes=[];
    const barClock=lobby?Date.now()+lobby.game().clock:t*1000;
    const arenaState=lobby?match.view():s&&{...s,dropAt:s.dropAt*1000,restoreAt:s.restoreAt*1000};
    const water=ArenaEvent.waterLevel(arenaState,barClock);
    const floorAt=ArenaEvent.floor(arenaState,barClock,correct,water);
    stadium.surfaces.water.position.y=water;
    stadium.update(phase==='idle'||phase==='countdown'?null:match.question(),correct,elapsed,answering?t-s.revealAt:0,restore,correct);
    const exitAt=phase==='restore'?(lobby?match.view().restoreAt:s.restoreAt*1000):null;
    drawBar(s?.event,barClock,exitAt);
    award(ceremony);
    if(ceremony){
      for(const actor of actors){actor.root.visible=false;actor.shadow.visible=false;}
      syncInstances();
      remoteDraw?.(t,true);
      stadium.animate(t,0,-1,[],camera);
      renderer.render(scene,camera);
      return;
    }
    {
      for(let i=1;i<actors.length;i++){
        const a=actors[i],pos=a.root.position,fall=s?.fallen?.[i];
        const age=fall!=null?t-fall:null;
        a.root.visible=phase==='idle'||(age===null?s.lives[i]>0||phase==='drop'&&s.previous[i]>0:age<.85)||phase==='end'&&s.winners.includes(i);
        if(age!==null&&age<1)splashes.push({x:pos.x,y:pos.y,z:pos.z,age});
        const height=floorAt(pos.x,pos.z);
        a.shadow.visible=a.root.visible&&age===null&&Number.isFinite(height);
        a.shadow.position.set(pos.x,height+.052,pos.z);
      }
      syncInstances();
    }
    const dt=last===null?1/60:Math.min(.14,t-last);last=t;
    const runner=actors[0],run=Math.min(1,Math.hypot(x,z));
    if(run){const a=Math.atan2(x,z);heading+=Math.atan2(Math.sin(a-heading),Math.cos(a-heading))*(1-Math.exp(-14*dt));}
    const fall=s?.fallen?.[0],fallAge=fall!=null?t-fall:null;
    const runnerFalls=fallAge!==null&&fallAge<.85;
    runner.root.visible=phase==='idle'||s.lives[0]>0&&fallAge===null||runnerFalls||phase==='end'&&s.winners.includes(0);
    if(runnerFalls)splashes.unshift({x:p.x,y:p.y,z:p.z,age:fallAge});
    runner.root.position.set(p.x,runnerFalls?water-fallAge*2:p.y+.015,p.z);runner.root.rotation.y=heading;
    if(p.standing&&!grounded)landing=0;else landing+=dt;grounded=p.standing;
    stride=(stride+dt*(sprinting?18:12)*run)%(2*Math.PI);
    const power=sprinting?1.3:1;
    const squash=Math.sin(Math.min(1,landing/.20)*Math.PI)*.14;
    runner.model.scale.set(1+squash,1-squash+(p.standing?0:.05),1+squash);
    runner.model.position.y=run&&p.standing?.065*Math.abs(Math.sin(stride)):0;
    const cheering=t<cheerEnd && !run && p.standing;
    if(cheering)runner.model.position.y+=.19*Math.abs(Math.sin((cheerEnd-t)*9));
    runner.model.rotation.x=runnerFalls||p.y<-.2?-.28:run*(sprinting?.20:.11);
    const gesture=lobby?.gesture(lobby.slot,barClock);
    const reach=Impact.gestureWeight(t*1000-pushingAt);
    const hitAt=lobby?(gesture&&gesture.kind!=='push'?gesture.at:-Infinity):(p.barAt??-Infinity);
    const recoil=Impact.gestureWeight(barClock-hitAt);
    runner.model.rotation.x+=.28*reach-.68*recoil;
    for(const [i,limb] of runner.arms.entries()){
      const swing=run*Math.sin(stride+i*Math.PI)*.65*power+(cheering?-1.75:(p.standing?0:-.58));
      limb.rotation.x=swing*(1-reach)-2.15*reach-.7*recoil;
    }
    for(const [i,foot] of runner.feet.entries())foot.rotation.x=run*Math.sin(stride+i*Math.PI)*.45*power;
    for(const [i,ear] of runner.ears.entries())ear.rotation.x=run*(.12*power+.11*power*Math.sin(stride-.65+i*.45))+(p.standing?0:.14);
    const floor=floorAt(p.x,p.z);runner.shadow.visible=runner.root.visible&&!runnerFalls&&Number.isFinite(floor);runner.shadow.position.set(p.x,(Number.isFinite(floor)?floor:0)+.052,p.z);
    const remoteTarget=lobby&&s.lives[0]===0?match.targetPlayer()?.slot:null;
    const followed=remoteTarget!=null?lobby.actors(t*1000).find(row=>row.slot===remoteTarget):null;
    const viewing=!!followed||(!lobby&&phase!=='idle'&&s.lives[0]===0&&s.lives[s.spectator]>0);
    const subject=followed||(viewing?actors[s.spectator].root.position:p);
    const yy=viewing?subject.y:Number.isFinite(floor)?floor+.25*Math.max(0,p.y-floor):Math.max(-1.2,p.y);
    focus.lerp(pivot.set(subject.x,yy,subject.z),1-Math.exp(-11*dt));pivot.copy(focus);pivot.y+=1.42;
    const yaw=controls.yaw,pitch=controls.pitch,sx=Math.sin(yaw),cz=Math.cos(yaw);
    axis.set(sx*Math.cos(pitch),Math.sin(pitch),cz*Math.cos(pitch));
    const limit=avoid(pivot,axis,11.5,camera.aspect);boom=Math.min(limit,boom+(limit-boom)*(1-Math.exp(-7*dt)));
    eye.copy(pivot).addScaledVector(axis,boom);look.copy(pivot);look.x-=sx*5.8;look.z-=cz*5.8;
    blend+=((overview?1:0)-blend)*(1-Math.exp(-7*dt));
    const span=Math.max(40,44/camera.aspect);
    farEye.set(sx*span*.53,span*1.11,cz*span*.53+2);camera.position.copy(eye).lerp(farEye,blend);look.lerp(pivot.set(0,0,-1.2),blend);camera.lookAt(look);
    for(let i=1;i<actors.length;i++){const a=actors[i];
      if(a.lod){
        const angle=Math.atan2(camera.position.x-a.root.position.x,camera.position.z-a.root.position.z)-a.yaw;
        const k=(Math.round(angle/(Math.PI/2))%4+4)%4;
        a.model.material.map=maps[a.palette*4+k];a.model.quaternion.copy(camera.quaternion);
        a.model.position.y=1.08+.026*Math.sin(t*1.8+i);
        if(t*1000-(botPhysics[i]?.shovedAt??-Infinity)<350)a.model.rotateZ(-.22);
      }else a.model.position.y=.026*Math.sin(t*1.8+i);
    }
    if(elapsed>0&&lobby)for(const row of lobby.actors(t*1000))if(row.waterImpact)splashes.push(row.waterImpact);
    remoteDraw?.(t);stadium.animate(t,elapsed,correct,splashes,camera);renderer.render(scene,camera);
  }
  return {get heading(){return heading;},draw,stepCrowd,restoreBots,push,animatePush:now=>{pushingAt=now;},clearGestures:()=>{pushingAt=-Infinity;},botAnswer,startMatch,freePlay,phaseChanged,advance:controls.advance,direction:controls.direction,mode:renderer.software?'Canvas 호환':'WebGL'};
}
