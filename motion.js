const Motion = ((Rules,MovementConfig) => {
  const interval = 100;
  const interpolationMs = 160;
  const run = 1, sprint = 2, airborne = 4;
  const scale = 100;
  const jumpHeight=Math.ceil(Rules.config.jump**2/(2*Rules.config.gravity)*scale)+8;
  const elevatedJumpHeight=jumpHeight+24;
  const encode = (p, yaw, flags) => [p.x, p.y, p.z, yaw].map(value => Math.round(value * scale)).concat(flags);
  const position = pose => ({x:pose[0]/scale,y:pose[1]/scale,z:pose[2]/scale});
  function spawn(slot) {
    const x = (slot % 6 - 2.5) * 2.05, z = 12.8 - Math.floor(slot / 6) * 1.45;
    return encode({x,y:Rules.surface(x,z),z}, Math.PI, 0);
  }
  function roundSpawn(slot) {
    const x=(slot%6-2.5)*1.08,z=(Math.floor(slot/6)-2)*1.08;
    return encode({x,y:Rules.surface(x,z),z},Math.PI,0);
  }
  function nearEdge(pose) {
    const {x,z}=position(pose);
    return [-1.9,0,1.9].some(dx=>[-1.9,0,1.9].some(dz=>!Number.isFinite(Rules.surface(x+dx,z+dz))));
  }
  function valid(pose) {
    if (!Array.isArray(pose) || pose.length !== 5 || !pose.every(Number.isSafeInteger)) return false;
    const [x,y,z,yaw,flags] = pose;
    if (Math.abs(x)>2600 || Math.abs(z)>2400 || Math.abs(yaw)>315 || ![0,1,3,4,5,7].includes(flags)) return false;
    const floor = Rules.surface(x/scale,z/scale);
    if (!Number.isFinite(floor)) {
      // Rounding a point on the edge can place its network sample just outside the floor.
      if (![[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]].some(([dx,dz])=>Number.isFinite(Rules.surface((x+dx)/scale,(z+dz)/scale)))) return false;
      return y >= -5 && y <= jumpHeight && ((flags&airborne)!==0 || Math.abs(y)<=6);
    }
    return y >= -5 && (flags&airborne ? y <= Math.max(floor,Rules.top)*scale+elevatedJumpHeight : Math.abs(y-floor*scale)<=6);
  }
  function envelope(pose){
    return Array.isArray(pose)&&pose.length===5&&pose.every(Number.isSafeInteger)&&
      Math.abs(pose[0])<=2840&&Math.abs(pose[2])<=2590&&pose[1]>=-650&&pose[1]<=Math.round(Rules.top*scale)+elevatedJumpHeight&&
      Math.abs(pose[3])<=315&&[0,1,3,4,5,7].includes(pose[4]);
  }
  function validInput(pose){
    if(!Array.isArray(pose)||pose.length!==5||!pose.every(Number.isSafeInteger))return false;
    // Raw commands exclude accumulated server corrections. World limits
    // are verified after those corrections are applied.
    return Math.abs(pose[0])<=100_000&&Math.abs(pose[2])<=100_000&&
      envelope([0,pose[1],0,pose[3],pose[4]]);
  }
  function plausible(before, after, elapsed, compareHeight=true) {
    const dt = Math.min(1.05, Math.max(.035, elapsed / 1000));
    // A delayed packet may follow a sprint that ended between accepted samples.
    const fast = ((before[4]|after[4]) & sprint) || elapsed>=320;
    const speed = Rules.config.speed*(fast ? MovementConfig.sprintMultiplier : 1);
    if (Math.hypot(after[0]-before[0],after[2]-before[2])/scale > speed*dt+.21) return false;
    if (compareHeight&&(before[4]&airborne)&&(after[4]&airborne)&&Math.abs(after[1]-before[1])/scale > 11*dt+.15) return false;
    return true;
  }
  function blend(a,b,t) {
    const mix = (x,y)=>x+(y-x)*t;
    const turn = (b[3]-a[3])/scale;
    return {x:mix(a[0],b[0])/scale,y:mix(a[1],b[1])/scale,z:mix(a[2],b[2])/scale,
      yaw:a[3]/scale+Math.atan2(Math.sin(turn),Math.cos(turn))*t, flags:t<.75?a[4]:b[4]};
  }
  function resting(pose) {
    const {x,z}=position(pose);
    const floor=Rules.surface(x,z);
    const y=Number.isFinite(floor)?Math.round(floor*scale):0;
    return [pose[0],y,pose[2],pose[3],0];
  }
  return {interval,interpolationMs,run,sprint,airborne,encode,position,spawn,roundSpawn,nearEdge,valid,envelope,validInput,plausible,blend,resting};
})(typeof module==='undefined'?Rules:require('./rules.js'),typeof module==='undefined'?MovementConfig:require('./movement-config.js'));
