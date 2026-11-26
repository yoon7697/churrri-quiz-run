import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createRequire} from 'node:module';
const rules=createRequire(import.meta.url)('../rules.js');
import {runtime} from './runtime.mjs';

const mf = runtime({ratelimits:{
  ROOM_CREATES:{namespace_id:'411831',simple:{limit:12,period:60}},
  ROOM_REQUESTS:{namespace_id:'411832',simple:{limit:500,period:60}},
}});
const origin = (await mf.ready).origin;
const sockets = new Set();
after(async () => {
  for (const socket of sockets) { try { socket.close(); } catch {} }
  await mf.dispose();
});

async function post(path, data = {}, token, requestOrigin = origin) {
  const headers = {Origin: requestOrigin, 'Content-Type': 'application/json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await mf.dispatchFetch(origin + '/api/quizrun/' + path, {
    method: 'POST', headers, body: JSON.stringify(data),
  });
  return {status:response.status, body:await response.json(), cors:response.headers.get('Access-Control-Allow-Origin')};
}

async function open(session) {
  const {body} = await post(`rooms/${session.code}/ticket`, {}, session.token);
  assert.ok(body.ticket);
  const path = `/api/quizrun/rooms/${session.code}/socket?ticket=${body.ticket}`;
  const response = await mf.dispatchFetch(origin + path, {headers:{Origin:origin, Upgrade:'websocket'}});
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  const messages = [];
  socket.addEventListener('message', event => messages.push(event.data === 'pong' ? 'pong' : JSON.parse(event.data)));
  socket.accept();
  sockets.add(socket);
  return {socket,messages,path};
}

async function until(connection, predicate) {
  for (let i=0; i<340; i++) {
    const seen = connection.messages.findLast(predicate);
    if (seen) return seen;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Expected WebSocket event did not arrive');
}
const snapshot = (connection, condition) => until(connection, message => message.type === 'room' && condition(message));

test('creates distinct codes, restricts browser origin, and rejects missing codes', async () => {
  const [first, second] = await Promise.all([post('rooms'),post('rooms')]);
  assert.equal(first.status, 201);
  assert.match(first.body.code, /^[1-9]\d{3}$/);
  assert.notEqual(first.body.code, second.body.code);
  assert.equal((await post('rooms',{},undefined,'https://wrong.example')).status, 403);
  const cross = await post('rooms',{},undefined,'https://quizrun.example.test');
  assert.equal(cross.status, 201);
  assert.equal(cross.cors,'https://quizrun.example.test');
  const front='https://quizrun.example.test';
  const preflight=await mf.dispatchFetch(origin+'/api/quizrun/rooms/'+cross.body.code+'/ticket',{
    method:'OPTIONS',
    headers:{Origin:front,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},
  });
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),front);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Authorization/i);
  const {body:{ticket}}=await post('rooms/'+cross.body.code+'/ticket',{},cross.body.token,front);
  const socketUrl=origin+'/api/quizrun/rooms/'+cross.body.code+'/socket?ticket='+ticket;
  const blocked=await mf.dispatchFetch(socketUrl,{headers:{Origin:'https://wrong.example',Upgrade:'websocket'}});
  assert.equal(blocked.status,403);
  const allowed=await mf.dispatchFetch(socketUrl,{headers:{Origin:front,Upgrade:'websocket'}});
  assert.equal(allowed.status,101);
  allowed.webSocket.accept();
  allowed.webSocket.close(1000);

  assert.equal((await post('rooms/123/join')).body.error, 'code');
  const missing = ['9999','9998','9997','9996'].find(code => ![first.body.code,second.body.code,cross.body.code].includes(code));
  assert.equal((await post(`rooms/${missing}/join`, {name:'학생',color:0})).body.error, 'missing');
  for (const {body} of [first,second,cross]) await post(`rooms/${body.code}/close`, {}, body.token);
});

