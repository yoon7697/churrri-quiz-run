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
})(typeof module==='undefined'?Rules:require('./rules.js'));
if(typeof module!=='undefined')module.exports=ArenaEvent;
