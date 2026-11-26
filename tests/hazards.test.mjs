import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ArenaEvent as Event,Motion,Rules,Impact} from '../server/arena-motion.mjs';
import {stepSurvival,stepObstacle,moveImpact} from '../server/hazards.mjs';

test('obstacle draw is disabled on the first round, configurable, and uses the absolute server clock',()=>{
  const config={hazards:true};
  assert.equal(Event.choose(0,config,0,()=>0),null);
  assert.equal(Event.choose(1,{hazards:false},0,()=>0),null);
  assert.ok(Event.choose(1,config,0,()=>.99));
  assert.equal(Event.choose(2,config,0,()=>.90),null);
  const draws=[0,.1,0];
  const a=Event.choose(1,config,10000,()=>draws.shift());
  assert.equal(Event.frame(a,10999),null);
  const start=Event.frame(a,11000);
  assert.equal(start.x,Rules.deck.edgeX*Rules.scale);
  const end=11000+start.x*2/a.speed*1000;
  assert.ok(Event.frame(a,end).x<-.99*start.x);
  assert.ok(Event.frame(a,end+1000).x>Event.frame(a,end).x);
  const spinRolls=[.2,.9];
  const spin=Event.choose(1,config,0,()=>spinRolls.shift());
  assert.ok(Event.frame(spin,3000).dz>0);
  const period=2*Math.PI/spin.speed*1000;
  assert.ok(Math.abs(Event.frame(spin,1000+period).dz)<1e-8);
});

const sweep={kind:'sweep',axis:'z',start:0,direction:1,speed:5};
const crossTime=-(Event.frame(sweep,0).z)/sweep.speed*1000;
const barrier=(event,p)=>{const bar=Event.frame(event,p);return bar.z;};

test('running and sprinting cannot cross either side of a solid bar, even between samples',()=>{
  for(const side of [-1,1]){
    const p={x:0,y:0,z:side*2,standing:true};
    for(let tick=0;tick<30;tick++){
      const last={...p};
      p.z-=side*.9;
      Event.resolve(last,p,sweep,crossTime,crossTime,true);
      assert.ok(side*p.z>.59);
    }
    const attempt={...p,z:-side*3};
    Event.resolve(p,attempt,sweep,crossTime,crossTime,true);
    assert.ok(side*attempt.z>.59);
  }
});

test('30 workers keep moving with the bar without input packets or a contact cooldown',()=>{
  const actors=Array.from({length:30},(_,i)=>({pose:Motion.encode({x:i-14,y:0,z:1},0,0),obstacleAt:crossTime}));
  for(let i=1;i<=14;i++){
    const now=crossTime+i*100;
    for(const actor of actors){
      const old=actor.pose[2];
      stepObstacle(actor,sweep,true,now,Rules.surface,true);
      if(i>=3)assert.ok(actor.pose[2]>old);
      assert.ok(actor.pose[2]/100-barrier(sweep,now)>.59);
    }
  }
});

test('only feet above the real bar top can clear it, and descent can land on the bar',()=>{
  const low={x:0,y:Event.barTop-.03,z:.8};
  const blocked={...low,z:-.8};
  Event.resolve(low,blocked,sweep,crossTime,crossTime,true);
  assert.ok(blocked.z>.59);
  const high={...low,y:Event.barTop+.02};
  const crossed={...high,z:-.8};
  Event.resolve(high,crossed,sweep,crossTime,crossTime,true);
  assert.ok(Math.abs(crossed.z+.8)<1e-8);
  const overhead={x:0,y:Event.barTop+.15,z:0};
  const landing={...overhead,y:Event.barTop-.12,vy:-3,standing:false};
  Event.resolve(overhead,landing,sweep,crossTime,crossTime,true);
  assert.equal(landing.y,Event.barTop);
  assert.ok(landing.onBar&&landing.standing);
  assert.equal(landing.vy,0);
});

test('the existing flat-deck sprint jump can clear the bar with the right timing',()=>{
  let cleared=false;
  for(let delay=0;delay<19;delay++){
    const p={x:0,y:0,z:3.1,standing:true,vy:0};
    for(let frame=0;frame<48;frame++){
      const before={...p};
      Rules.step(p,0,-1,frame===delay,1/60,true,false,Event.support(Event.frames(sweep,crossTime),p,()=>0));
      Event.resolve(before,p,sweep,crossTime,crossTime,true);
      if(p.z<-.67){cleared=true;break;}
    }
  }
  assert.ok(cleared);
});

test('rotation carries the contacted rabbit on its original side',()=>{
  const spin={kind:'spin',start:0,direction:1,speed:.47};
  const p={x:16,y:1.02,z:1};
  for(let i=1;i<=18;i++){
    const prior={...p};
    Event.resolve(prior,p,spin,(i-1)*50,i*50,true);
    const bar=Event.frame(spin,i*50),v=p.z*bar.dx-p.x*bar.dz;
    assert.ok(v>.59);
  }
  assert.ok(p.z>3);
});

