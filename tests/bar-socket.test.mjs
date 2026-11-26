import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runtime} from './runtime.mjs';
import {ArenaEvent,Motion,Rules} from '../server/arena-motion.mjs';

test('both sockets receive the same strong airborne rebound and motion remains responsive afterward', {timeout:20000}, async()=>{
  const mf=runtime({
    modulesRoot:fileURLToPath(new URL('..',import.meta.url)),
    scriptPath:fileURLToPath(new URL('./bar-fixture.mjs',import.meta.url)),
  });
  const sockets=[];
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    const origin=(await mf.ready).origin;
    async function post(path,body={},token){
      const response=await mf.dispatchFetch(origin+'/api/quizrun/'+path,{
        method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
        body:JSON.stringify(body),
      });
      assert.ok(response.ok,path);
      return response.json();
    }
    const owner=await post('rooms'), base='rooms/'+owner.code;
    async function connect(name){
      const player=await post(base+'/join',{name,color:0});
      const {ticket}=await post(base+'/ticket',{},player.token);
      const response=await mf.dispatchFetch(origin+'/api/quizrun/'+base+'/socket?ticket='+ticket,{headers:{Origin:origin,Upgrade:'websocket'}});
      assert.equal(response.status,101);
      const socket=response.webSocket,messages=[];
      socket.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
      socket.accept();sockets.push(socket);
      return {socket,messages};
    }
    const a=await connect('밀리는 토끼'),b=await connect('보는 토끼');
    await post(base+'/start-game',{title:'물리 테스트',
      settings:{questionCount:1,reveal:1,move:12,lives:3,pace:'auto',contact:false,questionOrder:'ordered',optionOrder:'ordered'},
      questions:[['문제',['1','2','3','4'],0,'설명']]}, owner.token);
    const initial=a.messages.find(m=>m.type==='game'&&m.reset)?.pose;
    const collect=c=>c.messages.flatMap(m=>m.type==='poses'?m.poses.filter(p=>p[0]===0&&p[7]>0):[]);
    for(let i=0;i<150&&collect(a).length<4;i++)await sleep(50);
    assert.ok(collect(a).length>=4,'stationary rabbit must receive multiple pushes');
    const game=a.messages.find(m=>m.type==='game'&&m.state?.event)?.state;
    assert.ok(game);
    assert.equal(game.event.kind,'double');
    assert.ok(collect(a).some(row=>row[6]>0&&row[7]>0));
    const impact=m=>m.type==='impact'&&m.kind==='bar'&&m.slot===0;
    const event=a.messages.find(impact);
    assert.ok(event);
    assert.deepEqual(event,b.messages.find(impact));
    assert.ok(collect(a).some(row=>row[2]>event.y*100+10&&(row[5]&Motion.airborne)));

    for(let i=0;i<30&&!collect(a).some(row=>Math.hypot(row[6],row[7])>800);i++)await sleep(50);
    const strong=collect(a).find(row=>Math.hypot(row[6],row[7])>800);
    assert.ok(strong,'the server should apply at least eight world units of rebound');
    assert.ok(collect(b).some(row=>JSON.stringify(row)===JSON.stringify(strong)));
    assert.equal(a.messages.filter(m=>impact(m)&&m.at-event.at<760).length,1);

    const input=initial||Motion.roundSpawn(0);
    for(let i=0;i<7;i++){
      input[0]+=36;
      const target=collect(a).at(-1);
      input[1]=Math.round(Rules.surface((input[0]+target[6])/100,(input[2]+target[7])/100)*100);
      a.socket.send(JSON.stringify([game.roundKey,...input.slice(0,3),157,1]));
      await sleep(100);
    }
    assert.ok(collect(a).some(row=>row[4]===157&&(row[5]&Motion.run)));
  }finally{
    for(const socket of sockets)socket.close(1000);
    await mf.dispose();
  }
});