test('role enforcement, roster sync, reconnect, duplicate replacement, kick, leave and close', async () => {
  const {body:teacher} = await post('rooms');
  const path = `rooms/${teacher.code}`;
  const host = await open(teacher);
  await snapshot(host, room => room.teacherOnline && room.students.length === 0);
  const {body:one} = await post(path+'/join',{name:'학생 하나',color:1});
  assert.equal((await post(path+'/join',{name:'학생  하나',color:2})).body.error,'name-taken');
  const {body:two} = await post(path+'/join',{name:'학생 둘',color:2});
  assert.equal((await post(path+'/rename',{id:two.id,name:'학생 하나'},teacher.token)).body.error,'name-taken');
  const student = await open(one), other = await open(two);
  for (const connection of [host,student,other]) {
    const room = await snapshot(connection, value => value.students.filter(p=>p.online).length === 2);
    assert.ok(room.students.every(p=>!('tokenHash' in p)));
  }
  student.socket.send('ping');
  await until(student,m=>m==='pong');
  assert.equal((await post(path+'/close',{},one.token)).status,403);
  assert.equal((await post(path+'/kick',{id:two.id},one.token)).status,403);
  assert.equal((await post(path+'/rename',{id:one.id,name:'입력'},one.token)).status,403);
  assert.equal((await post(path+'/rename',{id:one.id,name:'별 토끼'},teacher.token)).status,200);
  await snapshot(other, room=>room.students.some(p=>p.name==='별 토끼'));
  const replaced = await open(one);
  await until(student,m=>m.type==='replaced');
  await snapshot(replaced, room=>room.students.length===2 && room.students.every(p=>p.online));
  const reused = await mf.dispatchFetch(origin + replaced.path,{headers:{Origin:origin,Upgrade:'websocket'}});
  assert.equal(reused.status,403);
  host.messages.length=0;
  replaced.socket.close(1000,'network test');
  await snapshot(host,room=>room.students.some(p=>p.id===one.id && !p.online));
  const resumed = await open(one);
  await snapshot(resumed,room=>room.students.length===2 && room.students.every(p=>p.online));
  assert.equal((await post(path+'/kick',{id:one.id},teacher.token)).status,200);
  await until(resumed,m=>m.type==='kicked');
  assert.equal((await post(path+'/ticket',{},one.token)).status,403);
  await snapshot(other,room=>room.students.length===1);
  assert.equal((await post(path+'/leave',{},two.token)).status,200);
  await until(other,m=>m.type==='left');
  await snapshot(host,room=>room.students.length===0);
  assert.equal((await post(path+'/close',{},teacher.token)).status,200);
  await until(host,m=>m.type==='closed');
  assert.equal((await post(path+'/join',{name:'재입장',color:0})).status,410);
});

test('30 concurrent student admissions have one extra rejected and free a slot after leave', async () => {
  const {body:teacher} = await post('rooms');
  const path = `rooms/${teacher.code}`;
  const host = await open(teacher);
  const sessions = await Promise.all(Array.from({length:31},(_,index)=>post(path+'/join',{name:'토끼 '+index,color:index%4})));
  assert.equal(sessions.filter(s=>s.status===201).length,30);
  assert.equal(sessions.filter(s=>s.status===409 && s.body.error==='full').length,1);
  const admitted = sessions.filter(s=>s.status===201);
  const connections = await Promise.all(admitted.map(s=>open(s.body)));
  await snapshot(host,room=>room.students.length===30 && room.students.every(p=>p.online));
  await Promise.all(connections.map(connection=>snapshot(connection,room=>room.students.every(p=>p.online)&&room.students.length===30)));
  const student = admitted[0].body;
  assert.equal((await post(path+'/leave',{},student.token)).status,200);
  assert.equal((await post(path+'/join',{name:'새 토끼',color:0})).status,201);
  await post(path+'/close',{},teacher.token);
});