test('collisions reach the deadline and an initial overlap clears without a sideways teleport',()=>{
  const a={x:0,y:0,z:.05}, p={...a};
  assert.equal(Event.barActive({phase:'move',event:sweep,until:5000},4999),true);
  assert.equal(Event.barActive({phase:'drop',event:sweep},5000),true);
  Event.resolve(a,p,sweep,crossTime,crossTime,false);
  assert.equal(p.z,.05);
  Event.resolve(a,p,sweep,crossTime,crossTime,true);
  assert.ok(p.z>.05&&p.z<.16);
  for(let i=0;i<22;i++)Event.resolve({...p},p,sweep,crossTime,crossTime,true);
  assert.ok(p.z>.59);
});

test('a correct-pad rabbit carried beyond the submerged edge reaches the water',()=>{
  const [x,z]=Rules.pads[0];
  const match={phase:'drop',dropAt:0},floor=Event.floor(match,2400,0);
  const start=crossTime+(z-1)/sweep.speed*1000;
  const actor={pose:Motion.encode({x,y:Rules.top,z},0,0),obstacleAt:start};
  let submerged=false;
  for(let i=1;i<=28;i++){
    const now=start+i*100;
    stepObstacle(actor,sweep,true,now,floor,true);
    if(stepSurvival(actor,floor,now,.1)){submerged=true;break;}
  }
  assert.ok(submerged);
});

test('worker integrates descent rather than trusting claimed height, and restoration lifts the floor',()=>{
  const game={phase:'drop',dropAt:0};
  const [x,z]=Rules.pads[0];
  const safe={pose:Motion.encode({x,y:Rules.top,z},0,0)};
  const lost={pose:Motion.encode({x:0,y:.40,z:0},0,0)};
  const set=Event.floor(game,2000,0);
  assert.equal(set(x,z),Rules.top);
  assert.equal(set(0,0),-Infinity);
  for(let i=0;i<4;i++)assert.equal(stepSurvival(safe,set,2000+i*100,.1),false);
  assert.ok(Array.from({length:10},(_,i)=>stepSurvival(lost,set,2000+i*100,.1)).some(Boolean));
  assert.equal(Event.floor({phase:'restore',restoreAt:0},850,0)(0,0),Rules.surface(0,0));
});

test('spin rises before becoming solid, stops rotation and lowers during restoration',()=>{
  const event=Event.choose(1,{hazards:true},10000,()=>.9);
  const first=Event.display(event,10000);
  const middle=Event.display(event,10500);
  assert.ok(first.y<middle.y&&middle.y<0);
  assert.equal(first.dz,middle.dz);
  assert.equal(Event.frame(event,10500),null);
  assert.equal(Event.barActive({event,phase:'move',until:15000},10500),false);
  assert.equal(Event.barActive({event,phase:'move',until:15000},11000),true);
  assert.notEqual(Event.display(event,11200).dz,middle.dz);
  assert.equal(Event.barActive({event,phase:'move',until:15000},14999),true);
  assert.equal(Event.barActive({event,phase:'drop'},15000),true);
  const exit=Event.display(event,20000,20000),lower=Event.display(event,20425,20000);
  assert.equal(exit.dx,lower.dx);
  assert.ok(lower.y<0);
  assert.equal(Event.barActive({event,phase:'restore'},20425),false);
  assert.equal(Event.display(event,20850,20000),null);
});

test('incorrect deck stops supporting rabbits at the cutoff even while still above the water',()=>{
  const time=10000, game={phase:'drop',dropAt:time};
  const [wrongX,wrongZ]=Rules.pads[1], [x,z]=Rules.pads[0];
  assert.equal(Rules.sink(0),0);
  const floor=Event.floor(game,time,0);
  assert.equal(floor(wrongX,wrongZ),-Infinity);
  assert.equal(floor(0,0),-Infinity);
  assert.equal(floor(x,z),Rules.top);
  const player={x:wrongX,z:wrongZ,y:Rules.top,standing:true,vy:0};
  Rules.step(player,0,0,true,1/60,false,false,floor,false);
  assert.ok(player.y<Rules.top&&!player.standing);
});

test('ON can draw all three sweep directions and OFF and existing disabled preferences stay off',()=>{
  assert.equal(Event.choose(6,{hazards:false,previousCombination:null},1000),null);
  assert.equal(Event.settings({difficulty:'off'}).hazards,false);
  assert.equal(Event.settings({hazards:true,difficulty:'off'}).hazards,true);
  const selected=[.1,.4,.9].map(value=>{
    const draws=[0,value,.9,.9];
    return Event.choose(1,{hazards:true},1000,()=>draws.shift());
  });
  assert.deepEqual(selected.map(event=>event.axis||event.kind),['x','z','double']);
  assert.equal(Event.frames(selected[2],2010).length,1);
  assert.equal(Event.frames(selected[2],2490).length,2);
});

