const MovementConfig=Object.freeze({
  previousSpeed:5.7,
  runMultiplier:1.17,
  sprintMultiplier:1.5,
  contactDiameter:.86,
  maxContactOffsetPerSecond:4,
  contactHeight:.73,
});

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
})(MovementConfig);

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
})(Rules,MovementConfig);

const QuizData=(()=>{
  const max=50;
  const headers=['문제','선택지 1','선택지 2','선택지 3','선택지 4','정답 번호','해설'];
  function text(value){return typeof value==='string'||typeof value==='number'?String(value).trim():'';}
  function questionErrors(entry){
    const errors=[];
    const title=text(entry[0]),choices=entry[1].map(text),correct=entry[2];
    if(!title)errors.push('문제를 입력하세요.');
    if(title.length>500)errors.push('문제는 500자 이내로 입력하세요.');
    choices.forEach((choice,index)=>{
      if(!choice)errors.push(`선택지 ${index+1}이 비어 있습니다.`);
      else if(choice.length>180)errors.push(`선택지 ${index+1}은 180자 이내로 입력하세요.`);
    });
    const nonempty=choices.filter(Boolean).map(v=>v.normalize('NFKC').toLowerCase());
    if(new Set(nonempty).size!==nonempty.length)errors.push('같은 선택지가 있습니다.');
    if(!Number.isInteger(correct)||correct<0||correct>3)errors.push('정답 번호는 1~4 중에서 선택하세요.');
    if(text(entry[3]).length>1200)errors.push('해설은 1,200자 이내로 입력하세요.');
    return errors;
  }
  function validate(draft){
    const errors=[];
    const title=text(draft.title);
    if(!title||title.length>80)errors.push('퀴즈 제목을 1~80자로 입력하세요.');
    if(!draft.entries.length||draft.entries.length>max)errors.push('문제는 1~50개까지 저장할 수 있습니다.');
    draft.entries.forEach((q,i)=>{
      for(const issue of questionErrors(q.entry))errors.push(`${q.row?`엑셀 ${q.row}행`:`${i+1}번 문제`} · ${issue}`);
    });
    return errors;
  }
  function fromExcel(rows,title){
    if(!rows.length||headers.some((header,i)=>text(rows[0].cells[i])!==header))throw Error('첫 행의 열 이름을 확인해 주세요. 엑셀 작성 양식을 이용하면 됩니다.');
    const entries=rows.slice(1).filter(row=>row.cells.some(v=>text(v)!=='')).map(({number,cells})=>{
      if(cells.slice(7).some(v=>text(v)!==''))throw Error(`엑셀 ${number}행 · 해설 열 뒤에 입력된 값이 있습니다.`);
      const answer=text(cells[5]);
      return {row:number,entry:[text(cells[0]),Array.from({length:4},(_,i)=>text(cells[i+1])),/^[1-4]$/.test(answer)?Number(answer)-1:-1,text(cells[6])]};
    });
    return {title,entries};
  }
  function decode(value){
    if(value?.version!==1||!['churrri-quiz','churrri-quizrun'].includes(value.format)||!Array.isArray(value.quizzes)||!value.quizzes.length||value.quizzes.length>100){
      throw Error('퀴즈왕 또는 퀴즈런에서 내보낸 JSON 파일을 선택해 주세요.');
    }
    return value.quizzes.map((quiz,i)=>{
      if(typeof quiz?.title!=='string'||!Array.isArray(quiz.questions)||quiz.questions.length>1000)throw Error(`파일의 ${i+1}번째 퀴즈에서 제목 또는 문제 목록을 읽을 수 없습니다.`);
      return {title:quiz.title,entries:quiz.questions.map((q,j)=>{
        if(typeof q?.text!=='string'||!Array.isArray(q.options)||q.options.length!==4||
            q.options.some(v=>!['string','number'].includes(typeof v)))throw Error(`${i+1}번째 퀴즈의 ${j+1}번 문제 또는 선택지 형식을 확인해 주세요.`);
        return {entry:[q.text,q.options.map(text),Number.isInteger(q.correct)?q.correct:-1,text(q.explanation)]};
      })};
    });
  }
  function backup(quiz){
    return {format:'churrri-quizrun',version:1,quizzes:[{title:quiz.title,questions:quiz.questions.map(([text,options,correct,explanation])=>({text,options,correct,explanation}))}]};
  }
  function shuffle(list,random){
    for(let i=list.length-1;i>0;i--){
      const j=Math.floor(random()*(i+1));
      [list[i],list[j]]=[list[j],list[i]];
    }
    return list;
  }
  function prepare(questions,settings,random=Math.random){
    const order=questions.slice();
    if(settings.questionOrder==='random')shuffle(order,random);
    const count=Math.max(1,Math.min(order.length,Math.trunc(Number(settings.questionCount))||order.length));
    return order.slice(0,count).map(([question,options,correct,explanation])=>{
      const indices=[0,1,2,3];
      if(settings.optionOrder==='random')shuffle(indices,random);
      return [question,indices.map(i=>options[i]),indices.indexOf(correct),explanation];
    });
  }
  return {max,headers,text,questionErrors,validate,fromExcel,decode,backup,prepare};
})();