test('30 students send 10 Hz poses; batches preserve sprint/jump and reconnect state', {timeout:15_000}, async t => {
  const {body:teacher} = await post('rooms');
  const path = `rooms/${teacher.code}`;
  const host = await open(teacher);
  const sessions = await Promise.all(Array.from({length:30},(_,i)=>post(path+'/join',{name:'운동 '+i,color:i%4})));
  assert.ok(sessions.every(entry=>entry.status===201));
  const peers = await Promise.all(sessions.map(entry=>open(entry.body)));
  const ready = await Promise.all(peers.map(peer=>until(peer,m=>m.type==='motion-ready')));
  const room = await snapshot(host,room=>room.students.length===30 && room.students.every(p=>p.online));
  const slots = sessions.map(entry=>room.students.find(p=>p.id===entry.body.id).slot);
  assert.equal(new Set(slots).size,30);
  assert.ok(ready.every(message=>message.own.length===5));

  const movement = ready.map(message=>message.own.slice());
  const stop = ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let sent = 0;
  for (let tick=0;tick<40;tick++) {
    await stop(100);
    peers.forEach((peer,i)=>{
      const pose = movement[i];
      pose[0] += tick%2 ? -32 : 32;
      pose[3] = tick%2 ? -157 : 157;
      pose[4] = i%2 ? 3 : 1;
      pose[1] = Math.round(rules.surface(pose[0]/100,pose[2]/100)*100);
      if (i===1 && tick<6) {
        pose[4] = 7;
        pose[1] += [55,95,118,118,94,46][tick];
      }
      peer.socket.send(JSON.stringify(pose));
      sent++;
    });
  }
  await stop(170);
  assert.equal(sent,1200);
  const counts=[];
  for (const peer of peers) {
    const batches = peer.messages.filter(message=>message.type==='poses');
    counts.push(batches.length);
    assert.ok(batches.length>=20 && batches.length<60,`unexpected batch count: ${batches.length}`);
    const rows = batches.flatMap(message=>message.poses);
    assert.equal(new Set(rows.map(row=>row[0])).size,30);
    assert.ok(rows.some(row=>row[0]===slots[1] && row[5]===7 && row[2]>ready[1].own[1]));
    assert.ok(rows.some(row=>row[0]===slots[1] && row[5]===3));
    assert.ok(rows.some(row=>row[0]===slots[2] && row[5]===1 && row[4]===-157));
  }
  t.diagnostic(`30 student sockets, ${sent} incoming frames, ${Math.min(...counts)}–${Math.max(...counts)} outgoing batches per client`);
  assert.equal(host.messages.some(message=>message.type==='poses'),false);

  const watcher = peers[0], target = peers[1];
  watcher.messages.length = 0;
  target.socket.send(JSON.stringify([999999,999999,999999,0,7]));
  target.socket.send(JSON.stringify([movement[1][0]+1300,movement[1][1],movement[1][2],0,3]));
  await stop(200);
  assert.equal(watcher.messages.some(message=>message.type==='poses'),false,'invalid poses were broadcast');
  target.socket.close(1000,'test reconnect');
  await snapshot(watcher,room=>room.students.some(entry=>entry.slot===slots[1]&&!entry.online));
  const resumed = await open(sessions[1].body);
  const again = await until(resumed,message=>message.type==='motion-ready');
  assert.equal(again.own[0],movement[1][0]);
  assert.equal(again.own[2],movement[1][2]);
  assert.equal(again.own[4],0);
  assert.equal(again.poses.length,30);
  assert.equal(new Set(again.poses.map(row=>row[0])).size,30);
  await post(path+'/close',{},teacher.token);
  await until(resumed,message=>message.type==='closed');
});

