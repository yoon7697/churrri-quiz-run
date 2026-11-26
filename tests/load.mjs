import {readdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {runtime} from './runtime.mjs';
import {ArenaEvent,Motion,Rules} from '../server/arena-motion.mjs';

const useObstacles=process.env.QUIZRUN_LOAD_OBSTACLES!=='0';
const useContact=process.env.QUIZRUN_LOAD_CONTACT!=='0';
function workerUsage(){
  try{
    for(const pid of readdirSync('/proc').filter(value=>/^\d+$/.test(value))){
      let status;
      try{status=readFileSync('/proc/'+pid+'/status','utf8');}catch{continue;}
      if(Number(/^PPid:\s+(\d+)/m.exec(status)?.[1])!==process.pid)continue;
      if(!readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0')[0].includes('workerd'))continue;
      const rss=Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]);
      const peak=Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1]);
      return {rssKiB:rss,peakKiB:peak};
    }
  }catch {}
  return null;
}
const duration=Number(process.env.QUIZRUN_LOAD_SECONDS||600);
const mf=runtime(), sockets=[];
const origin=(await mf.ready).origin;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function post(path,data={},token){
  const headers={Origin:origin,'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  total.requests++;
  const response=await mf.dispatchFetch(origin+'/api/quizrun/'+path,{method:'POST',headers,body:JSON.stringify(data)});
  assert.ok(response.ok, path+': '+response.status);
  return await response.json();
}
const total={requests:0,upgrades:0,input:0,output:0,bytes:0,questions:0,moves:0,contactBatches:0,contactRows:0,peakOnPad:0,pushes:0,pushHits:0,barHits:0,jumps:0,reconnects:0};
let teacherState=null,serverFrames=0;
const rtt=[],events=new Set();
async function open(session){
  const base='rooms/'+session.code;
  const {ticket}=await post(base+'/ticket',{},session.token);
  total.upgrades++;
  const response=await mf.dispatchFetch(origin+'/api/quizrun/'+base+'/socket?ticket='+ticket,
    {headers:{Origin:origin,Upgrade:'websocket'}});
  assert.equal(response.status,101);
  const socket=response.webSocket;
  const actor={socket,pose:null,start:null,epoch:null,status:null,slot:null};
  const ready=new Promise(resolve=>{
    socket.addEventListener('message',event=>{
      if(event.data==='pong'){
        if(actor.pingAt!=null){rtt.push(performance.now()-actor.pingAt);actor.pingAt=null;}
        return;
      }
      const message=JSON.parse(event.data);
      if(message.type==='room'){
        const self=message.students.find(student=>student.id===session.id);
        if(self)actor.slot=self.slot;
        if(session.role==='teacher')serverFrames=message.students.filter(s=>s.online).length;
        else if(actor.slot!==null)resolve();
      }else if(message.type==='game'){
        if(session.role==='teacher'){
          if(message.state?.phase==='question'&&teacherState?.phase!=='question')total.questions++;
          if(message.state?.phase==='move'&&teacherState?.phase!=='move')total.moves++;
          teacherState=message.state;
        }
        actor.status=message.state;
        if(session.role==='teacher'&&message.state?.event)events.add(ArenaEvent.combination(message.state.event));
        if(message.pose){actor.start=message.pose.slice();actor.ox=0;actor.oz=0;}
      }else if(message.type==='motion-ready'){
        actor.readyPose=message.own;
      }else if(message.type==='impact'&&actor.slot===0){
        if(message.kind==='bar')total.barHits++;
        else if(message.slot!=null)total.pushHits++;
      }else if(message.type==='poses'){
        total.output++;
        total.bytes+=Buffer.byteLength(event.data);
        if(actor.slot===0){
          const rows=message.poses.filter(row=>row.length>6);
          if(rows.length)total.contactBatches++;
          total.contactRows+=rows.length;
          total.jumps+=message.poses.filter(row=>row[5]===7).length;
        }
        const row=message.poses.find(p=>p[0]===actor.slot);
        if(row){actor.ox=row[6]||0;actor.oz=row[7]||0;actor.where=Rules.answerPad(Motion.position(row.slice(1,6)));}

      }
    });
  });
  socket.accept();
  sockets.push(socket);
  if(session.role==='student')await ready;
  return actor;
}

try{
  const teacher=await post('rooms');
  const base='rooms/'+teacher.code;
  await open(teacher);
  const students=await Promise.all(Array.from({length:30},(_,i)=>post(base+'/join',{name:'부하 '+i,color:i%4})));
  const actors=await Promise.all(students.map(open));
  for(let i=0;i<50 && serverFrames!==30;i++)await sleep(100);
  assert.equal(serverFrames,30);
  await post(base+'/start-game',{title:'30명 연결 부하 검증',
    settings:{questionCount:12,reveal:1,move:duration<300?15:55,lives:'Infinity',pace:'auto',contact:useContact,push:true,hazards:useObstacles,questionOrder:'ordered',optionOrder:'ordered'},
    questions:Array.from({length:12},(_,i)=>['부하 시험 '+i,['첫 번째','두 번째','세 번째','네 번째'],i%4,'해설'])},teacher.token);
  const startingMemory=workerUsage();
  console.log((useContact?'ON':'OFF')+' · 30 connections established; '+duration+'s real-time test started');
  const start=performance.now();
  let counter=0,nextReport=60;
  for(let elapsed=0;elapsed<duration;elapsed=(performance.now()-start)/1000){
    if(elapsed>=nextReport){console.log(JSON.stringify({seconds:nextReport,...total,connections:serverFrames}));nextReport+=60;}
    counter++;
    if(counter%50===0)for(const actor of actors){
      actor.pingAt=performance.now();actor.socket.send('ping');
    }
    if(!total.reconnects&&elapsed>=duration*.45){
      const old=actors[29];
      old.socket.close(1000,'load reconnect');
      const resumed=await open(students[29]);
      for(let i=0;i<50&&(!resumed.readyPose||!resumed.status);i++)await sleep(20);
      assert.equal(resumed.slot,old.slot);
      assert.equal(resumed.status?.id,old.status?.id);
      assert.equal(resumed.status?.players.find(p=>p.slot===old.slot).hp,old.status?.players.find(p=>p.slot===old.slot).hp);
      assert.equal(resumed.readyPose.length,5);
      actors[29]=resumed;
      total.reconnects++;
    }
    total.peakOnPad=Math.max(total.peakOnPad,actors.filter(a=>a.where===0).length);
    for(const actor of actors){
      const state=actor.status;
      if(!ArenaEvent.moving(state?.phase)||state.until!==null&&Date.now()>=state.until||state.players.some(p=>p.slot===actor.slot&&(p.hp===0||p.fallenAt!==null)))continue;
      const p=actor.start||Motion.roundSpawn(actor.slot);
      const goalX=-870+(actor.slot%6)*48+Math.round(50*Math.sin(counter/7));
      const goalZ=-1040+Math.floor(actor.slot/6)*54+Math.round(45*Math.cos(counter/8));
      const dx=goalX-p[0]-(actor.ox||0),dz=goalZ-p[2]-(actor.oz||0);
      const step=Math.min(1,48/Math.max(1,Math.hypot(dx,dz)));
      p[0]+=Math.round(dx*step);p[2]+=Math.round(dz*step);
      let y=Math.round(Rules.surface((p[0]+(actor.ox||0))/100,(p[2]+(actor.oz||0))/100)*100);
      if(!Number.isFinite(y))continue;
      let flags=actor.slot%2?3:1;
      const hop=(counter+actor.slot)%38;
      if(actor.slot%3===1&&state.phase==='move'&&hop<7){
        y+=[58,104,135,151,146,126,85][hop];flags=7;
      }
      actor.socket.send(JSON.stringify([state.roundKey,p[0],y,p[2],Math.round(Math.atan2(dx,dz)*100),flags]));
      if(state.phase==='move'&&(counter+actor.slot)%32===0){
        actor.socket.send(JSON.stringify([state.roundKey,'push']));
        total.pushes++;
      }
      total.input++;
    }
    await sleep(Math.max(0,100*counter-(performance.now()-start)));
  }
  assert.equal(serverFrames,30);
  assert.ok(total.moves>0&&total.input>0&&total.output>0);
  if(useContact&&duration>=20)assert.ok(total.contactBatches>0&&total.peakOnPad===30);
  if(duration===600) assert.ok(total.questions>=9&&total.input>140_000);
  assert.equal(total.reconnects,1);
  assert.ok(rtt.length>=30&&total.jumps>0&&total.pushHits>0);
  if(useObstacles&&duration>=50)assert.ok(events.size>0);
  const phase=teacherState.phase;
  rtt.sort((a,b)=>a-b);
  const rttMs={samples:rtt.length,p50:Number(rtt[Math.floor(rtt.length*.5)].toFixed(2)),p95:Number(rtt[Math.floor(rtt.length*.95)].toFixed(2))};
  const finalMemory=workerUsage();
  await post(base+'/close',{},teacher.token);
  console.log(JSON.stringify({seconds:duration,...total,connections:serverFrames,phase,contact:useContact,events:[...events],rttMs,startingMemory,finalMemory}));
}finally{
  for(const socket of sockets){try{socket.close();}catch{}}
  await mf.dispose();
}
