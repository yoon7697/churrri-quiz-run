const test=require('node:test'),assert=require('node:assert/strict'),r=require('./rules.js');
const layout=require('./participants.js');
test('30 rabbits fit on a pad, including shoulder clearance',()=>{
  const positions=Array.from({length:layout.count},(_,i)=>layout.formation(i));
  for(const [i,[x,z]] of positions.entries()){
    for(const [dx,dz] of [[.55,.55],[-.55,.55],[-.55,-.55],[.55,-.55]])assert.equal(r.padAt(x+dx,z+dz),0);
    for(const [a,b] of positions.slice(i+1))assert.ok(Math.hypot(x-a,z-b)>1.1);
  }
});
for(const [i,[x,z]] of r.pads.entries())test('Reach, jump and land on pad '+(i+1),()=>{
  const p=r.spawn();for(let n=0;n<800;n++){const dx=x-p.x,dz=z-p.z;if(Math.hypot(dx,dz)<.12)break;r.step(p,dx,dz,false,1/60);}
  assert.equal(r.standingPad(p),i);r.step(p,0,0,true,1/60);assert.ok(!p.standing);
  for(let n=0;n<65;n++)r.step(p,0,0,false,1/60);assert.equal(r.standingPad(p),i);
});
test('Fall outside and return',()=>{const p={...r.spawn(),x:27};for(let i=0;i<180;i++)r.step(p,0,0,false,1/60);assert.deepEqual(p,r.spawn());});
// Exercise actual keyboard, joystick, jump and captured drag handlers in one RAF loop.
const vm=require('node:vm'),fs=require('node:fs');
function controlsHarness({spawn=r.spawn,match,impact}={}){
  function element(){
    const el=new EventTarget(),capture=new Set();
    return Object.assign(el,{clientWidth:800,setAttribute(){},firstElementChild:{style:{}},style:{},
      getBoundingClientRect:()=>({left:0,top:0,width:88,height:88}),
      setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)});
  }
  const world=element(),doc=element(),win=element(),els=new Map([['#world',world]]);
  doc.querySelector=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
  let controls,frame,now=0,state, pushes=0;
  const context=vm.createContext({window:win,document:doc,ArenaEvent:require("./arena-event.js"),Motion:require("./motion.js"),Rules:{...r,spawn},match,hud:{change(){},sync(){}},URLSearchParams,location:{search:''},performance:{now:()=>now},
    requestAnimationFrame:fn=>frame=fn,buildPark:host=>{
      controls=context.createCameraControls(host);
      return {phaseChanged(){},animatePush(){pushes++;},advance:controls.advance,direction:controls.direction,draw:(player,t,x,z,match,sprinting)=>{state={...player,dx:x,dz:z,sprinting};}};
    }
  });
  if(impact)context.Impact=require("./impact.js");
  for(const f of ['camera-controls.js','game.js'])vm.runInContext(fs.readFileSync(f,'utf8').split('async function startGame()')[0],context);
  vm.runInContext("play(buildPark(document.querySelector('#world')),match,hud)",context);
  function pointer(target,type,id,x,y=44){
    const el=doc.querySelector(target),e=Object.assign(new Event(type,{cancelable:true}),{pointerId:id,clientX:x,clientY:y,button:0});
    el.dispatchEvent(e);el['on'+type]?.(e);
  }
  return {pointer,pushes:()=>pushes,pushButton:()=>doc.querySelector('#push'),key:(code,down,extra={})=>{
      let prevented=false;
      context[down?'onkeydown':'onkeyup']({code,...extra,preventDefault(){prevented=true;}});
      return prevented;
    },
    tick(n=1){while(n--){now+=1000/60;frame(now);}return state;},
    turn(degrees){pointer('#world','pointerdown',7,400);pointer('#world','pointermove',7,400-degrees*400/180);pointer('#world','pointerup',7,400);},
    pitch:()=>controls.pitch,yaw:()=>controls.yaw};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);
