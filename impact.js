const Impact=(()=>{
  const cooldown=3000, range=2.1, decay=5.5, shoveScale=3.6, reboundScale=5;
  function enabled(game,now){
    return game?.push===true&&['move','drop'].includes(game.phase)&&now<game.until;
  }
  function target(from,yaw,candidates){
    let closest=null,distance=range;
    const fx=Math.sin(yaw),fz=Math.cos(yaw);
    for(const candidate of candidates){
      const {position}=candidate,dx=position.x-from.x,dz=position.z-from.z;
      const d=Math.hypot(dx,dz);
      if(d<.1||d>distance||Math.abs(position.y-from.y)>.70||(dx*fx+dz*fz)<.67*d)continue;
      closest={candidate,x:dx/d,z:dz/d};distance=d;
    }
    return closest;
  }
  function shove(body,hit,sprint,now){
    if(body.impulse?.kind==='bar'&&body.impulse.until>now)return false;
    if((body.shovedAt??-Infinity)+500>now)return false;
    body.shovedAt=now;
    const speed=(sprint?5.7:4.8)*shoveScale;
    body.impulse={x:hit.x*speed,z:hit.z*speed,start:now,until:now+380,kind:'push'};
    return true;
  }
  function rebound(body,hit,now){
    const previousContact=body.barContactAt??-Infinity;
    body.barContactAt=now;
    if(previousContact+180>now||(body.barAt??-Infinity)+760>now)return false;
    const speed=(9+Math.min(5,Math.max(0,hit.speed)*.68))*reboundScale;
    body.barAt=now;
    body.impulse={x:hit.x*speed,z:hit.z*speed,start:now,until:now+510,kind:'bar'};
    return true;
  }
  function offset(body,from,to){
    const impulse=body.impulse;
    if(!impulse)return null;
    const a=Math.max(0,(from-impulse.start)/1000);
    const b=Math.min((impulse.until-impulse.start)/1000,(to-impulse.start)/1000);
    if(to>=impulse.until)body.impulse=null;
    if(b<=a)return null;
    const scale=(Math.exp(-decay*a)-Math.exp(-decay*b))/decay;
    return {x:impulse.x*scale,z:impulse.z*scale};
  }
  const hop=5.2;
  const gestureTime=380;
  function gestureWeight(age){
    return Math.max(0,Math.min(1,age/60,(gestureTime-age)/145));
  }
  return {gestureTime,gestureWeight,cooldown,enabled,target,shove,rebound,offset,hop};
})();
if(typeof module!=='undefined')module.exports=Impact;
