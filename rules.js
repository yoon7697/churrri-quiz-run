const Rules=((movement)=>{
  const config={speed:movement.previousSpeed*movement.runMultiplier,gravity:20,jump:8.2};
  const scale=1.15;
  const pads=[[-10.89,-8.96],[10.89,-8.96],[-10.89,8.96],[10.89,8.96]];
  // The visual deck uses the same world bounds and independent sections.
  const deck=Object.freeze({edgeX:22.5,edgeZ:20.5,coreX:2.25,coreZ:1.7,straightX:19.5,straightZ:17.5,corner:3,water:-1.70});
  const smooth=t=>{const k=Math.min(1,Math.max(0,t));return k*k*(3-2*k);};
  const sink=elapsed=>4.8*smooth(elapsed/1.60);
  const rise=elapsed=>4.8*(1-smooth(elapsed/.85));
  const halfX=9.25,halfZ=7.85,top=1.02;
  function edge(x,z,cx,cz){return (Math.abs((x-cx)/halfX)**8+Math.abs((z-cz)/halfZ)**8)**.125;}
  function padAt(x,z,layout){return pads.findIndex(([cx,cz],i)=>layout?.pads?.[i]!==false&&edge(x,z,cx,cz)<=.94);}
  function surface(x,z,layout){
    const dx=Math.max(0,Math.abs(x)/scale-deck.straightX),dz=Math.max(0,Math.abs(z)/scale-deck.straightZ);
    if(dx*dx+dz*dz>deck.corner**2)return -Infinity;
    const core=Math.abs(x)/scale<=deck.coreX&&Math.abs(z)/scale<=deck.coreZ;
    const afloat=core?layout?.center!==false:layout?.links!==false;
    for(const [i,[cx,cz]] of pads.entries()){
      if(layout?.pads?.[i]===false)continue;
      const r=edge(x,z,cx,cz);
      if(r<(afloat?1.05:1))return top*Math.max(0,Math.min(1,(1.05-r)/.14));
    }
    if(!afloat)return -Infinity;
    return Math.min(.401,Math.max(0,(2.36-Math.hypot(x,z))*.95));
  }
  function spawn(){return {x:0,z:14.4,y:0,vy:0,standing:true};}
  function step(p,dx,dz,jump,dt,sprinting=false,practice=false,getFloor=surface,respawn=true){
    const canJump=jump&&p.standing&&Number.isFinite(getFloor(p.x,p.z));
    const k=config.speed*(sprinting?movement.sprintMultiplier:1)*dt/Math.max(1,Math.hypot(dx,dz));const nextX=p.x+dx*k,nextZ=p.z+dz*k;
    if(!practice||Number.isFinite(getFloor(nextX,p.z)))p.x=nextX;
    if(!practice||Number.isFinite(getFloor(p.x,nextZ)))p.z=nextZ;
    const floor=getFloor(p.x,p.z);
    if(canJump){p.vy=config.jump;p.standing=false;}
    if(p.standing && Number.isFinite(floor)){p.y=floor;p.vy=0;return;}
    p.vy-=config.gravity*dt;p.y+=p.vy*dt;p.standing=p.y<=floor && p.vy<=0;
    if(p.standing){p.y=floor;p.vy=0;}if(respawn&&p.y< -6)Object.assign(p,spawn());
  }
  const answerPad=p=>padAt(p.x,p.z);
  const standingPad=p=>p.standing?answerPad(p):-1;
  return {scale,pads,halfX,halfZ,top,deck,sink,rise,config,spawn,surface,step,padAt,answerPad,standingPad};
})(typeof module==='undefined'?MovementConfig:require('./movement-config.js'));
if(typeof module!=='undefined')module.exports=Rules;
