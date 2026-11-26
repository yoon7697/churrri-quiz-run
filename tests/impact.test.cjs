const assert=require('node:assert/strict');
const {test}=require('node:test');
const Impact=require('../impact.js');
const {maxContactOffsetPerSecond}=require('../movement-config.js');

test('manual push is opt-in, range-limited, forward-facing and slightly stronger while sprinting',()=>{
  assert.equal(Impact.enabled({phase:'move',until:5000},0),false);
  for(const phase of ['move','drop'])assert.ok(Impact.enabled({push:true,phase,until:5000},4999));
  assert.equal(Impact.enabled({push:true,phase:'restore',until:5000},4999),false);
  assert.equal(Impact.enabled({push:true,phase:'move',until:5000},5000),false);
  assert.equal(Impact.cooldown,3000);
  const point={x:0,y:0,z:0};
  const candidate=(x,y,z)=>({position:{x,y,z}});
  const nearest=candidate(.2,0,1);
  const hit=Impact.target(point,0,[candidate(0,0,-.5),candidate(0,0,2.2),candidate(.5,.8,.7),candidate(0,0,1.5),nearest]);
  assert.equal(hit.candidate,nearest);
  const walk={},sprint={},bar={};
  assert.ok(Impact.shove(walk,hit,false,0));
  assert.ok(Impact.shove(sprint,hit,true,0));
  assert.equal(Impact.shove(sprint,hit,true,200),false);
  assert.ok(Impact.rebound(bar,{...hit,speed:6.2},0));
  const amount=body=>{
    const offset=Impact.offset(body,0,600);
    return Math.hypot(offset.x,offset.z);
  };
  const regular=amount(walk),boosted=amount(sprint),rebound=amount(bar);
  assert.ok(regular>maxContactOffsetPerSecond/10&&boosted>regular&&rebound>boosted*2);
  const displacement=(speed,seconds)=>speed*(1-Math.exp(-5.5*seconds))/5.5;
  assert.ok(Math.abs(regular/displacement(4.8*3,.38)-1.2)<1e-8);
  assert.ok(Math.abs(boosted/displacement(5.7*3,.38)-1.2)<1e-8);
  assert.ok(Math.abs(rebound/displacement(9+6.2*.68,.51)-5)<1e-8);
  assert.ok(Impact.hop>0);
});

test('30 rabbits can rebound without stacking impulses from continuous contact',()=>{
  const crowd=Array.from({length:30},()=>({z:0}));
  for(let tick=0;tick<30;tick++){
    const now=tick*100;
    for(const rabbit of crowd){
      assert.equal(Impact.rebound(rabbit,{x:0,z:1,speed:8},now),tick===0);
      rabbit.z+=Impact.offset(rabbit,now,now+100)?.z??0;
    }
  }
  assert.ok(crowd.every(rabbit=>rabbit.z>11&&rabbit.z<12.1));
  assert.ok(Impact.rebound(crowd[0],{x:0,z:-1,speed:8},3300));
});


test('the active animation extends the arms and fades before the cooldown expires',()=>{
  assert.equal(Impact.gestureWeight(0),0);
  assert.equal(Impact.gestureWeight(100),1);
  assert.equal(Impact.gestureWeight(280)>0,true);
  assert.equal(Impact.gestureWeight(Impact.gestureTime),0);
  assert.ok(Impact.gestureTime<Impact.cooldown);
});

test('the online client applies the larger shove without folding it into movement input',async()=>{
  const vm=require('node:vm');
  const fs=require('node:fs');
  const {Motion,Rules}=await import('../server/arena-motion.mjs');
  const initial=Motion.roundSpawn(0);
  const game={id:'same-game',roundKey:'round',phase:'move',until:null,players:[]};
  const messages=[];
  const parent={postMessage:message=>messages.push(message)};
  let onMessage,now=2000;
  const context=vm.createContext({
    Impact,Motion,Rules,parent,initial,game,ArenaEvent:require('../arena-event.js'),
    MovementConfig:require('../movement-config.js'),
    performance:{now:()=>now},addEventListener:(type,handler)=>{if(type==='message')onMessage=handler;},
  });
  const source=fs.readFileSync('lobby-scene.js','utf8');
  const bridge=vm.runInContext(source+'\ncreateLobbyBridge({slot:0,own:initial,game,clock:0})',context);
  const receive=data=>onMessage({source:parent,data:{type:'quizrun-lobby-state',...data}});
  const player={...Rules.spawn(),...Motion.position(initial)};
  const startX=player.x;
  bridge.place(player);
  bridge.predictBar(.01,0,now);
  player.x+=.01;
  receive({impact:{kind:'push',roundKey:game.roundKey,by:1,slot:0,at:now}});
  const serverShift=2.75;
  receive({poses:[[0,initial[0]+275,...initial.slice(1),275,0]]});
  for(let i=0;i<12;i++){
    now+=1000/60;
    bridge.reconcile(player,1/60,Rules.surface,now);
  }
  assert.ok(Math.abs(player.x-startX-serverShift)<.01);
  bridge.sample(player,0,0,false,now);
  assert.equal(messages.at(-1).pose[0],initial[0]);
});
