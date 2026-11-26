import {ArenaEvent,CharacterContact,Motion,Rules} from './arena-motion.mjs';

export const contactActive=(game,now)=>game?.contact&&(ArenaEvent.live(game.phase)||game.phase==='move'&&now<game.until);

export function contactRow(slot, current) {
  const {pose,ox=0,oz=0}=current;
  return ox||oz ? [slot,...pose,ox,oz] : [slot,...pose];
}

export function acceptContactInput(pose,current) {
  if (!Array.isArray(pose)||pose.length!==5||!pose.every(Number.isSafeInteger)||
      Math.abs(pose[0])>100_000||Math.abs(pose[2])>100_000) return null;
  const world=pose.slice();
  world[0]+=current?.ox||0;
  world[2]+=current?.oz||0;
  if (!(pose[4]&Motion.airborne)) {
    const {x,z}=Motion.position(world);
    const floor=Rules.surface(x,z);
    if (Number.isFinite(floor)) {
      if (pose[1] < -5 || pose[1] > Math.round(Rules.top*100)+6) return null;
      world[1]=Math.round(floor*100);
    }
  }
  return Motion.valid(world)?world:null;
}

// Only connected, surviving students enter this solver. Per-pair work is bounded by the shared two-pass solver.
export function solveContacts(entries,now,dt,{floor=Rules.surface,wet=false,event=null,solid=false}={}) {
  const bodies=entries.map(([slot,current])=>{
    const recent=now-current.t<300;
    return {slot,current,position:Motion.position(current.pose),
      sprinting:recent&&(current.pose[4]&Motion.sprint)!==0,dx:current.dx||0,dz:current.dz||0,pushUsed:current.pushUsed};
  });
  CharacterContact.resolve(bodies,dt,(x,z)=>wet?ArenaEvent.overlapSpace(x,z):Number.isFinite(floor(x,z)));
  return bodies.flatMap(({slot,current,position})=>{
    const prior=Motion.position(current.pose);
    if(solid)ArenaEvent.resolve(prior,position,event,now,now,true);
    const airborne=(current.pose[4]&Motion.airborne)!==0;
    if(!airborne&&Number.isFinite(floor(position.x,position.z)))position.y=floor(position.x,position.z);
    const pose=Motion.encode(position,current.pose[3]/100,current.pose[4]);
    const dx=pose[0]-current.pose[0],dz=pose[2]-current.pose[2];
    if(!dx&&!dz||!(wet?Motion.envelope(pose):Motion.valid(pose)))return [];
    current.ox=(current.ox||0)+dx;
    current.oz=(current.oz||0)+dz;
    current.pose=pose;
    return [slot];
  });
}