test('online survival: private answers, authoritative deadline, airborne result, lives, rejoin and manual restart', {timeout:40000}, async () => {
  const {body:teacher}=await post('rooms');
  const path='rooms/'+teacher.code;
  const host=await open(teacher);
  const entries=await Promise.all(['보라','민트','노랑'].map((name,color)=>post(path+'/join',{name,color})));
  const [one,two,three]=await Promise.all(entries.map(entry=>open(entry.body)));
  const roster=await snapshot(host,m=>m.students.every(p=>p.online)&&m.students.length===3);
  const slots=entries.map(entry=>roster.students.find(p=>p.id===entry.body.id).slot);
  const settings={questionCount:2,reveal:1,move:3,lives:3,pace:'manual',questionOrder:'ordered',optionOrder:'ordered'};
  const data={title:'서버 검증',settings,questions:[['첫 문제',['1','2','3','4'],0,'첫 해설'],['둘째 문제',['가','나','다','라'],3,'둘째 해설']]};
  const phase=(connection,expected,round=0)=>until(connection,m=>m.type==='game'&&m.state?.phase===expected&&m.state.round===round);
  assert.equal((await post(path+'/start-game',data,entries[0].body.token)).status,403);
  assert.equal((await post(path+'/start-game',data,teacher.token)).status,200);
  const first=await Promise.all([host,one,two,three].map(s=>phase(s,'countdown')));
  assert.ok(first.every(m=>m.state.until===first[0].state.until));
  assert.equal((await post(path+'/join',{name:'늦게 옴',color:0})).body.error,'started');

  const [staff,q1,q2]=await Promise.all([host,one,two].map(s=>phase(s,'question')));
  assert.equal(staff.state.entry[2],0);
  assert.deepEqual(q1.state.entry,['첫 문제',['1','2','3','4']]);
  assert.deepEqual(q1.state.entry,q2.state.entry);
  const [m1,m2]=await Promise.all([one,two].map(s=>phase(s,'move')));
  assert.equal(m1.state.until,m2.state.until);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const start=[first[1].pose,first[2].pose];
  const latest=[];
  for(let tick=1;tick<=12;tick++) {
    await wait(100);
    [one,two].forEach((connection,i)=>{
      const x=Math.round(start[i][0]+(-520-start[i][0])*tick/12);
      const z=Math.round(start[i][2]+(-510-start[i][2])*tick/12);
      const pose=[x,Math.round(rules.surface(x/100,z/100)*100),z,-210,3];
      latest[i]=pose;
      connection.socket.send(JSON.stringify([m1.state.roundKey,...pose]));
    });
  }
  await wait(Math.max(0,m1.state.until-Date.now()-370));
  for (const height of [36,84,118]) {
    one.socket.send(JSON.stringify([m1.state.roundKey,latest[0][0],latest[0][1]+height,latest[0][2],-210,4]));
    await wait(100);
  }
  const show=await phase(one,'drop');
  assert.equal(show.state.entry[2],0);
  assert.equal(show.state.dropAt,m1.state.until);
  assert.equal(show.state.revealAt,show.state.dropAt);
  assert.equal(show.state.answers.find(a=>a.slot===slots[0]).correct,true);
  assert.equal(show.state.answers.find(a=>a.slot===slots[1]).correct,true);
  assert.equal(show.state.answers.find(a=>a.slot===slots[2]).choice,-1);
  three.socket.send(JSON.stringify([m1.state.roundKey,...latest[0]]));
  const dropped=await phase(three,'drop');
  assert.deepEqual(dropped.state.answers,show.state.answers);
  assert.equal(dropped.state.players.find(p=>p.slot===slots[2]).hp,2);
  assert.equal((await post(path+'/next-round',{},teacher.token)).body.error,'phase');
  three.socket.close(1000);
  await snapshot(host,m=>m.students.some(p=>p.slot===slots[2]&&!p.online));
  const rejoin=await open(entries[2].body);
  const restored=await phase(rejoin,'drop');
  assert.equal(restored.state.players.find(p=>p.slot===slots[2]).hp,2);
  assert.equal(restored.state.until,dropped.state.until);
  assert.equal(restored.state.roundKey,dropped.state.roundKey);
  for(let i=1;i<=13;i++){
    two.socket.send(JSON.stringify([m2.state.roundKey,latest[1][0]+33*i,102,latest[1][2],157,3]));
    await wait(100);
  }
  const fall=await until(two,m=>m.type==='game'&&m.state?.phase==='drop'&&m.state.players.some(p=>p.slot===slots[1]&&p.fallenAt!==null));
  assert.equal(fall.state.players.find(p=>p.slot===slots[1]).hp,2);
  assert.equal(fall.state.answers.find(a=>a.slot===slots[1]).correct,true);
  const [stayed,returned]=await Promise.all([phase(one,'between'),phase(two,'between')]);
  assert.equal(stayed.reset,false);
  assert.equal(returned.reset,true);
  assert.ok(rules.answerPad({x:returned.pose[0]/100,z:returned.pose[2]/100})<0);
  assert.equal((await post(path+'/next-round',{},teacher.token)).status,200);
  const round2=await phase(rejoin,'question',1);
  assert.notEqual(round2.state.roundKey,dropped.state.roundKey);
  assert.equal(round2.state.entry.length,2);
  await phase(one,'move',1);
  assert.equal((await post(path+'/end-game',{},teacher.token)).status,200);
  const result=await phase(two,'end',1);
  assert.equal(result.state.reason,'stopped');
  assert.equal((await post(path+'/return-lobby',{},teacher.token)).status,200);
  await until(rejoin,m=>m.type==='game'&&m.reset&&m.state===null);
  assert.equal((await post(path+'/start-game',{...data,settings:{...settings,pace:'auto',lives:5}},teacher.token)).status,200);
  const restarted=await phase(one,'countdown');
  assert.notEqual(restarted.state.id,show.state.id);
  assert.ok(restarted.state.players.every(player=>player.hp===5));
  await post(path+'/close',{},teacher.token);
});