const CharacterContact=((config)=>{
  function enabled(state,now,freePlayEnabled){
    return !state||state.phase==='idle'?freePlayEnabled:
      state.contact&&(state.phase==='drop'||state.phase==='move'&&now<state.until);
  }

  // Two bounded position passes handle crowds without storing impulses or changing vertical velocity.
  function resolve(bodies,dt,canStand){
    const limit=config.maxContactOffsetPerSecond*dt;
    const budget=bodies.map(body=>Math.max(0,limit-(body.pushUsed||0)));
    function displace(index,x,z,amount){
      const body=bodies[index].position;
      const step=Math.min(amount,budget[index]);
      if(step<=0||!canStand(body.x+x*step,body.z+z*step))return;
      body.x+=x*step;body.z+=z*step;budget[index]-=step;
    }
    for(let pass=0;pass<2;pass++){
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
        if(budget[i]+budget[j]<=0)continue;
        const a=bodies[i],b=bodies[j],p=a.position,q=b.position;
        if(Math.abs(p.y-q.y)>config.contactHeight)continue;
        const dx=q.x-p.x,dz=q.z-p.z,squared=dx*dx+dz*dz;
        if(squared>=config.contactDiameter**2)continue;
        const d=Math.sqrt(squared),angle=(i+1)*2.399+j;
        const nx=d>1e-7?dx/d:Math.cos(angle),nz=d>1e-7?dz/d:Math.sin(angle);
        const sprint=(a.sprinting&&a.dx*nx+a.dz*nz>.3?1:0)-(b.sprinting&&b.dx*nx+b.dz*nz<-.3?1:0);
        const overlap=config.contactDiameter-d;
        displace(i,-nx,-nz,overlap*(.48-sprint*.20));
        displace(j,nx,nz,overlap*(.48+sprint*.20));
      }
    }
  }
  return {enabled,resolve};
})(MovementConfig);