for(const angle of [90,180,270])test('카메라 '+angle+'도에서 WASD·방향키·지속 입력',()=>{
  const h=controlsHarness();h.turn(angle);h.tick(90);
  const forward={90:[-1,0],180:[0,1],270:[1,0]}[angle];
  for(const [keys,x,z] of [[['KeyW','ArrowUp'],0,-1],[['KeyS','ArrowDown'],0,1],[['KeyA','ArrowLeft'],-1,0],[['KeyD','ArrowRight'],1,0]]){
    for(const key of keys){h.key(key,true);
      for(let i=0;i<20;i++){const p=h.tick();near(p.dx,-forward[1]*x-forward[0]*z);near(p.dz,forward[0]*x-forward[1]*z);}
      near(h.yaw(),angle*Math.PI/180);h.key(key,false);
    }
  }
});
test('S를 누른 채 회전하고 W로 전환',()=>{
  const h=controlsHarness();h.key('KeyW',true);h.tick();h.key('KeyW',false);h.key('KeyS',true);
  near(h.tick(40).dz,1);h.turn(180);near(h.tick(40).dz,-1);
  h.key('KeyS',false);h.key('KeyW',true);near(h.tick().dz,1);
});
test('조이스틱 유지 + 별도 손가락 드래그 + 점프',()=>{
  const h=controlsHarness();h.pointer('#stick','pointerdown',1,44,6);
  near(h.tick(3).dz,-1);h.pointer('#world','pointerdown',2,400);
  h.pointer('#world','pointermove',2,200);h.pointer('#jump','pointerdown',3,400);
  const p=h.tick(5);assert.ok(p.dx<-.9 && p.dx>-1);assert.ok(p.y>0);assert.equal(p.standing,false);
  h.pointer('#world','pointercancel',2,200);h.pointer('#world','pointermove',2,0);
  const landed=h.tick(60);near(landed.dx,-1);assert.ok(landed.standing);
});
test('상하 시점의 상한·하한 및 평면 이동',()=>{
  const h=controlsHarness();h.pointer('#world','pointerdown',1,300,300);
  h.pointer('#world','pointermove',1,300,6000);h.tick(90);near(h.pitch(),1.19);
  h.pointer('#world','pointermove',1,300,-6000);h.tick(90);near(h.pitch(),.075);
  h.key('KeyW',true);near(h.tick().dz,-1);
});
test('근평면 모서리에서 구조물을 감지하고 빈 공간에서 원래 거리 확보',()=>{
  const T=require('./vendor/three.min.js'),limit=require('./collision.js');
  const wall=new T.Mesh(new T.BoxGeometry(.32,2,.4));wall.position.set(-.42,1,3);wall.updateMatrixWorld();wall.geometry.computeBoundingSphere();
  const clip=limit(T,[wall]),pivot=new T.Vector3(0,1,0),axis=new T.Vector3(0,0,1);
  assert.ok(clip(pivot,axis,8,2)<2.8);near(clip(pivot,axis.negate(),8,2),8);
});
const createSurvival=require('./survival.js');
test('Reveal timer, one deduction per round, and spectator target',()=>{
  const game=createSurvival(undefined,()=>0);
  game.start(0,{reveal:3,move:15,lives:1});
  assert.equal(game.next(2.99,()=>-1),false);
  game.next(3,()=>-1);assert.equal(game.state.phase,'move');
  game.next(18,()=>-1);
  assert.equal(game.state.phase,'drop');
  assert.equal(game.state.dropAt,18);
  assert.equal(game.state.lives[0],0);
  assert.equal(game.next(18.99,()=>assert.fail('Answer was already locked')),false);
  game.next(23,()=>-1);game.next(24,()=>-1);assert.equal(game.state.phase,'question');
  assert.ok(game.state.lives[game.state.spectator]>0);
  const first=game.state.spectator;game.spectate(1);assert.notEqual(game.state.spectator,first);
});
test('Correct player survives, unlimited lives stay unlimited, and simultaneous elimination ties',()=>{
  const random=()=>.99;
  for(const [lives,answer,expectedWinnerCount] of [[1,1,1],[1,-1,30],[Infinity,-1,30]]){
    const game=createSurvival([['Q',[],1,'']],random);game.start(0,{reveal:3,move:15,lives});
    game.next(3,()=>answer);game.next(18,()=>answer);game.next(19,()=>answer);game.next(24,()=>answer);game.next(25,()=>answer);
    assert.equal(game.state.phase,'end');assert.equal(game.state.winners.length,expectedWinnerCount);
    if(lives===Infinity)assert.equal(game.state.lives[0],Infinity);
  }
});

