import { DurableObject } from 'cloudflare:workers';
import { ArenaEvent, Motion, Rules, Impact } from './arena-motion.mjs';
import {contactActive,contactRow,acceptContactInput,solveContacts} from './contact.mjs';
import { stepObstacle, stepSurvival, moveImpact } from './hazards.mjs';
import { configure, begin, advance, nextRound, viewMatch, drown, finish, replay } from './match.mjs';

const minutes = n => n * 60_000;
const MAX_STUDENTS = 30;
const RECONNECT = 90_000;
const TICKET_MS = 20_000;
const IDLE = minutes(20);
const LIFETIME = minutes(120);
const CLOSED = minutes(10);
const TOKEN = /^[a-f0-9]{64}$/;
const CODE = /^[1-9][0-9]{3}$/;
const questionKey=i=>'game-q:'+i;
const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
const error = (status, reason) => json({error: reason}, status);
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
const hash = async token => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(n => n.toString(16).padStart(2, '0')).join('');

async function readBody(request, limit = 2048) {
  const stream = request.body?.getReader();
  if (!stream) return null;
  const decoder = new TextDecoder();
  let size = 0, raw = '';
  try {
    for (;;) {
      const {value, done} = await stream.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await stream.cancel(); return null; }
      raw += decoder.decode(value, {stream: true});
    }
    const out = JSON.parse(raw + decoder.decode());
    return out && typeof out === 'object' && !Array.isArray(out) ? out : null;
  } catch { return null; }
}

function stub(env, code) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function cors(response, origin) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return new Response(response.body, {status: response.status, headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/quizrun/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/quizrun/health' && request.method === 'GET') return json({ok: true});
    const origin = request.headers.get('Origin');
    const allowlist = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
    if (!origin || (origin !== url.origin && !allowlist.includes(origin))) return error(403, 'origin');
    if (request.method === 'OPTIONS') return cors(new Response(null, {status: 204, headers: {
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    }}), origin);

    const path = url.pathname.slice('/api/quizrun/'.length);
    try {
      if (path === 'rooms' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'local';
        if (env.ROOM_CREATES && !(await env.ROOM_CREATES.limit({key: ip})).success) return cors(error(429, 'rate'), origin);
        const token = randomToken();
        const teacherHash = await hash(token);
        const tried = new Set();
        for (let i = 0; i < 20; i++) {
          let code;
          do { code = String(1000 + crypto.getRandomValues(new Uint32Array(1))[0] % 9000); } while (tried.has(code));
          tried.add(code);
          const response = await stub(env, code).fetch('https://room.internal/create', {
            method: 'POST', body: JSON.stringify({code, teacherHash}),
          });
          if (response.status === 409) continue;
          if (!response.ok) return cors(response, origin);
          return cors(json({code, role: 'teacher', id: 'teacher', token}, 201), origin);
        }
        return cors(error(503, 'busy'), origin);
      }

      const match = /^rooms\/([^/]+)\/(join|ticket|socket|rename|kick|leave|close|start-game|restart-game|next-round|end-game|return-lobby)$/.exec(path);
      if (!match) return cors(error(404, 'missing'), origin);
      const [, code, action] = match;
      if (!CODE.test(code)) return cors(error(400, 'code'), origin);
      if (action === 'socket'
        ? request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket'
        : request.method !== 'POST') return cors(error(405, 'method'), origin);
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      if (env.ROOM_REQUESTS && !(await env.ROOM_REQUESTS.limit({key: ip})).success) return cors(error(429, 'rate'), origin);
      const internal = new URL('https://room.internal/' + action);
      const headers = new Headers();
      if (action === 'socket') {
        internal.search = url.search;
        headers.set('Upgrade', 'websocket');
      } else {
        const auth = request.headers.get('Authorization');
        if (auth?.startsWith('Bearer ') && TOKEN.test(auth.slice(7))) headers.set('Authorization', auth);
      }
      let body;
      if (['join', 'rename', 'kick','start-game','restart-game','return-lobby'].includes(action)) {
        const data = await readBody(request,action==='start-game'?560_000:2048);
        if (!data) return cors(error(400, 'body'), origin);
        body = JSON.stringify(data);
      }
      const result = await stub(env, code).fetch(new Request(internal, {
        method: request.method, headers, body,
      }));
      return cors(result, origin);
    } catch {
      return cors(error(503, 'unavailable'), origin);
    }
  },
};

