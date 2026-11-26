import {ArenaEvent, Motion, Rules, Impact} from './arena-motion.mjs';

// Horizontal input stays responsive on the client. During survival, only the
// worker integrates height and decides whether a rabbit has reached the sea.
export function stepSurvival(current, floor, now, dt, jump=false, water=Rules.deck.water) {
  const support=ArenaEvent.support(current.supportBar,current,floor);
  const point=Motion.position(current.pose);
  const body=current.vertical??={y:point.y,vy:now-current.t<320?(current.recentVy||0):0,standing:!(current.pose[4]&Motion.airborne)};
  if(jump&&body.standing&&Number.isFinite(support(point.x,point.z))){
    body.vy=Rules.config.jump;
    body.standing=false;
  }
  if(dt>0){
    Object.assign(body,{x:point.x,z:point.z});
    const steps=Math.ceil(dt*60);
    for(let i=0;i<steps;i++)Rules.step(body,0,0,false,dt/steps,false,false,support,false);
  }
  if(body.y<=water)return true;
  current.pose[1]=Math.round(body.y*100);
  current.pose[4]=(current.pose[4]&~Motion.airborne)|(body.standing?0:Motion.airborne);
  return false;
}

export function stepObstacle(current, event, enabled, now, floor, wet, candidate=current.pose, before=current.pose, onImpact) {
  const bar=enabled?ArenaEvent.frames(event,now):null;
  const point={...Motion.position(candidate),onBar:!!current.onBar};
  const previous={...Motion.position(before),onBar:!!current.onBar};
  const start=current.obstacleAt??now;
  current.obstacleAt=now;
  current.supportBar=bar;
  let hit;
  const used=ArenaEvent.resolve(previous,point,event,start,now,enabled,contact=>{
    if(!hit||contact.speed>hit.speed)hit=contact;
  });
  current.onBar=!!point.onBar;
  if(!ArenaEvent.overlapSpace(point.x,point.z))return false;
  const ground=floor(point.x,point.z);
  if(!wet&&!point.onBar&&Number.isFinite(ground)&&!(candidate[4]&Motion.airborne))point.y=ground;
  if(point.onBar&&current.vertical)Object.assign(current.vertical,{y:point.y,vy:0,standing:true});
  const pose=Motion.encode(point,candidate[3]/100,point.onBar?candidate[4]|Motion.airborne:candidate[4]);
  if(!Motion.envelope(pose))return false;
  if(!current.input){
    current.input=before.slice();
    current.input[0]-=current.ox||0;current.input[2]-=current.oz||0;
  }
  current.pushUsed=(current.pushUsed||0)+used;
  current.ox=(current.ox||0)+pose[0]-candidate[0];
  current.oz=(current.oz||0)+pose[2]-candidate[2];
  current.pose=pose;
  if(hit&&onImpact&&Impact.rebound(current,hit,now)){
    current.launch=true;
    current.onBar=false;
    current.vertical={y:point.y,vy:Impact.hop,standing:false};
    current.pose[4]|=Motion.airborne;
    onImpact();
  }
  return used>0||pose[1]!==candidate[1]||pose[4]!==candidate[4];
}

export function moveImpact(current,from,now){
  const delta=Impact.offset(current,from,now);
  if(!delta)return false;
  return applyImpactOffset(current,Math.round(delta.x*100),Math.round(delta.z*100));
}

export function applyImpactOffset(current,dx,dz){
  const next=current.pose.slice();
  next[0]=Math.max(-2840,Math.min(2840,next[0]+dx));
  next[2]=Math.max(-2590,Math.min(2590,next[2]+dz));
  const x=next[0]-current.pose[0],z=next[2]-current.pose[2];
  if(!x&&!z)return false;
  if(!current.input){
    current.input=current.pose.slice();
    current.input[0]-=current.ox||0;
    current.input[2]-=current.oz||0;
  }
  current.ox=(current.ox??0)+x;
  current.oz=(current.oz??0)+z;
  current.pose=next;
  return true;
}