test('Board-facing layout matches choice order',()=>{
  const probes=[[-11,-9],[11,-9],[-11,9],[11,9]];
  assert.deepEqual(probes.map(([x,z])=>r.padAt(x,z)),[0,1,2,3]);
});
const contact=require('./character-contact.js');
const movement=require('./movement-config.js');

test('Shift switches between run and sprint; diagonals normalize and sprint jumps retain horizontal speed',()=>{
  const h=controlsHarness();h.tick(2);h.key('KeyW',true);
  let before=h.tick(12),after=h.tick(6);
  near((before.z-after.z)*10,r.config.speed);
  h.key('ShiftLeft',true);h.key('KeyD',true);
  before=h.tick(12);after=h.tick(6);
  near(Math.hypot(before.z-after.z,before.x-after.x)*10,r.config.speed*movement.sprintMultiplier);
  h.key('Space',true);assert.ok(h.tick(3).y>0);
  h.key('ShiftLeft',false);before=h.tick(6);after=h.tick(6);
  near(Math.hypot(before.z-after.z,before.x-after.x)*10,r.config.speed);
});

test('Touch sprint toggle, joystick, camera and jump remain independent',()=>{
  const h=controlsHarness();
  h.pointer('#stick','pointerdown',1,44,6);
  h.pointer('#sprint','click',4,600);
  const before=h.tick(4),after=h.tick(6);
  near((before.z-after.z)*10,r.config.speed*movement.sprintMultiplier);
  h.pointer('#world','pointerdown',2,400);
  h.pointer('#world','pointermove',2,220,90);
  h.pointer('#jump','pointerdown',3,680);
  const jumping=h.tick(8);
  assert.ok(jumping.y>0&&jumping.x<after.x&&h.yaw()>0&&h.pitch()>.48);
  h.pointer('#world','pointercancel',2,220);
  h.pointer('#sprint','click',4,600);
  h.tick(70);const a=h.tick(6),b=h.tick(6);
  near(Math.hypot(a.x-b.x,a.z-b.z)*10,r.config.speed);
  h.pointer('#stick','pointerup',1,44,6);
  const c=h.tick(1),d=h.tick(6);near(Math.hypot(c.x-d.x,c.z-d.z),0);
});

test('30 overlapping rabbits separate without exceeding push limits or changing height',()=>{
  const [x,z]=r.pads[0];
  const bodies=Array.from({length:30},()=>({position:{x,z,y:r.top}}));
  for(let n=0;n<360;n++){
    const before=bodies.map(b=>({...b.position}));
    contact.resolve(bodies,1/60,()=>true);
    bodies.forEach(({position:p},i)=>{assert.ok(Math.hypot(p.x-before[i].x,p.z-before[i].z)<=movement.maxContactOffsetPerSecond/60+1e-8);near(p.y,r.top);});
  }
  for(const [i,{position:p}] of bodies.entries())for(const {position:q} of bodies.slice(i+1)){
    assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>movement.contactDiameter-.015);
    assert.equal(r.padAt(p.x,p.z),0);
  }
});

test('A sprinting jumper pushes harder on contact, and separated heights do not collide',()=>{
  function overlap(sprinting,y){
    const a={position:{x:0,y,z:0},sprinting,dx:1,dz:0};
    const b={position:{x:.78,y:0,z:0}};
    contact.resolve([a,b],1/60,()=>true);near(a.position.y,y);
    return b.position.x;
  }
  assert.ok(overlap(true,.25)>overlap(false,.25));
  near(overlap(true,1.15),.78);
  const round={phase:'move',until:20,contact:true};
  assert.equal(contact.enabled(round,17.999,true),true);
  assert.equal(contact.enabled(round,19.999,true),true);
  assert.equal(contact.enabled(round,20,true),false);
  assert.equal(contact.enabled({...round,contact:false},10,true),false);
  assert.equal(contact.enabled({...round,phase:'drop'},10,true),true);
});

