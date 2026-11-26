function createLobbyBridge(config) {
  let roster = [], poses = new Map(), initial = config.own;
  let applied=false,lastSent=null,lastTime=-Infinity,game=null,clock=0,respawn=false,confirmed=null,retries=0;
  let appliedX=0,appliedZ=0,targetX=0,targetZ=0;
  let acknowledged=null, predictedUntil=-Infinity, forcedUntil=-Infinity, launch;
  const gestures=new Map();
  const apply = pose => {
    if (!Motion.envelope(pose)) return;
    initial = pose;
    appliedX=0;appliedZ=0;targetX=0;targetZ=0;
    acknowledged=pose;
    applied = false;
    predictedUntil=-Infinity;
    lastSent = null;
    retries=0;
  };
  function update(message) {
    if (message.students) {
      roster = message.students;
      const online = new Set(roster.map(student=>student.slot));
      for (const slot of poses.keys()) if (!online.has(slot)) poses.delete(slot);
    }
    if (Object.hasOwn(message,'game')) {
      const next=message.game;
      if (next?.id!==game?.id) {poses.clear();gestures.clear();launch=null;forcedUntil=-Infinity;confirmed=null;respawn=false;}
      game=next;
      clock=message.clock;
    }
    if (message.own) {apply(message.own);confirmed=message.own;launch=null;}
    const impact=message.impact;
    if(impact&&impact.roundKey===game?.roundKey){
      if(impact.kind==='push')gestures.set(impact.by,{kind:'push',at:impact.at});
      if(impact.slot!=null)gestures.set(impact.slot,{kind:impact.kind==='bar'?'bar':'hit',at:impact.at});
      if(impact.slot===config.slot){
        forcedUntil=performance.now()+950;
        predictedUntil=-Infinity;
        if(impact.kind==='bar')launch=impact;
      }
    }
    const now = performance.now();
    for (const [slot,...values] of message.poses || []) {
      const pose=values.slice(0,5);
      if(!Motion.envelope(pose))continue;
      if(slot===config.slot){
        confirmed=pose;
        const [ox=0,oz=0]=values.slice(5,7);
        targetX=ox/100;targetZ=oz/100;
        if(!applied){appliedX=targetX;appliedZ=targetZ;}
        acknowledged=[pose[0]-ox,pose[1],pose[2]-oz,pose[3],pose[4]];
        continue;
      }
      const old = poses.get(slot);
      poses.set(slot,{from:old?.to || pose,to:pose,at:now});
    }
  }
  update(config);
  addEventListener('message',event=>{
    if (event.source!==parent || event.data?.type!=='quizrun-lobby-state') return;
    update(event.data);
  });

  return {
    slot: config.slot,
    push(){if(game)parent.postMessage({type:'quizrun-lobby-push',roundKey:game.roundKey},'*');},
    gesture(slot,now){
      const effect=gestures.get(slot);
      return effect&&now-effect.at<Impact.gestureTime?effect:null;
    },
    launch(player,now){
      if(!launch)return false;
      const age=Math.max(0,(now-launch.at)/1000);
      const y=launch.y;
      launch=null;
      if(age>.42||!Number.isFinite(y))return false;
      player.y=y+Impact.hop*age-.5*Rules.config.gravity*age**2;
      player.vy=Impact.hop-Rules.config.gravity*age;
      player.standing=false;player.onBar=false;
      return true;
    },
    game:()=>({state:game,clock}),
    confirmed:()=>confirmed?Rules.answerPad(Motion.position(confirmed)):-1,
    markRespawn(player) {
      const pose=Motion.roundSpawn(config.slot);
      Object.assign(player,Motion.position(pose),{vy:0,standing:true});
      appliedX=0;appliedZ=0;targetX=0;targetZ=0;
      respawn=true;
    },
    ready() { parent.postMessage({type:'quizrun-lobby-ready'},'*'); },
    place(player) {
      if (applied || !initial) return;
      Object.assign(player,Motion.position(initial),{vy:0,standing:!(initial[4]&Motion.airborne)});
      applied = true;
    },
    predictBar(x,z,now) {
      if(!game||Math.hypot(x,z)<.0001)return;
      appliedX+=x;appliedZ+=z;
      if(performance.now()>=forcedUntil)predictedUntil=now+145;
    },
    reconcile(player,dt,getFloor=Rules.surface,now=Infinity) {
      if(!game||!applied||respawn||now<predictedUntil)return;
      const dx=targetX-appliedX,dz=targetZ-appliedZ,distance=Math.hypot(dx,dz);
      if(distance<.001)return;
      const forced=performance.now()<forcedUntil;
      const rate=forced?55:21;
      const speed=forced?80:MovementConfig.maxContactOffsetPerSecond*1.55;
      const k=Math.min(1-Math.exp(-rate*dt),speed*dt/distance);
      const x=dx*k,z=dz*k;
      if(ArenaEvent.overlapSpace(player.x+x,player.z)){player.x+=x;appliedX+=x;}
      if(ArenaEvent.overlapSpace(player.x,player.z+z)){player.z+=z;appliedZ+=z;}
      const support=getFloor(player.x,player.z);
      if(player.standing&&Number.isFinite(support))player.y=support;
    },
    sample(player, yaw, run, sprint, now) {
      if (now-lastTime<Motion.interval||!applied||
          game&&(!ArenaEvent.moving(game.phase)||game.until!==null&&Date.now()+clock>=game.until||game.players.find(p=>p.slot===config.slot)?.fallenAt!=null)) return;
      const flags = (run>.04?Motion.run|(sprint?Motion.sprint:0):0)|(player.standing&&!player.onBar?0:Motion.airborne);
      const input=game?{x:player.x-appliedX,y:player.y,z:player.z-appliedZ}:player;
      const pose=Motion.encode(input,Math.atan2(Math.sin(yaw),Math.cos(yaw)),flags);
      if (!respawn&&lastSent&&pose.every((value,i)=>value===lastSent[i])) {
        const accepted=acknowledged&&pose.every((value,i)=>i===1&&game&&!(flags&Motion.airborne)||Math.abs(value-acknowledged[i])<=(i===0||i===2?1:0));
        if(!game||accepted||retries>=6||now-lastTime<180)return;
        retries++;
      }else retries=0;
      lastTime = now;
      lastSent = pose;
      parent.postMessage({type:'quizrun-lobby-pose',pose,roundKey:game?.roundKey,respawn},'*');
      respawn=false;
    },
    actors(now) {
      return roster.filter(row=>row.slot!==config.slot).flatMap(row=>{
        const player=game?.players.find(p=>p.slot===row.slot);
        const pose=poses.get(row.slot);
        if(game&&(!player||player.out||player.hp===0&&player.fallenAt==null&&!(game.phase==='drop'&&game.prior.includes(row.slot))))return [];
        const initial=game?Motion.roundSpawn(row.slot):Motion.spawn(row.slot);
        const fraction=pose?Math.min(1,Math.max(0,(now-pose.at)/(Motion.interpolationMs-Motion.interval/2))):1;
        const point=Motion.blend(pose?.from??initial,pose?.to??initial,fraction);
        const age=player?.fallenAt!=null?(Date.now()+clock-player.fallenAt)/1000:null;
        if(age!==null&&age>1)return [];
        if(age!==null)point.y=Rules.deck.water-age*2;
        const waterImpact=age!==null?{x:point.x,y:point.y,z:point.z,age}:null;
        return [{...row,...point,waterImpact}];
      });
    },
  };
}