test('a timed jump clears the raised bar from either surface, with no run-under clearance',()=>{
  const {barY,halfHeight,rabbitHeight}=Event.config;
  assert.ok(barY-halfHeight>Rules.top);
  assert.ok(barY-halfHeight<rabbitHeight);
  assert.ok(Event.barTop<Rules.config.jump**2/(2*Rules.config.gravity));
  for(const height of [0,Rules.top]){
    let cleared=false;
    for(let delay=0;delay<18;delay++){
      const p={x:0,y:height,z:3.1,standing:true,vy:0};
      for(let i=0;i<45;i++){
        const previous={...p};
        Rules.step(p,0,-1,i===delay,1/60,false,false,Event.support(Event.frames(sweep,crossTime),p,()=>height));
        Event.resolve(previous,p,sweep,crossTime,crossTime,true);
        if(p.z<-(Event.config.radius+Event.config.rabbitRadius+.012)&&p.y>height){cleared=true;break;}
      }
      if(cleared)break;
    }
    assert.ok(cleared,'existing jump failed at floor '+height);
  }
});

test('30 rabbits can escape an intersecting double sweep without a doubled impulse',()=>{
  const sx={kind:'sweep',axis:'x',start:0,direction:1,speed:5};
  const sz={...sx,axis:'z',start:460};
  const both={kind:'double',start:0,bars:[sx,sz]};
  const t=-(Event.frame(sx,0).x)/5*1000;
  const rabbits=Array.from({length:30},(_,i)=>({x:.85+i*.01,y:Rules.top,z:.85+i*.02}));
  for(let tick=0;tick<12;tick++){
    const start=t+tick*100,end=start+100;
    for(const rabbit of rabbits){
      const previous={...rabbit};
      rabbit.x-=.4;
      rabbit.z-=.4;
      Event.resolve(previous,rabbit,both,start,end,true);
      const [x,z]=Event.frames(both,end);
      const gap=Event.config.radius+Event.config.rabbitRadius;
      assert.ok(rabbit.x>x.x+gap&&rabbit.z>z.z+gap);
      assert.ok(Math.hypot(rabbit.x-previous.x,rabbit.z-previous.z)<.85);
    }
  }
  const previous={...rabbits[0],y:Event.barTop+.04};
  const jumped={...previous,x:previous.x-1.5,z:previous.z-1.5};
  Event.resolve(previous,jumped,both,t+1200,t+1200,true);
  assert.ok(Math.abs(jumped.x-(previous.x-1.5))<1e-8);
  assert.ok(Math.abs(jumped.z-(previous.z-1.5))<1e-8);
});

test('flood can run alone or with two bars and uses only the shared round clock',()=>{
  const choose=roll=>{
    const draws=[roll,.95,.1,.9];
    return Event.choose(1,{hazards:true},1000,()=>draws.shift());
  };
  const flood=choose(.4), paired=choose(.75);
  assert.equal(flood.kind,'flood');
  assert.equal(paired.kind,'double');
  assert.deepEqual(flood.flood,paired.flood);
  assert.equal(Event.frames(paired,5000).length,2);
  assert.equal(Event.frames(flood,5000).length,0);
  const game={phase:'move',event:paired,until:7000,dropAt:900};
  assert.equal(paired.start,2000);
  assert.equal(paired.flood.start,4000);
  assert.deepEqual([999,1000,1999,2000,3000,3999,4000].map(now=>Event.floodCountdown(game,now)),[0,3,3,2,1,1,0]);
  assert.equal(Event.floodCountdown({...game,event:{...paired,flood:undefined}},2000),0);
  assert.equal(Event.floodCountdown({...game,phase:'drop'},2000),0);
  assert.equal(Event.waterLevel(game,4000),Rules.deck.water);
  assert.ok(Event.waterLevel(game,5100)>Event.waterLevel(game,4400));
  const short=Event.choose(1,{hazards:true},1000,()=>0,4000);
  assert.equal(short.flood,undefined);
  assert.equal(short.kind,'sweep');
  assert.ok(Event.barActive(game,6999));
  const peak=Event.waterLevel(game,7000);
  assert.ok(peak>.401&&peak<Rules.top);
  assert.equal(Event.floor(game,7000)(0,0),-Infinity);
  for(const [x,z] of Rules.pads)assert.equal(Event.floor(game,7000)(x,z),Rules.top);
  const reveal={...game,phase:'drop',dropAt:7000,until:12000};
  assert.equal(Event.waterLevel(reveal,10000),peak);
  assert.ok(Event.barActive(reveal,10000));
  assert.equal(Event.floor(reveal,7000,0)(...Rules.pads[1]),-Infinity);
  const restored={...reveal,phase:'restore',restoreAt:12000};
  const height=Event.waterLevel(restored,12400);
  assert.ok(height<peak&&height>Rules.deck.water);
  assert.equal(Event.waterLevel(restored,12850),Rules.deck.water);
  assert.equal(Event.floor(restored,12850,0)(0,0),Rules.surface(0,0));
  assert.equal(Event.waterLevel({phase:'question'},14000),Rules.deck.water);
});