test('A start submitted before arena assets load starts once after loading',async()=>{
  let releaseModels,submit;
  const loading=new Promise(resolve=>{releaseModels=resolve;});
  const events=[];
  const context=vm.createContext({
    sampleQuestions:[],createSurvival:()=>({}),
    createSurvivalHUD:()=>({
      connect(callback){submit=callback;},
      waitForArena(){events.push('waiting');},
      arenaReady(){events.push('ready');},
    }),
    cloudPadFromGLB:()=>loading,loadCrowdAtlas:()=>Promise.resolve(null),
    THREE:{},padBytes:null,rabbitBytes:null,spongeBarBytes:null,QuizSound:{arena:()=>()=>{}},createGamePresentation:()=>({}),QuizResults:{arena:()=>()=>null},
    document:{querySelector:()=>({})},buildPark:()=>({}),
    play:()=>settings=>events.push(settings),
  });
  const source=fs.readFileSync('game.js','utf8').split('async function startGame()')[1].split('startGame().catch')[0];
  const startup=vm.runInContext('async function startGame()'+source+'\nstartGame()',context);
  const settings={reveal:3,move:15,lives:3,contact:true};
  submit(settings);
  assert.deepEqual(events,['waiting']);
  releaseModels({});
  await startup;
  assert.deepEqual(events,['waiting','ready',settings]);
});

test('left Ctrl pushes while moving, sprinting and jumping without restoring F or right Ctrl',()=>{
  const match=createSurvival(undefined,()=>0);
  match.start(-2,{reveal:1,move:15,push:true});
  match.next(-1,()=>-1);
  const h=controlsHarness({match,impact:true});
  assert.equal(h.key('KeyF',true),false);
  assert.equal(h.key('ControlRight',true),false);
  assert.equal(h.key('ControlLeft',true,{target:{isContentEditable:true}}),false);
  h.tick();
  assert.equal(h.pushes(),0);
  h.key('KeyD',true);
  h.key('ShiftLeft',true);
  h.key('Space',true);
  assert.equal(h.key('ControlLeft',true),true);
  const airborne=h.tick(2);
  assert.ok(!airborne.standing&&airborne.sprinting&&airborne.x>0);
  assert.equal(h.pushes(),1);
  assert.equal(h.pushButton().disabled,true);
  h.key('ControlLeft',false);
  h.key('ControlLeft',true);
  h.tick();
  assert.equal(h.pushes(),1);
  h.key('KeyD',false);
  h.key('ShiftLeft',false);
  h.tick(185);
  assert.equal(h.key('ControlLeft',true,{repeat:true}),true);
  h.tick();
  assert.equal(h.pushes(),1);
  h.pushButton().onclick();
  h.tick();
  assert.equal(h.pushes(),2);
  match.state.push=false;
  h.tick(185);
  h.key('ControlLeft',true);
  h.tick();
  assert.equal(h.pushes(),2);
});

test('The live frame locks airborne answers by horizontal position at time expiry',()=>{
  const [correctX,correctZ]=r.pads[1], [wrongX,wrongZ]=r.pads[0];
  for(const [x,z,choice] of [[correctX,correctZ,1],[wrongX,wrongZ,0],[0,0,-1]]){
    const match=createSurvival(undefined,()=>0);
    match.start(-4,{reveal:1,move:3.2,lives:3});
    match.next(-3,()=>-1);
    const h=controlsHarness({spawn:()=>({...r.spawn(),x,z,y:r.surface(x,z)}),match});
    h.key('Space',true);
    const p=h.tick(14);
    assert.equal(p.standing,false);
    assert.equal(r.standingPad(p),-1);
    assert.equal(match.state.phase,'drop');
    assert.equal(match.state.choices[0],choice);
    h.key('KeyD',true);
    assert.ok(h.tick(65).x>x);
    assert.equal(match.state.choices[0],choice);
    assert.equal(match.state.phase,'drop');
    assert.equal(match.state.lives[0],choice===1?3:2);
  }
});

test('An airborne computer rabbit is judged by the same pad bounds as a player',()=>{
  const match=createSurvival(undefined,()=>0);
  match.start(0);match.next(3,()=>-1);
  const [x,z]=r.pads[1];
  const airborne={x,z,y:r.top+1,standing:false};
  match.next(18,()=>r.answerPad(airborne),i=>r.answerPad(i===1?airborne:{x:0,z:0,y:2}));
  match.next(19,()=>assert.fail('locked answer must not be read again'));
  assert.deepEqual(match.state.choices.slice(0,3),[1,1,-1]);
  assert.deepEqual(match.state.lives.slice(0,3),[3,3,2]);
});