function buildLobbyRabbits(T, host, scene, camera, renderer, rabbit, maps, colors, bridge) {
  const labels = document.createElement('div');
  labels.className = 'lobby-labels';
  host.append(labels);
  const software = renderer.software;
  const parts = [];
  const avatars = new Map();
  const hidden = new T.Matrix4().makeScale(0,0,0);
  const point = new T.Vector3();
  let renderedCount = 0, last = 0;
  const spriteGeometry = software ? new T.PlaneGeometry(2.54,2.54) : null;
  if (!software) {
    rabbit.traverse(source=>{
      if (!source.isMesh) return;
      const mat = source.material.clone(), jersey = source.material.name === 'Jersey';
      if (jersey) mat.color.setHex(0xffffff);
      const mesh = new T.InstancedMesh(source.geometry,mat,29);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      parts.push({mesh,jersey});
    });
  }

  function add(row) {
    const root = new T.Group(), tag = document.createElement('span');
    root.scale.setScalar(.875);
    tag.className = 'lobby-name';
    labels.append(tag);
    let model, meshes = [], limbs = [];
    if (software) {
      model = new T.Mesh(spriteGeometry,new T.MeshBasicMaterial({map:maps[row.color*4],transparent:true,alphaTest:.15}));
      scene.add(root);
    } else {
      model = rabbit.clone(true);
      model.traverse(part=>{
        if (part.isMesh) meshes.push(part);
        if (/^(Arm|Boot|Ear)/.test(part.name)) limbs.push(part);
      });
    }
    root.add(model);
    const result = {root,tag,model,meshes,limbs,stride:0,color:new T.Color(colors[row.color])};
    avatars.set(row.slot,result);
    return result;
  }

  return function update(time,hide=false) {
    const dt = Math.min(.1,time-last || 1/60);
    last = time;
    const rows = hide?[]:bridge.actors(time*1000), slots = new Set(rows.map(row=>row.slot));
    for (const [slot,actor] of avatars) {
      if (slots.has(slot)) continue;
      actor.tag.remove();
      if (software) { scene.remove(actor.root); actor.model.material.dispose(); }
      avatars.delete(slot);
    }
    camera.updateMatrixWorld();
    const clock=Date.now()+bridge.game().clock;
    rows.forEach((row,index)=>{
      const a = avatars.get(row.slot) || add(row);
      const active = (row.flags&Motion.run)!==0, fast = (row.flags&Motion.sprint)!==0, air = (row.flags&Motion.airborne)!==0;
      if (active) a.stride += dt*(fast?18:12);
      a.root.position.set(row.x,row.y+.015,row.z);
      const bounce = active && !air ? .065*Math.abs(Math.sin(a.stride)) : 0;
      const gesture=bridge.gesture(row.slot,clock);
      const weight=gesture?Impact.gestureWeight(clock-gesture.at):0;
      const reach=gesture?.kind==='push'?weight:0;
      const recoil=weight-reach;
      if (software) {
        const angle = Math.atan2(camera.position.x-row.x,camera.position.z-row.z)-row.yaw;
        const k = (Math.round(angle/(Math.PI/2))%4+4)%4;
        a.model.material.map = maps[row.color*4+k];
        a.model.quaternion.copy(camera.quaternion);
        a.model.position.y = 1.08+bounce;
        a.model.rotateZ(-.32*recoil+.18*reach);
      } else {
        a.root.rotation.y = row.yaw;
        a.model.position.y = bounce;
        a.model.rotation.x=(active?(fast?.20:.11):0)+.28*reach-.68*recoil;
        for (const [i,part] of a.limbs.entries()) {
          const swing = active ? Math.sin(a.stride+i*Math.PI)*(fast?.78:.60) : 0;
          part.rotation.x=part.name.startsWith('Arm')?(swing-(air?.58:0))*(1-reach)-2.15*reach-.7*recoil:
            part.name.startsWith('Ear')?swing*.24+(air?.14:0):swing*.7;
        }
        a.root.updateMatrixWorld(true);
        parts.forEach(({mesh,jersey},j)=>{
          mesh.setMatrixAt(index,a.meshes[j]?.matrixWorld || hidden);
          if (jersey) mesh.setColorAt(index,a.color);
        });
      }

      if (a.tag.textContent!==row.name) a.tag.textContent = row.name;
      point.set(row.x,row.y+2.23,row.z).project(camera);
      a.tag.hidden = point.z>1 || point.z<0 || Math.abs(point.x)>1 || Math.abs(point.y)>1;
      if (!a.tag.hidden) {
        a.tag.style.left = ((point.x+1)*50).toFixed(2)+'%';
        a.tag.style.top = ((1-point.y)*50).toFixed(2)+'%';
      }
    });
    if (rows.length || renderedCount) for (const {mesh} of parts) {
      mesh.count = rows.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    renderedCount = rows.length;
  };
}