test('the worker rescues flooded students without lives lost and restores the same flood on reconnect', {timeout:20000}, async()=>{
  const mf=runtime({
    modulesRoot:fileURLToPath(new URL('..',import.meta.url)),
    scriptPath:fileURLToPath(new URL('./bar-fixture.mjs',import.meta.url)),
  });
  const sockets=[];
  try{
    const origin=(await mf.ready).origin;
    async function post(path,body={},token){
      const response=await mf.dispatchFetch(origin+'/api/quizrun/'+path,{
        method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
        body:JSON.stringify(body),
      });
      assert.ok(response.ok,path);
      return response.json();
    }
    const owner=await post('rooms'),base='rooms/'+owner.code;
    async function connect(player){
      const {ticket}=await post(base+'/ticket',{},player.token);
      const response=await mf.dispatchFetch(origin+'/api/quizrun/'+base+'/socket?ticket='+ticket,{headers:{Origin:origin,Upgrade:'websocket'}});
      assert.equal(response.status,101);
      const socket=response.webSocket;
      const messages=[];
      socket.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
      socket.accept();sockets.push(socket);
      return {socket,messages};
    }
    async function waitFor(client,predicate){
      for(let i=0;i<200;i++){
        const match=client.messages.find(predicate);
        if(match)return match;
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      assert.fail('expected server message did not arrive');
    }
    const student=await post(base+'/join',{name:'수면 토끼',color:0});
    const other=await post(base+'/join',{name:'다른 토끼',color:1});
    const a=await connect(student),b=await connect(other);
    await post(base+'/start-game',{title:'수면 테스트',
      settings:{questionCount:1,reveal:1,move:7,lives:3,pace:'auto',contact:false,questionOrder:'ordered',optionOrder:'ordered'},
      questions:[['문제',['1','2','3','4'],1,'설명']]},owner.token);
    const noticeA=await waitFor(a,m=>m.type==='game'&&m.state?.event?.flood);
    const noticeB=await waitFor(b,m=>m.type==='game'&&m.state?.event?.flood);
    assert.deepEqual(noticeA.state.event,noticeB.state.event);
    assert.equal(ArenaEvent.combination(noticeA.state.event),'sweep+flood');
    const {cue}=noticeA.state.event;
    for(const notice of [noticeA,noticeB]){
      assert.deepEqual([cue,cue+1000,cue+2000,cue+3000].map(time=>ArenaEvent.floodCountdown(notice.state,time)),[3,2,1,0]);
    }
    const rescued=await waitFor(a,m=>m.type==='game'&&m.reset&&m.state?.phase==='move');
    const alternate=await waitFor(b,m=>m.type==='game'&&m.reset&&m.state?.phase==='move');
    assert.deepEqual(rescued.state.event,alternate.state.event);
    const wetPoint=Motion.position(rescued.pose);
    assert.equal(Rules.answerPad(wetPoint),0);
    assert.equal(wetPoint.y,Rules.top);
    assert.ok(rescued.state.players.every(player=>player.hp===3&&player.fallenAt==null));
    assert.ok(ArenaEvent.waterLevel(rescued.state,rescued.state.serverNow)>=0);
    const rejoined=await connect(student);
    const restored=await waitFor(rejoined,m=>m.type==='game'&&m.state?.phase==='move');
    assert.equal(restored.state.roundKey,rescued.state.roundKey);
    assert.deepEqual(restored.state.event,rescued.state.event);
    const ready=await waitFor(rejoined,m=>m.type==='motion-ready');
    assert.deepEqual(ready.own,rescued.pose);
    const reveal=await waitFor(rejoined,m=>m.type==='game'&&m.state?.phase==='drop');
    assert.equal(reveal.state.answers[0].choice,0);
    assert.equal(reveal.state.players[0].hp,2);
    const fallen=await waitFor(rejoined,m=>m.type==='game'&&m.state?.players[0].fallenAt!=null);
    assert.equal(fallen.state.players[0].hp,2);
  }finally{
    for(const socket of sockets)socket.close(1000);
    await mf.dispose();
  }
});