test('Running speeds are unchanged and the jump clears the taller bars',()=>{
  near(r.config.speed/movement.previousSpeed,1.17);
  near(r.config.speed*movement.sprintMultiplier/movement.previousSpeed,1.755);
  near(r.config.jump,8.2);
  near(r.config.gravity,20);
});

test('Solo settings use the selected opponents and practice prevents falling',()=>{
  const game=createSurvival(undefined,()=>0);
  game.start(0,{bots:6,lives:5,reveal:1,move:12,contact:false});
  assert.deepEqual(game.state.lives,Array(7).fill(5));
  assert.equal(game.state.contact,false);
  game.next(1,()=>-1);
  assert.equal(game.state.until,13);
  const p=r.spawn();
  for(let i=0;i<400;i++)r.step(p,1,1,false,1/60,true,true);
  assert.ok(Number.isFinite(r.surface(p.x,p.z)));
  for(let i=0;i<20;i++)r.step(p,1,0,i===0,1/60,true,true);
  assert.ok(p.y>0);
});

const quizData=require('./quiz-data.js');
test('Excel rows skip fully empty lines, retain numeric choices and report row errors',()=>{
  const draft=quizData.fromExcel([
    {number:1,cells:quizData.headers},
    {number:2,cells:['','','','','','','']},
    {number:3,cells:['7×8?',54,48,56,64,3,'']},
    {number:9,cells:['오류',1,1,'',4,9,'']},
    {number:12,cells:['',1,2,3,4,1,'']},
  ],'테스트');
  assert.equal(draft.entries.length,3);
  assert.deepEqual(draft.entries[0].entry,['7×8?',['54','48','56','64'],2,'']);
  assert.ok(quizData.validate(draft).some(v=>/9행.*같은/.test(v)));
  assert.ok(quizData.validate(draft).some(v=>/9행.*정답 번호/.test(v)));
  assert.ok(quizData.validate(draft).some(v=>/12행.*문제를/.test(v)));
  assert.ok(quizData.validate({title:'MAX',entries:Array(51).fill(draft.entries[0])}).some(v=>v.includes('50')));
});
test('Quiz King export contract and Quiz Run backup round trip use zero-based answers',()=>{
  const king={format:'churrri-quiz',version:1,quizzes:[{id:'king-demo',title:'지역 퀴즈',subject:'사회',questions:[{id:'q1',text:'A?',options:['가','나','다','라'],correct:0,explanation:'가입니다.',kind:'lesson'}]}]};
  const [draft]=quizData.decode(king),quiz={title:draft.title,questions:draft.entries.map(q=>q.entry)};
  assert.deepEqual(quizData.validate(draft),[]);
  assert.deepEqual(quizData.decode(quizData.backup(quiz))[0],draft);
  assert.throws(()=>quizData.decode({version:2}));
});
test('Shuffling moves answer with its choice, preserves the source, and honors count',()=>{
  const source=[['첫 단계',['가','나','다','라'],1,''],['두 번째',['1','2','3','4'],2,'']];
  const pristine=structuredClone(source);
  const gameQuiz=quizData.prepare(source,{questionCount:1,questionOrder:'random',optionOrder:'random'},()=>0);
  assert.deepEqual(gameQuiz,[['두 번째',['2','3','4','1'],1,'']]);
  assert.deepEqual(source,pristine);
  const match=createSurvival(gameQuiz,()=>0);
  match.start(0,{bots:2});
  match.next(3,()=>-1);
  match.next(18,()=>gameQuiz[0][2]);
  match.next(19,()=>-1);
  match.next(24,()=>-1);match.next(25,()=>-1);
  assert.equal(match.state.phase,'end');
  assert.equal(match.state.lives[0],3);
});

test('expanded answer pads narrow both gaps and leave a central route',()=>{
  const rules=require('./rules.js');
  for(const [axis,old,half] of [[0,11.5,8.1],[1,9.45,6.7]]){
    const expanded=axis===0?rules.halfX:rules.halfZ;
    const gap=2*(Math.abs(rules.pads[0][axis])-expanded);
    assert.ok(gap>=2 && gap<2*(old-half)*.6);
    assert.equal(rules.answerPad({x:0,y:0,z:0}),-1);
  }
  rules.pads.forEach(([x,z],i)=>assert.equal(rules.answerPad({x,y:3,z}),i));
});