const ArenaEvent = ((rules)=>{
  const config=Object.freeze({
    probability:.90, warning:1000, survival:5000,
    restore:850, radius:.52, halfHeight:.104, barY:rules.top+.111,
    travelSpeed:7.6, turnSpeed:.50, crossingDelay:430, settleSpeed:3.8,
    rabbitRadius:.31, rabbitHeight:1.06,
    floodWarning:3000, floodRise:1800, floodPeak:.48,
  });
  const sweeps=['x','z','double'];
  const combinations=['sweep','spin','flood','sweep+spin','sweep+flood','spin+flood'];
  const names={x:'가로 왕복 스펀지바',z:'세로 왕복 스펀지바',double:'가로·세로 동시 스펀지바',spin:'회전 스펀지바',cross:'왕복 + 회전 스펀지바'};
  function settings(value={}){
    return {hazards:typeof value.hazards==='boolean'?value.hazards:
      value.difficulty!=='off'&&(!Array.isArray(value.obstacles)||value.obstacles.length>0)};
  }
  function label(event){
    const bar=names[event.kind==='sweep'?event.axis:event.kind];
    return event.flood?(bar?'물 차오름 · '+bar:'물 차오름'):bar;
  }
  function combination(event){
    if(!event)return null;
    if(event.kind==='cross')return 'sweep+spin';
    if(event.kind==='flood')return 'flood';
    return (event.kind==='spin'?'spin':'sweep')+(event.flood?'+flood':'');
  }
  function choose(round,options,now,random=Math.random,moveMs=Infinity){
    if(!round||!settings(options).hazards)return null;
    const previous=options.previousCombination;
    if(round>1&&previous!==null&&random()>=config.probability)return null;
    const floodFits=moveMs>=config.floodWarning+config.floodRise;
    const eligible=combinations.filter(key=>key!==previous&&(floodFits||!key.includes('flood')));
    const [first,second]=eligible[Math.floor(random()*eligible.length)].split('+');
    const start=now+config.warning;
    const direction=()=>random()<.5?-1:1;
    const flood={start:now+config.floodWarning,rise:config.floodRise,peak:config.floodPeak};
    if(first==='flood')return {kind:'flood',cue:now,start:flood.start,flood};
    const spin=()=>({kind:'spin',cue:now,start,direction:direction(),speed:config.turnSpeed});
    if(first==='spin')return {...spin(),...(second==='flood'?{flood}:{})};
    const pattern=sweeps[Math.floor(random()*sweeps.length)];
    const sweep=(axis,at)=>({kind:'sweep',axis,start:at,direction:direction(),speed:config.travelSpeed});
    const bars=pattern==='double'?[sweep('x',start),sweep('z',start+config.crossingDelay)]:[sweep(pattern,start)];
    if(second==='spin')return {kind:'cross',cue:now,start,bars:[...bars,spin()]};
    const event=bars.length===2?{kind:'double',start,bars}:bars[0];
    return {...event,cue:now,...(second==='flood'?{flood}:{})};
  }
  function pieces(event){
    return !event||event.kind==='flood'?[]:event.bars??[event];
  }
  function frames(event,now){
    return pieces(event).map(bar=>frame(bar,now)).filter(Boolean);
  }
  function frame(event,now){
    if(!event||event.kind==='flood'||now<event.start)return null;
    const {kind,axis,direction,speed}=event,t=(now-event.start)/1000;
    if(kind==='spin'){
      const angle=t*speed*direction;
      return {x:0,z:0,dx:Math.cos(angle),dz:Math.sin(angle),half:18.6,velocity:direction};
    }
    const extent=(axis==='x'?rules.deck.edgeX:rules.deck.edgeZ)*rules.scale;
    const travel=(t*speed)%(4*extent);
    const outward=travel<2*extent;
    const offset=(outward?travel-extent:3*extent-travel)*direction;
    return axis==='x'?{x:offset,z:0,dx:0,dz:1,half:rules.deck.edgeZ*rules.scale,velocity:(outward?1:-1)*direction}:
      {x:0,z:offset,dx:1,dz:0,half:rules.deck.edgeX*rules.scale,velocity:(outward?1:-1)*direction};
  }
  function ease(progress){
    const t=Math.max(0,Math.min(1,progress));
    return t*t*(3-2*t);
  }
  function display(event,now,exitAt){
    if(!event)return null;
    if(event.kind!=='spin')return exitAt==null?frame(event,now):null;
    if(now<(event.cue??event.start)||exitAt!=null&&now>=exitAt+config.restore)return null;
    const pose=frame(event,Math.max(event.start,exitAt??now));
    const y=exitAt!=null?-2.8*ease((now-exitAt)/config.restore):
      -2.8*(1-ease((now-(event.cue??event.start))/config.warning));
    return {...pose,y};
  }
  function live(phase){return phase==='drop';}
  function moving(phase){return ['question','move','drop','restore','between'].includes(phase);}
  function barActive(game,now) {
    return !!game?.event&&game.event.kind!=='flood'&&now>=game.event.start&&(game.phase==='move'||live(game.phase))&&
      (game.until==null||now<game.until);
  }
  function floodCountdown(game,now){
    if(game?.phase!=='move'||!game.event?.flood)return 0;
    const untilRise=game.event.flood.start-now;
    return untilRise>0&&untilRise<=config.floodWarning?Math.ceil(untilRise/1000):0;
  }
  function waterLevel(game,now){
    const flood=game?.event?.flood;
    if(!flood||!['move','drop','restore'].includes(game.phase))return rules.deck.water;
    const peak=rules.deck.water+(flood.peak-rules.deck.water)*ease(((game.phase==='move'?now:game.dropAt??now)-flood.start)/flood.rise);
    const blend=game.phase==='restore'?1-ease((now-game.restoreAt)/config.restore):1;
    return rules.deck.water+(peak-rules.deck.water)*blend;
  }
  function waterPhysics(game,level){
    return live(game?.phase)||game?.phase==='restore'||game?.phase==='move'&&level>=0;
  }
  function waterSpawn(point,slot=0){
    const nearest=rules.pads.reduce((best,[x,z])=>Math.hypot(x-point.x,z-point.z)<Math.hypot(best[0]-point.x,best[1]-point.z)?[x,z]:best);
    return {x:nearest[0]+(slot%6-2.5)*1.08,z:nearest[1]+(Math.floor(slot/6)-2)*1.08,y:rules.top,standing:true,vy:0,onBar:false};
  }
  function floor(game,now,correct,water=waterLevel(game,now)){
    if(game?.phase!=='drop'&&game?.phase!=='restore'){
      if(water<0)return rules.surface;
      return (x,z)=>{
        const height=rules.surface(x,z);
        return height>water?height:-Infinity;
      };
    }
    const depth=game.phase==='drop'?Infinity:rules.rise((now-game.restoreAt)/1000);
    const safe={center:false,links:false,pads:kindsForPad(correct)};
    return (x,z)=>{
      const raised=rules.surface(x,z,safe);
      const lowered=rules.surface(x,z)-depth;
      const height=Math.max(raised,lowered);
      return height>water?height:-Infinity;
    };
  }
  function kindsForPad(correct){return rules.pads.map((_,index)=>index===correct);}
  const clearance=config.radius+config.rabbitRadius+.012;
  const barTop=config.barY+config.halfHeight;
  function relative(p,bar){
    const x=p.x-bar.x,z=p.z-bar.z;
    const u=x*bar.dx+z*bar.dz,v=z*bar.dx-x*bar.dz;
    const end=Math.max(-bar.half,Math.min(bar.half,u));
    return {u,v,end,d:Math.hypot(u-end,v)};
  }
  function support(bars,point,floor){
    return (x,z)=>{
      const ground=floor(x,z);
      if(!bars?.length||!point.onBar||!bars.some(bar=>relative({x,z},bar).d<=clearance))return ground;
      return Math.max(ground,barTop);
    };
  }
  function contact(previous,next,oldBar,bar,dt,onHit){
    if(!bar){
      next.onBar=false;
      return;
    }
    const a=relative(previous,oldBar||bar),b=relative(next,bar);
    // A descending rabbit can rest on the bar. Below its top, capsule sides
    // remain solid throughout the jump and while the bar is moving.
    if(b.d<=clearance&&previous.y>=barTop-.006&&next.y<=barTop&&next.y<=previous.y){
      next.y=barTop;next.onBar=true;next.standing=true;next.vy=0;
      return;
    }
    next.onBar=b.d<=clearance&&Math.abs(next.y-barTop)<.006&&next.onBar;
    if(next.y>=barTop||next.y+config.rabbitHeight<=config.barY-config.halfHeight||b.d>=clearance)return;
    let u=b.u,v=b.v;
    const side=Math.sign(a.v)||Math.sign(b.v)||1;
    const beyond=b.u-b.end;
    if(a.u>=-bar.half&&a.u<=bar.half||Math.abs(beyond)<.0001||a.v*b.v<0){
      v=side*Math.sqrt(Math.max(0,clearance**2-beyond**2));
    }else if(b.d>.0001){
      u=b.end+beyond*clearance/b.d;
      v=b.v*clearance/b.d;
    }else{
      v=side*clearance;
    }
    // A rabbit already inside when solids are enabled can leave smoothly.
    // Normal contact cancels inward input and carries the rabbit with the bar.
    if(a.d<clearance-.025){
      const motion=Math.hypot(bar.x-(oldBar||bar).x,bar.z-(oldBar||bar).z)+
        Math.abs(a.u)*Math.abs(bar.dx*(oldBar||bar).dz-bar.dz*(oldBar||bar).dx);
      const limit=Math.max(Math.abs(v-b.v)-clearance,0)+motion+config.settleSpeed*dt;
      const start=(oldBar||bar)===bar?a.v:relative(previous,bar).v;
      if(Math.sign(v-start)===side&&Math.abs(v-start)>limit)v=start+side*limit;
      if(side*(b.v-start)<0&&side*(v-start)<0)v=start;
    }
    if(onHit){
      const movement=oldBar?((bar.x-oldBar.x)*-bar.dz+(bar.z-oldBar.z)*bar.dx+
        a.u*(bar.dz*oldBar.dx-bar.dx*oldBar.dz))/dt:0;
      onHit({x:-bar.dz*side,z:bar.dx*side,speed:Math.max(0,movement*side)});
    }
    const x=bar.x+bar.dx*u-bar.dz*v,z=bar.z+bar.dz*u+bar.dx*v;
    if(a.d<clearance-.025){
      const delta=Math.hypot(x-previous.x,z-previous.z);
      const intended=Math.hypot(next.x-previous.x,next.z-previous.z);
      const travel=Math.hypot(bar.x-(oldBar||bar).x,bar.z-(oldBar||bar).z)+
        Math.abs(a.u)*Math.abs(bar.dx*(oldBar||bar).dz-bar.dz*(oldBar||bar).dx);
      const fraction=Math.min(1,(intended+travel+config.settleSpeed*dt)/Math.max(delta,.001));
      next.x=previous.x+(x-previous.x)*fraction;
      next.z=previous.z+(z-previous.z)*fraction;
    }else{
      next.x=x;next.z=z;
    }
  }
  function resolve(previous,point,event,from,to,enabled,onHit){
    if(!enabled){point.onBar=false;return 0;}
    const active=pieces(event).filter(bar=>to>=bar.start);
    if(!active.length){point.onBar=false;return 0;}
    const span=Math.max(0,(to-from)/1000);
    const speed=Math.max(...active.map(bar=>bar.kind==='spin'?bar.speed*18.6:bar.speed));
    const distance=Math.hypot(point.x-previous.x,point.z-previous.z);
    const steps=Math.max(1,Math.ceil((distance+speed*span)/.15));
    const startX=point.x,startZ=point.z;
    const dx=(point.x-previous.x)/steps,dz=(point.z-previous.z)/steps,dy=(point.y-previous.y)/steps;
    let actual={...previous};
    let older=active.map(bar=>frame(bar,from));
    for(let i=1;i<=steps;i++){
      const time=from+(to-from)*i/steps;
      const target={...point,x:actual.x+dx,z:actual.z+dz,y:actual.onBar&&dy<=0?barTop:previous.y+dy*i,onBar:actual.onBar};
      const next=active.map(bar=>frame(bar,time));
      const lifted=target.onBar;
      let onBar=false;
      for(const [j,bar] of next.entries()){
        if(!bar)continue;
        target.onBar=lifted||onBar;
        contact(actual,target,older[j],bar,Math.max(span/steps,1/120),onHit);
        onBar||=target.onBar;
      }
      target.onBar=onBar;
      // Bound the combined horizontal correction where several bars cross.
      if(next.length>1){
        const dt=span/steps;
        const limit=Math.hypot(dx,dz)+Math.SQRT2*(speed*dt+config.settleSpeed*Math.max(dt,1/120));
        const step=Math.hypot(target.x-actual.x,target.z-actual.z);
        if(step>limit){
          target.x=actual.x+(target.x-actual.x)*limit/step;
          target.z=actual.z+(target.z-actual.z)*limit/step;
        }
      }
      actual=target;
      older=next;
    }
    Object.assign(point,actual);
    return Math.hypot(point.x-startX,point.z-startZ);
  }
  function overlapSpace(x,z){
    return Math.abs(x)<=rules.deck.edgeX*rules.scale+2.3&&Math.abs(z)<=rules.deck.edgeZ*rules.scale+2.3;
  }
  return {config,settings,choose,combination,label,pieces,frame,frames,display,live,moving,barActive,floodCountdown,waterLevel,waterPhysics,waterSpawn,floor,resolve,support,barTop,overlapSpace};
})(Rules);

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

export {Motion,Rules,QuizData,MovementConfig,CharacterContact,ArenaEvent,Impact};
