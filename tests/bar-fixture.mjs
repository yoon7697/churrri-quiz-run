export {default} from '../server/worker.mjs';
import {Room as GameRoom} from '../server/worker.mjs';
import {ArenaEvent,Motion,Rules} from '../server/arena-motion.mjs';

export class Room extends GameRoom {
  async tick(room,now){
    const changed=await super.tick(room,now);
    if(changed&&this.game.phase==='move'&&this.game.round===0){
      // Start both sweeps near the spawn so the real socket test is deterministic.
      const sweep=(axis,age)=>({kind:'sweep',axis,direction:1,speed:5,start:now-age});
      this.game.event=this.game.title==='수면 테스트'
        ?ArenaEvent.choose(1,this.game,now,()=>.68,this.game.move)
        :{kind:'double',start:now-4260,bars:[sweep('x',4260),sweep('z',3800)]};
      if(this.game.event.flood){
        // Keep the sweep outside the test players until the flood rescue.
        // The stronger launch can otherwise send them to different pads
        // depending on the workerd alarm and pose flush order.
        for(const bar of ArenaEvent.pieces(this.game.event))bar.speed=2;
        // Expanded answer pads can cover the formation corners. Leave these
        // stationary clients on the central deck to exercise server rescue.
        for(const {slot} of this.game.players){
          const z=slot*.5;
          this.motion.get(slot).pose=Motion.encode({x:0,y:Rules.surface(0,z),z},0,0);
        }
      }
      this.scheduleMotion();
      await this.saveGame(room,now);
    }
    return changed;
  }
}