function validName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && [...name].length <= 16 && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : null;
}

const nicknameKey = name => name.normalize('NFKC').toLowerCase().replace(/\s+/g,' ');

function nameTaken(room, name, exceptId) {
  const key = nicknameKey(name);
  return room.students.some(student => student.id !== exceptId && nicknameKey(student.name) === key);
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
    this.motion = new Map();
    this.dirty = new Set();
    this.flushTimer = null;
    this.lastContactAt = null;
    this.contactCheckpoints=new Set();
    this.game = null;
    ctx.blockConcurrencyWhile(async()=>{
      const current=await ctx.storage.get('game');
      if (!current) return;
      const keys=Array.from({length:current.questionCount},(_,i)=>questionKey(i));
      const rows=await ctx.storage.get(keys);
      this.game={...current,questions:keys.map(key=>rows.get(key))};
      const now=Date.now();
      for(const socket of this.sockets()){
        const a=socket.deserializeAttachment();
        if(!Number.isInteger(a?.slot)||!a.pose)continue;
        const {ox=0,oz=0}=a,input=a.pose.slice();
        input[0]-=ox;input[2]-=oz;
        this.motion.set(a.slot,{pose:a.pose,input,ox,oz,t:now,airSince:null,budget:3,budgetAt:now});
      }
      if(this.game.event||ArenaEvent.live(this.game.phase)||this.game.phase==='restore')this.scheduleMotion();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  serialize(action) {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }

  fetch(request) {
    return this.serialize(() => this.handle(request));
  }

  sockets() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && ws.deserializeAttachment()?.id);
  }

  broadcast(room) {
    const sockets = this.sockets();
    const connected = new Set(sockets.map(ws => ws.deserializeAttachment().id));
    const message = JSON.stringify({type: 'room', code: room.code, teacherOnline: connected.has('teacher'),
      students: room.students.map(({id, name, color, slot}) => ({id, name, color, slot, online: connected.has(id)})),
    });
    for (const socket of sockets) {
      try { socket.send(message); } catch {}
    }
  }

  terminate(socket, reason, code) {
    socket.serializeAttachment(null);
    try { socket.send(JSON.stringify({type: reason})); } catch {}
    try { socket.close(code, reason); } catch {}
  }

  async save(room, now) {
    room.tickets = room.tickets.filter(entry => entry.until > now);
    await this.ctx.storage.put('room', room);
    await this.arm(room);
  }

  async arm(room) {
    const deadline = Math.min(room.hardUntil, room.idleUntil ?? Infinity,this.game?.until??Infinity,
      ...room.students.map(student => student.until ?? Infinity));
    if (await this.ctx.storage.getAlarm() !== deadline) await this.ctx.storage.setAlarm(deadline);
  }

  async closeRoom(now, reason) {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.motion.clear();
    this.dirty.clear();
    this.lastContactAt=null;
    this.contactCheckpoints.clear();
    await this.clearGame();
    await this.ctx.storage.put('room', {closedUntil: now + CLOSED});
    await this.ctx.storage.setAlarm(now + CLOSED);
    for (const socket of this.sockets()) this.terminate(socket, reason, 4003);
  }

  async refresh(room, now) {
    if (room?.closedUntil) {
      if (room.closedUntil > now) return room;
      await this.ctx.storage.delete('room');
      return null;
    }
    if (!room) return null;
    if (room.hardUntil <= now || (room.idleUntil !== null && room.idleUntil <= now)) {
      await this.closeRoom(now, 'expired');
      return {closedUntil: now + CLOSED};
    }
    const prior = room.students.length;
    room.students = room.students.filter(student => student.until === null || student.until > now);
    if (room.students.length !== prior) {
      if (this.game && this.game.phase!=='end') {
        for (const player of this.game.players) if (!room.students.some(p=>p.id===player.id)) player.out=true;
        await this.saveGame(room,now);
      }
      await this.save(room, now);
      this.broadcast(room);
    }
    return room;
  }

  async handle(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    const now = Date.now();
    const room = await this.refresh(await this.ctx.storage.get('room'), now);
    if (action === 'create') {
      if (room) return error(409, 'occupied');
      const {code, teacherHash} = await request.json();
      await this.save({code, teacherHash, students: [], tickets: [], hardUntil: now + LIFETIME, idleUntil: now + IDLE}, now);
      return json({ok: true}, 201);
    }
    if (!room) return error(404, 'missing');
    if (room.closedUntil) return error(410, 'closed');
    await this.tick(room,now);

    if (action === 'join') {
      if(this.game) return error(409,'started');
      const data = await request.json();
      const name = validName(data?.name);
      if (!name) return error(400, 'name');
      if (!Number.isInteger(data.color) || data.color < 0 || data.color > 3) return error(400, 'color');
      if (room.students.length >= MAX_STUDENTS) return error(409, 'full');
      if (nameTaken(room, name)) return error(409, 'name-taken');
      const id = crypto.randomUUID(), token = randomToken();
      const slots = new Set(room.students.map(entry=>entry.slot));
      const slot = Array.from({length:MAX_STUDENTS},(_,i)=>i).find(i=>!slots.has(i));
      this.motion.delete(slot);
      this.dirty.delete(slot);
      room.students.push({id, name, color: data.color, slot, tokenHash: await hash(token), until: now + RECONNECT});
      await this.save(room, now);
      this.broadcast(room);
      return json({code: room.code, id, role: 'student', token}, 201);
    }

    if (action === 'socket') {
      const raw = url.searchParams.get('ticket');
      if (!raw || !TOKEN.test(raw)) return error(403, 'ticket');
      const key = await hash(raw);
      const ticket = room.tickets.find(entry => entry.key === key && entry.until > now);
      if (!ticket) return error(403, 'ticket');
      const student = room.students.find(entry => entry.id === ticket.id);
      if (ticket.id !== 'teacher' && !student) return error(403, 'session');
      room.tickets = room.tickets.filter(entry => entry.id !== ticket.id);
      room.idleUntil = null;
      const returning = student?.arrived === true;
      if (student) {
        student.until = null;
        student.arrived = true;
      }
      await this.save(room, now);
      const old = this.sockets().find(ws=>ws.deserializeAttachment().id === ticket.id);
      const oldMeta=old?.deserializeAttachment();
      const checkpoint=oldMeta?.pose;
      if (old) this.terminate(old,'replaced',4001);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      let own;
      if (student) {
        const epoch=this.game?.roundKey??null;
        const existing=this.motion.get(student.slot);
        const prior=existing?.pose || (oldMeta?.epoch===epoch?checkpoint:null);
        own=prior?(this.game?prior:Motion.resting(prior)):this.game?Motion.roundSpawn(student.slot):Motion.spawn(student.slot);
        if(!existing)this.motion.set(student.slot,{pose:own,t:now,airSince:null,budget:3,budgetAt:now});
        const offset=existing?{ox:existing.ox||0,oz:existing.oz||0}:{};

        server.serializeAttachment({id:ticket.id,slot:student.slot,pose:own,epoch,...offset,resume:!this.game&&returning&&!prior});
      } else server.serializeAttachment({id:ticket.id});
      this.broadcast(room);
      if (student) {
        const poses = this.sockets().flatMap(ws=>{
          const a = ws.deserializeAttachment();
          return Number.isInteger(a.slot)?[contactRow(a.slot,this.motion.get(a.slot)||{pose:a.pose})]:[];
        });
        server.send(JSON.stringify({type:'motion-ready',own,resume:server.deserializeAttachment().resume,poses}));
        this.queueMotion(student.slot);
      }
      this.sendGame(server,Date.now());
      return new Response(null, {status: 101, webSocket: client});
    }

    const raw = request.headers.get('Authorization')?.slice(7);
    const digest = raw && TOKEN.test(raw) ? await hash(raw) : '';
    const actor = digest === room.teacherHash ? 'teacher' : room.students.find(student => student.tokenHash === digest)?.id;
    if (!actor) return error(403, 'session');
    if (action === 'ticket') {
      const value = randomToken();
      room.tickets = room.tickets.filter(entry => entry.id !== actor);
      room.tickets.push({id: actor, key: await hash(value), until: now + TICKET_MS});
      await this.save(room, now);
      return json({ticket:value,serverNow:Date.now()});
    }
    if (action === 'leave') {
      if (actor === 'teacher') return error(403, 'role');
      await this.remove(room, actor, 'left', now);
      return json({ok: true});
    }
    if (actor !== 'teacher') return error(403, 'role');
    if (action === 'start-game') {
      if (this.game) return error(409,'started');
      const config=configure(await request.json());
      if (!config) return error(400,'invalid-game');
      const connected=new Set(this.sockets().map(ws=>ws.deserializeAttachment().id));
      const students=room.students.filter(p=>connected.has(p.id));
      if (!students.length) return error(409,'no-students');
      this.game=begin(config,students,Date.now());
      await this.ctx.storage.put(Object.fromEntries(config.questions.map((question,i)=>[questionKey(i),question])));
      this.resetMotion(room,Date.now());
      await this.saveGame(room,Date.now(),true);
      return json({ok:true});
    }
    if (action === 'restart-game') {
      const {gameId}=await request.json();
      if (this.game?.phase!=='end'||gameId!==this.game.id) return error(409,'phase');
      const restarted=replay(this.game,room.students,Date.now());
      const connected=new Set(this.sockets().map(ws=>ws.deserializeAttachment().id));
      if (!restarted.players.some(player=>connected.has(player.id))) return error(409,'no-students');
      this.game=restarted;
      const started=Date.now();
      this.resetMotion(room,started);
      await this.saveGame(room,started,true);
      return json({ok:true});
    }
    if (action === 'next-round' || action === 'end-game' || action === 'return-lobby') {
      const now=Date.now();
      if (!this.game) return error(409,'phase');
      if (action==='next-round') {
        if (this.game.phase!=='between') return error(409,'phase');
        nextRound(this.game,now);
        this.rekeyMotion();
      } else if (action==='end-game') {
        if (this.game.phase==='end') return error(409,'phase');
        finish(this.game,now,[],'stopped');
      } else {
        const {gameId}=await request.json();
        if (this.game.phase!=='end'||gameId&&gameId!==this.game.id) return error(409,'phase');
        await this.clearGame();
        this.resetMotion(room,now);
      }
      await this.saveGame(room,now,action==='return-lobby');
      return json({ok:true});
    }
    if (action === 'close') {
      await this.closeRoom(now, 'closed');
      return json({ok: true});
    }
    const data = await request.json();
    const student = room.students.find(entry => entry.id === data?.id);
    if (!student) return error(404, 'student');
    if (action === 'kick') {
      await this.remove(room, student.id, 'kicked', now);
      return json({ok: true});
    }
    if (action === 'rename') {
      const name = validName(data.name);
      if (!name) return error(400, 'name');
      if (nameTaken(room, name, student.id)) return error(409, 'name-taken');
      student.name = name;
      const player=this.game?.players.find(p=>p.id===student.id);
      if (player) {player.name=name;await this.saveGame(room,now);}
      await this.save(room, now);
      this.broadcast(room);
      return json({ok: true});
    }
    return error(404, 'missing');
  }

  async remove(room, id, reason, now) {
    const slot = room.students.find(student=>student.id===id)?.slot;
    const participant=this.game?.players.find(p=>p.id===id);
    if (participant&&this.game.phase!=='end') {
      participant.out=true;
      await this.saveGame(room,now);
    }
    this.motion.delete(slot);
    this.dirty.delete(slot);
    room.students = room.students.filter(student => student.id !== id);
    room.tickets = room.tickets.filter(entry => entry.id !== id);
    const sockets = this.sockets();
    if (sockets.every(ws => ws.deserializeAttachment().id === id)) room.idleUntil ??= now + IDLE;
    await this.save(room, now);
    for (const ws of sockets) if (ws.deserializeAttachment().id === id) this.terminate(ws, reason, 4002);
    this.broadcast(room);
  }

  onDisconnect(socket) {
    return this.serialize(async () => {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.id) return;
      socket.serializeAttachment(null);
      this.dirty.delete(attachment.slot);
      const now = Date.now();
      const room = await this.refresh(await this.ctx.storage.get('room'), now);
      if (!room || room.closedUntil) return;
      const sockets = this.sockets();
      const student = room.students.find(entry => entry.id === attachment.id);
      if (student && !sockets.some(ws => ws.deserializeAttachment().id === student.id)) student.until = now + RECONNECT;
      if (!sockets.length) room.idleUntil ??= now + IDLE;
      await this.save(room, now);
      this.broadcast(room);
    });
  }

  webSocketClose(socket) { return this.onDisconnect(socket); }
  webSocketError(socket) { return this.onDisconnect(socket); }
  queueMotion(slot) {
    this.dirty.add(slot);
    this.scheduleMotion();
  }

  scheduleMotion() {
    if (this.flushTimer!==null) return;
    this.flushTimer=setTimeout(()=>this.flushMotion(),Motion.interval);
  }

  flushMotion() {
    this.flushTimer=null;
    const now=Date.now(),sockets=this.sockets();
    const game=this.game;
    const water=ArenaEvent.waterLevel(game,now);
    const wet=ArenaEvent.waterPhysics(game,water);
    const event=game?.phase==='end'?null:game?.event;
    const field=event?.kind==='flood'?null:event;
    const solid=ArenaEvent.barActive(game,now);
    const inTime=game?.until==null||now<game.until;
    const impulses=game&&inTime&&[...this.motion.values()].some(p=>p.launch);
    const continued=(wet||event||impulses)&&inTime;
    const contacts=contactActive(game,now);
    const connected=new Map(sockets.map(ws=>[ws.deserializeAttachment().slot,ws]));
    const floor=ArenaEvent.floor(game,now,game?.questions[game.round][2],water);
    const dt=Math.min(.16,Math.max(0,(now-(this.lastContactAt??now-Motion.interval))/1000));
    this.lastContactAt=continued||contacts?now:null;
    const entries=[];
    let stateChanged=false;
    if(contacts||continued)for(const p of game.players){
      const current=this.motion.get(p.slot);
      const sinkingOut=game.phase==='drop'&&p.hp===0&&game.prior.includes(p.slot);
      if(!current||p.hp===0&&!sinkingOut||p.out||p.fallenAt!=null||!connected.has(p.slot)&&!wet)continue;
      const oldPose=current.pose.slice(),oldY=oldPose[1],oldFlags=oldPose[4];
      current.pushUsed=0;
      if(!solid){current.onBar=false;current.supportBar=null;}
      const movedByImpact=inTime&&moveImpact(current,now-dt*1000,now);
      if((wet||current.launch)&&stepSurvival(current,floor,now,dt,false,water)){
        if(game.phase==='move'){
          const pose=Motion.encode(ArenaEvent.waterSpawn(Motion.position(current.pose),p.slot),current.pose[3]/100,0);
          this.motion.set(p.slot,{pose,t:now,airSince:null,budget:3,budgetAt:now,nextPushAt:current.nextPushAt});
          const socket=connected.get(p.slot);
          if(socket){
            const actor=socket.deserializeAttachment();
            socket.serializeAttachment({...actor,pose,ox:0,oz:0,resume:false});
            this.sendGame(socket,now,new Set([p.slot]));
          }
          this.dirty.add(p.slot);
          continue;
        }
        if(sinkingOut)p.fallenAt=now;
        if(sinkingOut||ArenaEvent.live(game.phase)&&drown(game,p,now)){
          current.pose[1]=Math.round(water*100);
          this.dirty.add(p.slot);
          stateChanged=true;
        }
        continue;
      }
      const candidate=current.pose;
      const pushed=field&&!sinkingOut&&stepObstacle(current,field,solid,now,floor,wet||current.launch,candidate,oldPose,
        ()=>this.notifyImpact(game,'bar',p.slot,p.slot,now));
      if(current.launch&&!wet&&!current.impulse&&current.vertical?.standing){
        current.launch=false;
        current.vertical=null;
        current.airSince=null;
      }
      if(oldY!==current.pose[1]||oldFlags!==current.pose[4]||pushed||movedByImpact){
        this.dirty.add(p.slot);
        this.contactCheckpoints.add(p.slot);
      }
      if(contacts&&!sinkingOut&&connected.has(p.slot))entries.push([p.slot,current]);
    }
    const moved=contacts?solveContacts(entries,now,dt,{floor,wet,event:field,solid}):[];
    for(const slot of moved){
      this.contactCheckpoints.add(slot);
      this.dirty.add(slot);
    }
    if(stateChanged)this.serialize(async()=>{
      if(this.game!==game)return;
      const room=await this.ctx.storage.get('room');
      if(room&&!room.closedUntil&&this.game===game)await this.saveGame(room,Date.now());
    });
    const poses=[...this.dirty].flatMap(slot=>{
      const current=this.motion.get(slot);
      return current?[contactRow(slot,current)]:[];
    });
    this.dirty.clear();
    if(poses.length){
      const message=JSON.stringify({type:'poses',poses,roundKey:this.game?.roundKey??null});
      for(const socket of sockets){
        if(!Number.isInteger(socket.deserializeAttachment().slot))continue;
        try{socket.send(message);}catch{}
      }
    }
    if(continued||moved.length)this.scheduleMotion();
    else if(this.contactCheckpoints.size){
      for(const socket of sockets){
        const actor=socket.deserializeAttachment();
        if(!this.contactCheckpoints.has(actor.slot))continue;
        const current=this.motion.get(actor.slot);
        if(current)socket.serializeAttachment({...actor,pose:current.pose,ox:current.ox,oz:current.oz});
      }
      this.contactCheckpoints.clear();
    }
  }

  notifyImpact(game,kind,by,slot,at){
    const message=JSON.stringify({type:'impact',roundKey:game.roundKey,kind,by,slot,at,y:slot==null?undefined:this.motion.get(slot)?.pose[1]/100});
    for(const socket of this.sockets()){
      if(!Number.isInteger(socket.deserializeAttachment().slot))continue;
      try{socket.send(message);}catch{}
    }
  }

  tryPush(game,actor,now){
    if(!Impact.enabled(game,now))return;
    const active=p=>!p.out&&p.hp!==0&&p.fallenAt==null;
    if(!game.players.some(p=>p.slot===actor.slot&&active(p)))return;
    const source=this.motion.get(actor.slot);
    if(!source||now<(source.nextPushAt??0))return;
    const connected=new Set(this.sockets().map(ws=>ws.deserializeAttachment().slot));
    const candidates=game.players.filter(p=>p.slot!==actor.slot&&active(p)&&connected.has(p.slot)&&this.motion.has(p.slot))
      .map(p=>({slot:p.slot,position:Motion.position(this.motion.get(p.slot).pose)}));
    source.nextPushAt=now+Impact.cooldown;
    const hit=Impact.target(Motion.position(source.pose),source.pose[3]/100,candidates);
    const victim=hit&&this.motion.get(hit.candidate.slot);
    if(!victim||!Impact.shove(victim,hit,now-source.t<350&&(source.pose[4]&Motion.sprint)!==0,now)){
      this.notifyImpact(game,'push',actor.slot,null,now);
      return;
    }
    victim.launch=true;
    this.notifyImpact(game,'push',actor.slot,hit.candidate.slot,now);
    this.scheduleMotion();
  }

  webSocketMessage(socket, raw) {
    const actor = socket.deserializeAttachment();
    if (!Number.isInteger(actor?.slot) || typeof raw !== 'string' || raw.length > 95) return;
    const now = Date.now();
    let pose,respawn=false;
    const phase=this.game?.phase;
    const water=ArenaEvent.waterLevel(this.game,now);
    let wet=ArenaEvent.waterPhysics(this.game,water);
    try {pose=JSON.parse(raw);} catch {return;}
    if(Array.isArray(pose)&&pose.length===2&&pose[1]==='push'){
      if(pose[0]===this.game?.roundKey)this.tryPush(this.game,actor,now);
      return;
    }
    if (this.game) {
      if (!ArenaEvent.moving(phase)||this.game.until!==null&&now>=this.game.until||!this.game.players.some(p=>p.slot===actor.slot&&!p.out&&p.hp!==0&&p.fallenAt==null)||
          !Array.isArray(pose)||pose[0]!==this.game.roundKey||![6,7].includes(pose.length)) return;
      respawn=pose.length===7&&pose[6]===1;
      if(respawn&&wet)return;
      pose=pose.slice(1,6);
    }
    let current = this.motion.get(actor.slot);
    if (!current) {
      const {ox=0,oz=0}=actor;
      const input=actor.pose.slice();input[0]-=ox;input[2]-=oz;
      current={pose:actor.pose,input,ox,oz,t:now-Motion.interval,airSince:null,budget:3,budgetAt:now};
      this.motion.set(actor.slot,current);
    }
    const event=this.game?.event;
    const field=event?.kind==='flood'?null:event;
    const solid=ArenaEvent.barActive(this.game,now);
    const surface=ArenaEvent.floor(this.game,now,this.game?.questions[this.game.round][2],water);
    const impact=()=>this.notifyImpact(this.game,'bar',actor.slot,actor.slot,now);
    if(field&&!respawn&&stepObstacle(current,field,solid,now,surface,wet||current.launch,current.pose,current.pose,impact))this.queueMotion(actor.slot);
    wet||=!!current.launch;
    const usesContact=!!this.game;
    const input=pose;
    if(!respawn){
      if(wet&&Motion.validInput(input)){
        pose=[input[0]+(current.ox||0),current.pose[1],input[2]+(current.oz||0),input[3],
          (input[4]&~Motion.airborne)|(current.pose[4]&Motion.airborne)];
        if(!Motion.envelope(pose))return;
      }else if(wet)return;
      else pose=usesContact?acceptContactInput(input,current):Motion.valid(input)?input:null;
      if(!pose)return;
    }
    current.budget = Math.min(3,current.budget+(now-current.budgetAt)/82);
    current.budgetAt = now;
    if (current.budget<1) return;
    current.budget -= 1;

    if (respawn) {
      if (!Motion.nearEdge(current.pose)||now-current.t<260) return;
      pose=Motion.roundSpawn(actor.slot);
    }
    const air = (pose[4]&Motion.airborne)!==0;
    const resumed = actor.resume === true;
    const previous=current.input||current.pose;
    if (!respawn&&!resumed&&!Motion.plausible(previous,input,now-current.t,!wet)) return;
    if (!wet && air && !current.onBar && current.airSince !== null && now-current.airSince > 1300) return;
    if(wet&&(input[4]&Motion.airborne)&&input[1]>current.pose[1]+5){
      stepSurvival(current,surface,now,0,true,water);
    }
    const stopped = pose[4]===0 && current.pose[4]!==0;
    current.airSince = air && !current.onBar ? (current.airSince??now) : null;
    current.recentVy=air&&!wet?Math.max(-8,Math.min(Rules.config.jump,(pose[1]-current.pose[1])*10/Math.max(35,now-current.t))):0;
    current.t = now;
    const dx=respawn?0:input[0]-previous[0],dz=respawn?0:input[2]-previous[2],length=Math.hypot(dx,dz);
    current.dx=length?dx/length:0;
    current.dz=length?dz/length:0;
    current.input=respawn?pose:input;
    if(respawn){current.ox=0;current.oz=0;}
    if (stopped || resumed || respawn) socket.serializeAttachment({...actor,pose:wet?pose:Motion.resting(pose),ox:current.ox||0,oz:current.oz||0,resume:false});
    const before=current.pose;
    if(field&&!respawn){
      stepObstacle(current,field,solid,now,surface,wet,pose,current.pose,impact);
    }else{
      current.pose=pose;
      current.onBar=false;
    }
    if (current.pose.every((value,i)=>value===before[i])) return;
    this.queueMotion(actor.slot);
  }

  sendGame(socket,now,reset=false) {
    const actor=socket.deserializeAttachment();
    if (!actor?.id) return;
    const state=viewMatch(this.game,actor.id==='teacher',now);
    const respawn=reset===true||reset instanceof Set&&reset.has(actor.slot);
    const pose=respawn&&Number.isInteger(actor.slot)?this.motion.get(actor.slot)?.pose:undefined;
    try {socket.send(JSON.stringify({type:'game',state,reset:respawn,pose}));} catch {}
  }

  async saveGame(room,now,reset=false) {
    if (this.game) {
      const {questions,...metadata}=this.game;
      await this.ctx.storage.put('game',{...metadata,questionCount:questions.length});
    }
    await this.arm(room);
    for (const ws of this.sockets()) this.sendGame(ws,now,reset);
  }

  async clearGame() {
    if (!this.game) return;
    const keys=this.game.questions.map((_,i)=>questionKey(i));
    this.game=null;
    await this.ctx.storage.delete(['game',...keys]);
  }

  resetMotion(room,now) {
    this.motion.clear();
    this.dirty.clear();
    this.lastContactAt=null;
    this.contactCheckpoints.clear();
    for (const student of room.students) {
      const pose=this.game?Motion.roundSpawn(student.slot):Motion.spawn(student.slot);
      this.motion.set(student.slot,{pose,t:now,airSince:null,budget:3,budgetAt:now});
    }
    for (const socket of this.sockets()) {
      const actor=socket.deserializeAttachment();
      if (!Number.isInteger(actor.slot)) continue;
      const pose=this.motion.get(actor.slot)?.pose;
      if (!pose) continue;
      socket.serializeAttachment({...actor,epoch:this.game?.roundKey??null,pose,ox:0,oz:0,resume:false});
      this.queueMotion(actor.slot);
    }
  }

  rekeyMotion() {
    for(const socket of this.sockets()){
      const a=socket.deserializeAttachment(),current=this.motion.get(a.slot);
      if(!current)continue;
      socket.serializeAttachment({...a,epoch:this.game.roundKey,pose:current.pose,ox:current.ox||0,oz:current.oz||0});
      this.queueMotion(a.slot);
    }
  }

  restoreFallen(game,now) {
    const reset=new Set();
    for(const p of game.players){
      const current=this.motion.get(p.slot);
      const submerged=current?.vertical?.y<=Rules.deck.water;
      if(current){current.vertical=null;current.obstacleAt=null;current.onBar=false;current.supportBar=null;current.pushUsed=0;current.impulse=null;current.launch=false;current.barContactAt=null;}
      const pose=current?.pose;
      if(p.hp===0||p.out||!pose)continue;
      const {x,z}=Motion.position(pose);
      if(p.fallenAt!=null||submerged||!Number.isFinite(Rules.surface(x,z))){
        const spawn=Motion.roundSpawn(p.slot);
        this.motion.set(p.slot,{pose:spawn,t:now,airSince:null,budget:3,budgetAt:now,nextPushAt:current?.nextPushAt});
        reset.add(p.slot);
      }else{
        // Preserve horizontal position and normalize height as the deck finishes rising.
        current.pose=Motion.resting(pose);
        current.airSince=null;
      }
      p.fallenAt=null;
    }
    return reset;
  }

  async tick(room,now) {
    const game=this.game;
    if (!game) return false;
    const oldPhase=game.phase;
    const oldKey=game.roundKey;
    const saved=new Map(this.sockets().map(ws=>{const a=ws.deserializeAttachment();return [a.slot,a.pose];}));
    // nextRound clears the per-round fall markers.
    const reset=oldPhase==='restore'&&now>=game.until?this.restoreFallen(game,now):false;
    if (!advance(game,now,slot=>this.motion.get(slot)?.pose||saved.get(slot))) return false;
    if(oldKey!==game.roundKey||reset)this.rekeyMotion();
    if(game.event||ArenaEvent.live(game.phase)||game.phase==='restore')this.scheduleMotion();
    await this.saveGame(room,now,reset);
    return true;
  }

  alarm() {
    return this.serialize(async () => {
      const now = Date.now();
      const room = await this.refresh(await this.ctx.storage.get('room'), now);
      if (room && !room.closedUntil) {
        if (!await this.tick(room,now)) await this.arm(room);
      }
    });
  }
}