test('WebSocket collision updates both students and continues applying offsets just before judging', {timeout:25000},async()=>{
  const {body:teacher}=await post('rooms');
  const path='rooms/'+teacher.code, host=await open(teacher);
  try{
    const [a,b]=await Promise.all([post(path+'/join',{name:'충돌 가',color:0}),post(path+'/join',{name:'충돌 나',color:1})]);
    const [first,second]=await Promise.all([open(a.body),open(b.body)]);
    const roster=await snapshot(host,m=>m.students.length===2&&m.students.every(p=>p.online));
    const mySlot=roster.students.find(s=>s.id===a.body.id).slot;
    const otherSlot=roster.students.find(s=>s.id===b.body.id).slot;
    const config={title:'접촉',settings:{questionCount:1,reveal:1,move:6,lives:3,contact:true,pace:'auto',questionOrder:'ordered',optionOrder:'ordered'},
      questions:[['문제',['가','나','다','라'],0,'설명']]};
    assert.equal((await post(path+'/start-game',config,teacher.token)).status,200);
    const startA=await until(first,m=>m.type==='game'&&m.state?.phase==='countdown');
    const startB=await until(second,m=>m.type==='game'&&m.state?.phase==='countdown');
    const begin=await until(first,m=>m.type==='game'&&m.state?.phase==='move');
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const [x,,z]=startB.pose;
    for(let tick=1;tick<=3;tick++){
      await wait(110);
      const px=Math.round(startA.pose[0]+(x-startA.pose[0])*tick/3);
      const pz=Math.round(startA.pose[2]+(z-startA.pose[2])*tick/3);
      first.socket.send(JSON.stringify([begin.state.roundKey,px,Math.round(rules.surface(px/100,pz/100)*100),pz,157,3]));
    }
    const pushed=await until(second,m=>m.type==='poses'&&m.poses.some(p=>p[0]===otherSlot&&p.length===8));
    assert.ok(pushed.poses.some(p=>p[0]===mySlot&&p.length===8));
    await wait(Math.max(0,begin.state.until-Date.now()-1850));
    const rows=second.messages.filter(m=>m.type==='poses').flatMap(m=>m.poses);
    const firstRow=rows.findLast(row=>row[0]===mySlot);
    const secondRow=rows.findLast(row=>row[0]===otherSlot);
    const px=firstRow[1]-(secondRow[6]||0),pz=firstRow[3]-(secondRow[7]||0);
    const index=second.messages.length;
    second.socket.send(JSON.stringify([begin.state.roundKey,px,Math.round(rules.surface(px/100,pz/100)*100),pz,-157,1]));
    await until(second,m=>second.messages.indexOf(m)>=index&&m.type==='poses'&&m.poses.some(row=>
      row[0]===otherSlot&&(row[6]!==secondRow[6]||row[7]!==secondRow[7])));
    await until(first,m=>m.type==='game'&&m.state?.phase==='drop');
  }finally{await post(path+'/close',{},teacher.token);}
});