test('pontoons can submerge independently from the answer pads',()=>{
  const rules=require('./rules.js');
  const layout={center:false,links:false,pads:[false,true,false,false]};
  assert.equal(rules.surface(0,0,layout),-Infinity);
  assert.equal(rules.surface(0,10,layout),-Infinity);
  assert.equal(rules.surface(...rules.pads[0],layout),-Infinity);
  assert.equal(rules.surface(...rules.pads[1],layout),rules.top);
  assert.equal(rules.sink(0),0);
  assert.ok(rules.top-rules.sink(1.60)<rules.deck.water);
  assert.equal(rules.rise(.85),0);
});

test('a sprint jump crosses the water arena gap on both axes',()=>{
  const rules=require('./rules.js');
  for(const [axis,half,direction] of [[0,rules.halfX,[1,0]],[1,rules.halfZ,[0,1]]]){
    const [x,z]=rules.pads[0];
    const position={x:x+(axis===0?half*.94:0),z:z+(axis===1?half*.94:0),y:rules.top,vy:0,standing:true};
    for(let i=0;i<46;i++)rules.step(position,...direction,i===0,1/60,true);
    assert.equal(rules.answerPad(position),axis===0?1:2);
  }
});

test('a sprint jump from a locked wrong pad can land safely without undoing the charge',()=>{
  const event=require('./arena-event.js');
  const game=createSurvival([['Q',[],0,'']]);
  game.start(0,{bots:0});
  game.next(3,()=>1);
  const player={x:3.45,z:r.pads[1][1],y:r.top+.18,vy:6.6,standing:false};
  assert.equal(r.answerPad(player),1);
  game.next(18,()=>r.answerPad(player));
  assert.equal(game.state.lives[0],2);
  const floor=event.floor({phase:game.state.phase,dropAt:18000},18000,0);
  for(let i=0;i<51;i++)r.step(player,-1,0,false,1/60,true,false,floor,false);
  assert.equal(r.answerPad(player),0);
  assert.ok(player.standing);
  assert.equal(game.state.choices[0],1);
  assert.equal(game.state.lives[0],2);
});

test('solo starts a fresh obstacle clock in each of 12 rounds without consecutive empty rounds',()=>{
  let seed=125;
  const random=()=>((seed=Math.imul(1664525,seed)+1013904223>>>0)/4294967296);
  const game=createSurvival(Array.from({length:12},()=>['Q',[],0,'']),random);
  game.start(0,{lives:Infinity});
  let previous=null;
  const eventRules=require('./arena-event.js');
  const kinds=new Set();
  for(let round=0;round<12;round++){
    const cue=game.state.until*1000;
    game.next(game.state.until);
    const {event}=game.state;
    if(round===0)assert.equal(event,null);
    if(round>0&&!previous)assert.ok(event);
    if(event){
      assert.equal(event.cue,cue);
      assert.notEqual(eventRules.combination(event),eventRules.combination(previous));
      kinds.add(eventRules.combination(event));
    }
    previous=event;
    game.next(game.state.until,()=>0);
    game.next(game.state.until);
    assert.equal(game.state.event,event);
    game.next(game.state.until);
    assert.equal(game.state.event,null);
  }
  assert.equal(game.state.phase,'end');
  assert.ok(kinds.size>=3);
});

test('solo result starts after survival and restore and resets on replay',()=>{
  const match=createSurvival([['문제',['A','B','C','D'],0,'']],()=>0);
  match.start(0,{reveal:1,move:3,lives:1,bots:1});
  match.next(1,()=>0);
  match.next(4,()=>0,()=>1);
  assert.equal(match.state.until,9);
  assert.equal(match.next(8.999,()=>0),false);
  match.next(9);
  assert.equal(match.state.phase,'restore');
  match.next(9.85);
  assert.equal(match.state.endedAt,9850);
  assert.deepEqual(match.state.winners,[0]);
  match.start(11,{reveal:1,move:3,lives:1,bots:1});
  assert.equal(match.state.endedAt,null);
  assert.deepEqual(match.state.winners,[]);
  assert.deepEqual(match.state.lives,[1,1]);
});