test('the existing sprint jump crosses the actual flooded horizontal and vertical gaps',()=>{
  const event=Event.choose(1,{hazards:true},0,()=>.4);
  const game={phase:'move',event},now=5000;
  const water=Event.waterLevel(game,now),floor=Event.floor(game,now);
  for(const [axis,dx,dz,target] of [['x',1,0,1],['z',0,1,2]]){
    const [x,z]=Rules.pads[0],point={x,z,y:Rules.top,standing:true,vy:0};
    while(Number.isFinite(floor(point.x+.65*dx,point.z+.65*dz)))point[axis]+=.04;
    point.y=floor(point.x,point.z);
    for(let i=0;i<60;i++){
      Rules.step(point,dx,dz,i===0,1/60,true,false,floor,false);
      assert.ok(point.y>water);
      if(point.standing)break;
    }
    assert.ok(point.standing);
    assert.equal(Rules.answerPad(point),target);
  }
  const stranded={pose:Motion.encode({x:0,y:0,z:0},0,0),t:now};
  assert.ok(stepSurvival(stranded,floor,now,.1,false,water));
  for(let slot=0;slot<30;slot++){
    const safe=Event.waterSpawn(Motion.position(stranded.pose),slot);
    assert.equal(floor(safe.x,safe.z),Rules.top);
    assert.equal(Rules.answerPad(safe),0);
  }
});

test('all six combinations are possible and only the exact previous combination is excluded',()=>{
  const keys=['sweep','spin','flood','sweep+spin','sweep+flood','spin+flood'];
  const draw=(previous,roll,round=1)=>{
    const values=round>1?[0,roll,.95,.9,.9,.9]:[roll,.95,.9,.9,.9];
    return Event.choose(round,{hazards:true,previousCombination:previous},1000,()=>values.shift());
  };
  assert.deepEqual(keys.map((_,i)=>Event.combination(draw(null,(i+.5)/6))),keys);
  for(const previous of keys){
    const current=keys.slice(1).map((_,i)=>Event.combination(draw(previous,(i+.5)/5,2)));
    assert.deepEqual(current,keys.filter(key=>key!==previous));
  }
  assert.ok(Event.choose(2,{hazards:true,previousCombination:null},1000,()=>.99));
});

test('a rotating bar and both sweeps are solid together, but a rabbit above them can pass',()=>{
  const rolls=[.62,.95,.9,.9,.9];
  const event=Event.choose(1,{hazards:true},0,()=>rolls.shift());
  assert.equal(Event.combination(event),'sweep+spin');
  assert.equal(Event.pieces(event).length,3);
  const [first,second,spin]=Event.pieces(event);
  first.start=crossTime-Rules.deck.edgeX*Rules.scale/first.speed*1000;
  second.start=0;
  spin.start=crossTime;
  assert.equal(Event.frames(event,crossTime).length,3);
  const previous={x:2,z:2,y:0,standing:true};
  const resolved={...previous,x:-1,z:-1};
  Event.resolve(previous,resolved,event,crossTime,crossTime,true);
  assert.ok(resolved.x>=Event.config.radius&&resolved.z>=Event.config.radius);
  const airborne={...previous,y:Event.barTop+.1,standing:false};
  const jumped={...airborne,x:-1,z:-1};
  Event.resolve(airborne,jumped,event,crossTime,crossTime,true);
  assert.ok(Math.abs(jumped.x+1)<1e-8&&Math.abs(jumped.z+1)<1e-8);
});


test('a strong shove off the surviving pad reaches water',()=>{
  const [cx,z]=Rules.pads[0],x=cx+Rules.halfX*.92;
  const now=4000, game={phase:'drop',dropAt:now};
  const floor=Event.floor(game,now,0);
  assert.equal(Rules.answerPad({x,z}),0);
  const body={pose:Motion.encode({x,y:floor(x,z),z},0,0),t:now};
  assert.ok(body.pose[1]>0);
  assert.ok(Impact.shove(body,{x:1,z:0},false,now));
  let fell=false;
  for(let t=now+100;t<now+1400;t+=100){
    moveImpact(body,t-100,t);
    if(stepSurvival(body,floor,t,.1)){fell=true;break;}
  }
  assert.ok(fell);
  assert.equal(Rules.answerPad(Motion.position(body.pose)),-1);
});