test('joint winners share one ceremony clock across reconnect, then replay or return to the same lobby', {timeout:28000},async()=>{
  const {body:teacher}=await post('rooms');
  const path='rooms/'+teacher.code,host=await open(teacher);
  try{
    const sessions=[];
    for(const [name,color] of [['민트 토끼',2],['노랑 토끼',3]]){
      const entry=await post(path+'/join',{name,color});
      sessions.push(entry.body);
    }
    const [first,other]=await Promise.all(sessions.map(open));
    const settled=await snapshot(host,room=>room.students.length===2&&room.students.every(p=>p.online));
    const phase=(socket,name,id)=>until(socket,m=>m.type==='game'&&m.state?.phase===name&&(!id||m.state.id===id));
    const config={title:'재경기 검증',settings:{questionCount:1,reveal:1,move:3,lives:5,hazards:false,contact:false,
      pace:'auto',questionOrder:'ordered',optionOrder:'ordered'},questions:[['첫 문제',['A','B','C','D'],1,'해설']]};
    assert.equal((await post(path+'/start-game',config,teacher.token)).status,200);
    const start=await phase(first,'countdown');
    const {id}=start.state;
    const drop=await phase(first,'drop',id);
    assert.equal(drop.state.result,null);
    const [staff,student]=await Promise.all([phase(host,'end',id),phase(first,'end',id)]);
    const result=staff.state.result;
    assert.deepEqual(student.state.result,result);
    assert.ok(result.ceremonyAt>=drop.state.dropAt+5000);
    assert.equal(result.winners.length,2);
    assert.deepEqual(result.players.map(p=>p.color),[2,3]);
    assert.ok(result.players.every(p=>p.hp>0));
    other.socket.close(1000);
    await snapshot(host,room=>room.students.some(p=>p.id===sessions[1].id&&!p.online));
    const rejoined=await open(sessions[1]);
    assert.deepEqual((await phase(rejoined,'end',id)).state.result,result);
    assert.ok(Date.now()-result.ceremonyAt<5200);

    assert.equal((await post(path+'/restart-game',{gameId:id},sessions[0].token)).status,403);
    const decisions=await Promise.all([
      post(path+'/restart-game',{gameId:id},teacher.token),
      post(path+'/restart-game',{gameId:id},teacher.token),
    ]);
    assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
    const reset=await until(first,m=>m.type==='game'&&m.state?.phase==='countdown'&&m.state.id!==id);
    assert.equal(reset.reset,true);
    assert.equal(reset.state.round,0);
    assert.equal(reset.state.event,null);
    assert.equal(reset.state.result,null);
    assert.ok(reset.state.players.every(p=>p.hp===5));
    assert.deepEqual(reset.state.players.map(p=>p.slot),result.players.map(p=>p.slot));
    assert.equal((await post(path+'/end-game',{},teacher.token)).status,200);
    const stopped=(await phase(first,'end',reset.state.id)).state.result;
    assert.deepEqual(stopped.winners,[]);
    assert.equal(stopped.ceremonyAt,null);
    assert.equal(stopped.players.length,2);
    assert.equal((await post(path+'/return-lobby',{gameId:id},teacher.token)).status,409);
    assert.equal((await post(path+'/return-lobby',{gameId:reset.state.id},teacher.token)).status,200);
    await until(rejoined,m=>m.type==='game'&&m.state===null&&m.reset);
    const back=await snapshot(host,room=>room.students.length===2);
    assert.deepEqual(back.students.map(p=>p.id),settled.students.map(p=>p.id));
  }finally{
    await post(path+'/close',{},teacher.token);
  }
});

test('authoritative shove is opt-in, broadcasts one result, and ignores repeated and stale attempts', {timeout:30000},async()=>{
  for(const push of [false,true]){
    const {body:teacher}=await post('rooms');
    const path='rooms/'+teacher.code;
    const {body:one}=await post(path+'/join',{name:'미는 토끼',color:0});
    const {body:two}=await post(path+'/join',{name:'밀리는 토끼',color:1});
    const attacker=await open(one),victim=await open(two);
    assert.equal((await post(path+'/start-game',{
      title:'밀기',
      settings:{questionCount:1,reveal:1,move:9,lives:3,pace:'auto',push,contact:false,hazards:false,questionOrder:'ordered',optionOrder:'ordered'},
      questions:[['문제',['1','2','3','4'],0,'설명']],
    },teacher.token)).status,200);
    const {state}=await until(attacker,m=>m.type==='game'&&m.state?.phase==='move');
    const {pose}=await until(attacker,m=>m.type==='game'&&m.reset);
    assert.equal(state.push,push);
    const away=[pose[0],pose[1],pose[2],-157,0];
    attacker.socket.send(JSON.stringify([state.roundKey,...away]));
    await until(victim,m=>m.type==='poses'&&m.poses.some(row=>row[0]===0&&row[4]===-157));
    if(push){
      const miss=m=>m.type==='impact'&&m.kind==='push'&&m.by===0&&m.slot===null;
      attacker.socket.send(JSON.stringify([state.roundKey,'push']));
      assert.deepEqual(await until(attacker,miss),await until(victim,miss));
      attacker.socket.send(JSON.stringify([state.roundKey,'push']));
      await new Promise(resolve=>setTimeout(resolve,3050));
      assert.equal(victim.messages.filter(m=>m.type==='impact').length,1);
    }
    const facing=[pose[0],pose[1],pose[2],157,0];
    attacker.socket.send(JSON.stringify([state.roundKey,...facing]));
    await until(victim,m=>m.type==='poses'&&m.poses.some(row=>row[0]===0&&row[4]===157));
    attacker.socket.send(JSON.stringify(['older-round','push']));
    for(let i=0;i<6;i++)attacker.socket.send(JSON.stringify([state.roundKey,'push']));
    if(push){
      const isPush=m=>m.type==='impact'&&m.kind==='push'&&m.by===0&&m.slot===1;
      const hit=await until(attacker,isPush);
      assert.deepEqual(await until(victim,isPush),hit);
      const isOffset=m=>m.type==='poses'&&m.poses.some(row=>row[0]===1&&row[6]>=245);
      assert.deepEqual((await until(victim,isOffset)).poses,(await until(attacker,isOffset)).poses);
      assert.equal(victim.messages.filter(isPush).length,1);
      assert.ok(state.players.every(p=>p.hp===3));
    }else{
      await new Promise(resolve=>setTimeout(resolve,350));
      assert.ok(victim.messages.every(m=>m.type!=='impact'));
    }
    await post(path+'/close',{},teacher.token);
  }
});
