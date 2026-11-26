'use strict';

const Online = (() => {
  const errors = {
    started:'이미 경기가 시작됐어요. 대기실로 돌아오면 들어갈 수 있어요.',
    'invalid-game':'문제나 경기 설정을 다시 확인해 주세요.',
    'no-students':'연결된 학생이 적어도 한 명 있어야 시작할 수 있어요.',
    phase:'현재 경기 단계에서는 사용할 수 없어요.',
    code: '방 코드는 숫자 4자리예요.',
    missing: '방을 찾을 수 없어요. 선생님이 알려 준 코드를 확인해 주세요.',
    closed: '이미 종료된 방이에요.',
    expired: '사용 시간이 지나 방이 종료됐어요.',
    full: '정원 30명이 모두 찼어요.',
    session: '이 방의 참가 세션이 만료됐어요. 다시 입장해 주세요.',
    role: '선생님만 사용할 수 있는 기능이에요.',
    student: '이미 나간 참가자예요.',
    name: '닉네임은 1~16자로 입력해 주세요.',
    'name-taken': '이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.',
    color: '캐릭터 색상을 다시 선택해 주세요.',
    rate: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
    kicked: '선생님이 내보냈어요.',
    replaced: '이 참가 세션이 다른 탭에서 연결됐어요.',
    left: '방에서 나왔어요.',
    origin: '온라인 서버가 이 사이트의 연결을 허용하지 않아요.',
    unavailable: '온라인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
  };
  const permanent = new Set(['missing', 'closed', 'expired', 'session', 'role']);
  const storageKey = 'quizrun-online-';
  let view = null;
  const element = id => document.getElementById(id);

  function layout(role) {
    const teacher = role === 'teacher';
    return `<section class="narrow">
      ${heading(teacher ? '온라인 교사 대기실' : '온라인 학생 대기실', teacher ? '방 코드나 QR을 학생들과 공유하세요.' : '선생님이 만든 방 코드와 닉네임을 입력하세요.')}
      <p class="notice">학생은 입장하면 3D 대기실에서 함께 달리고 점프할 수 있어요.</p>
      <form id="online-entry" class="panel online-entry">
        ${teacher ? '<button class="solid">온라인 방 생성</button>' : `<div class="fields">
          <label class="field">방 코드<input name="code" inputmode="numeric" pattern="[1-9][0-9]{3}" maxlength="4" placeholder="4자리 숫자" required></label>
          <label class="field">닉네임<input name="name" maxlength="16" required autocomplete="off"></label>
          ${selectField('color','캐릭터 색상',colors.map(([label],i)=>[i,label]),0)}
        </div><div class="actions"><button class="solid">온라인 입장</button></div>`}
      </form>
      <p class="online-message" id="online-message" role="alert"></p>
      <div class="panel online-panel" id="online-lobby" hidden>
        <h2>방 코드 <strong class="digits" id="online-code"></strong></h2>
        ${teacher ? '<div class="qr online-qr" id="online-qr"></div><a class="online-invite" id="online-invite" target="_blank" rel="noopener noreferrer">학생 참가 링크 열기</a><button class="pill" type="button" id="online-copy">참가 링크 복사</button>' : '<p id="online-profile"></p>'}
        <p class="online-status" id="online-status" role="status"></p>
        ${teacher ? '' : '<div class="online-stage" id="online-stage" aria-label="온라인 3D 대기실"></div>'}
        <h2>학생 <span class="online-count" id="online-count">0 / 30명</span></h2>
        <ul class="online-roster" id="online-roster"></ul>
        ${teacher ? TeacherGame.layout() : ''}
        <div class="actions"><button class="pill" type="button" id="online-exit">${teacher ? '방 종료' : '방 나가기'}</button></div>
      </div>
      <dialog id="online-confirm"><h2 id="online-confirm-title"></h2><p id="online-confirm-text"></p><form method="dialog" class="actions"><button class="pill" value="cancel">취소</button><button class="solid" value="confirm">확인</button></form></dialog>
    </section>`;
  }

  function load(role) {
    try {
      const session = JSON.parse(sessionStorage.getItem(storageKey + role));
      return session?.role === role && /^[1-9][0-9]{3}$/.test(session.code) &&
        /^[a-f0-9]{64}$/.test(session.token) && typeof session.id === 'string' ? session : null;
    } catch { return null; }
  }

  function remember(role, session) {
    try {
      if (session) sessionStorage.setItem(storageKey + role, JSON.stringify(session));
      else sessionStorage.removeItem(storageKey + role);
    } catch {}
  }

  function api(path) {
    const base = document.querySelector('meta[name="quizrun-api"]').content || location.origin;
    if (!/^https?:\/\//.test(base)) throw Object.assign(new Error(), {reason: 'unavailable'});
    return new URL('/api/quizrun/' + path, base);
  }

  async function request(path, {token, data} = {}) {
    const headers = {'Content-Type':'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(api(path), {
      method: 'POST', headers, credentials: 'omit', redirect: 'error',
      body: JSON.stringify(data || {}), signal: AbortSignal.timeout(8000),
    });
    let reply;
    try {reply=await response.json();}
    catch {throw Object.assign(new Error(),{reason:response.status===429?'rate':'unavailable'});}
    if (!response.ok) throw Object.assign(new Error(), {reason: reply.error || (response.status===429?'rate':'unavailable')});
    return reply;
  }

  function showMessage(reason) {
    element('online-message').textContent = reason ? errors[reason] || errors.unavailable : '';
  }

  function shutdown(state) {
    clearTimeout(state.retry);
    clearTimeout(state.handshake);
    clearInterval(state.heartbeat);
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.onmessage = null;
      state.socket.close();
      state.socket = null;
    }
  }

  function unmount() {
    if (view) {
      clearInterval(view.gameTimer);
      cachePose(view);
      shutdown(view);
    }
    view = null;
  }

  function terminate(state, reason) {
    shutdown(state);
    if (state.role==='student' && state.session) {
      try {sessionStorage.removeItem(storageKey+'pose-'+state.session.id);} catch {}
    }
    state.session = null;
    state.room = null;
    state.arena = null;
    state.pose = null;
    state.arenaReady = false;
    state.connected = false;
    state.game=null;
    if(state.role==='teacher')TeacherGame.render(null,0);
    element('online-stage')?.replaceChildren();
    remember(state.role, null);
    if (state.role==='student' && (reason==='closed'||reason==='expired')) {
      go('home');
      const summary = document.querySelector('.home-note');
      summary.textContent = errors[reason];
      summary.setAttribute('role','status');
      return;
    }
    element('online-lobby').hidden = true;
    element('online-roster').replaceChildren();
    element('online-count').textContent = '0 / 30명';
    element('online-entry').hidden = false;
    element('online-confirm').close();
    showMessage(reason === 'left' ? null : reason);
  }

  function showLobby(state) {
    element('online-entry').hidden = true;
    element('online-lobby').hidden = false;
    element('online-code').textContent = state.session.code;
    element('online-status').textContent = '연결 중…';
    if (state.role !== 'teacher') return;
    const invite = new URL(location.href);
    invite.search = '';
    invite.hash = 'online-join/' + state.session.code;
    const link = element('online-invite');
    link.href = invite.href;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(invite.href);
      qr.make();
      const image = document.createElement('img');
      image.src = qr.createDataURL(5, 20);
      image.alt = '학생 참가 링크 QR코드';
      element('online-qr').replaceChildren(image);
    } catch {
      element('online-qr').textContent = '아래 학생 참가 링크를 공유해 주세요.';
    }
    element('online-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(invite.href);
        if (view === state) element('online-status').textContent = '참가 링크를 복사했어요.';
      } catch {
        if (view === state) element('online-status').textContent = '아래 주소를 복사해 주세요. ' + invite.href;
      }
    };
  }

  function renderRoster(state, room) {
    state.room = room;
    publishArena(state);
    const connected = room.students.filter(student => student.online).length;
    element('online-count').textContent = `${connected} / 30명`;
    element('online-status').textContent = room.teacherOnline ? '실시간 연결됨' : '실시간 연결됨 · 선생님 재접속 대기 중';
    const roster = element('online-roster');
    const active = document.activeElement;
    const old = new Map([...roster.children].map(row => [row.dataset.member, row]));
    for (const student of room.students) {
      const row = old.get(student.id) || document.createElement('li');
      if (!row.dataset.member) {
        row.dataset.member = student.id;
        const dot = document.createElement('span');
        dot.dataset.color = '';
        dot.setAttribute('aria-hidden', 'true');
        row.append(dot);
        if (state.role === 'teacher') {
          const input = document.createElement('input');
          input.maxLength = 16;
          input.dataset.onlineName = '';
          row.append(input);
          for (const [action, label] of [['rename','이름 저장'],['kick','내보내기']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pill';
            button.dataset.onlineAction = action;
            button.textContent = label;
            row.append(button);
          }
          const details=document.createElement('span');
          details.className='online-student-details';
          row.append(details);
        } else row.append(document.createElement('strong'));
        row.append(document.createElement('small'));
        roster.append(row);
      }
      old.delete(student.id);
      row.querySelector('[data-color]').style.background = colors[student.color][1];
      row.querySelector('small').textContent = student.online ? '접속 중' : '재접속 대기';
      if (state.role === 'teacher') {
        row.querySelector('.online-student-details').textContent=TeacherGame.stats(state.game,student.slot);
        const input = row.querySelector('input');
        input.setAttribute('aria-label', student.name + ' 닉네임');
        if (active !== input && input.dataset.value !== student.name) input.value = student.name;
        input.dataset.value = student.name;
        row.querySelector('[data-online-action="kick"]').setAttribute('aria-label', student.name + ' 내보내기');
      } else {
        row.querySelector('strong').textContent = student.name + (student.id === state.session.id ? ' (나)' : '');
        if (student.id === state.session.id) element('online-profile').textContent = `닉네임 ${student.name} · ${colors[student.color][0]} 토끼`;
      }
    }
    for (const row of old.values()) row.remove();
  }

  function retry(state) {
    if (view !== state || !state.session) return;
    shutdown(state);
    state.connected = false;
    element('online-status').textContent = '연결이 끊겼어요. 다시 연결 중…';
    const delay = Math.min(8000, 600 * 2 ** Math.min(state.attempt++, 5)) + Math.random() * 500;
    state.retry = setTimeout(() => connect(state), delay);
  }

  async function connect(state) {
    const {session} = state;
    if (!session || view !== state) return;
    try {
      const sent=Date.now();
      const {ticket,serverNow}=await request(`rooms/${session.code}/ticket`,{token:session.token});
      state.clock=Number.isFinite(serverNow)?serverNow-(sent+Date.now())/2:0;
      if (view !== state || state.session !== session) return;
      const url = api(`rooms/${session.code}/socket`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticket);
      const socket = new WebSocket(url);
      state.socket = socket;
      let lastSeen = Date.now();
      state.handshake = setTimeout(() => { if (state.socket === socket) retry(state); }, 9000);
      socket.onmessage = event => {
        if (view !== state || state.socket !== socket) return;
        lastSeen = Date.now();
        if (event.data === 'pong') return;
        const payload = JSON.parse(event.data);
        if (payload.type === 'room') {
          clearTimeout(state.handshake);
          state.attempt = 0;
          renderRoster(state,payload);
        } else if (payload.type==='motion-ready') {
          restoreArena(state,payload);
        } else if (payload.type==='game') {
          showGame(state,payload);
        } else if (payload.type==='impact') {
          if(state.arenaReady&&payload.roundKey===state.game?.roundKey)
            state.arena.contentWindow.postMessage({type:'quizrun-lobby-state',impact:payload},'*');
        } else if (payload.type==='poses') {
          if(payload.roundKey===(state.game?.roundKey??null))receivePoses(state,payload.poses);
        } else terminate(state,payload.type);
      };
      socket.onopen = () => {
        if (view !== state || state.socket !== socket) return;
        state.heartbeat = setInterval(() => {
          if (Date.now() - lastSeen > 65_000 || socket.readyState !== WebSocket.OPEN) retry(state);
          else socket.send('ping');
        }, 25_000);
      };
      socket.onclose = event => {
        if (view !== state || state.socket !== socket) return;
        if (event.code === 4001) terminate(state, 'replaced');
        else if (event.code === 4002) terminate(state, event.reason === 'left' ? 'left' : 'kicked');
        else if (event.code === 4003) terminate(state, event.reason === 'expired' ? 'expired' : 'closed');
        else retry(state);
      };
    } catch(error) {
      if (view !== state || state.session !== session) return;
      if (permanent.has(error.reason) || error.reason === 'origin') terminate(state, error.reason);
      else retry(state);
    }
  }

  async function start(state, form) {
    const button = form.querySelector('button');
    if (button.disabled) return;
    showMessage();
    button.disabled = true;
    const data = new FormData(form);
    try {
      const session = state.role === 'teacher' ? await request('rooms')
        : await request(`rooms/${data.get('code')}/join`, {data:{name:data.get('name'),color:Number(data.get('color'))}});
      if (view !== state) return;
      state.session = session;
      remember(state.role, session);
      showLobby(state);
      connect(state);
    } catch(error) {
      if (view === state) showMessage(error.reason || 'unavailable');
    } finally { button.disabled = false; }
  }

  function confirmAction(title, detail) {
    const dialog = element('online-confirm');
    element('online-confirm-title').textContent = title;
    element('online-confirm-text').textContent = detail;
    return new Promise(resolve => {
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true});
      dialog.showModal();
    });
  }

  async function manage(state, button, action, data = {}) {
    const session = state.session;
    if (!session || button.disabled) return;
    button.disabled = true;
    try {
      const confirm = {
        close: ['방을 종료할까요?', '참가자 모두의 연결이 종료돼요.'],
        kick: ['학생을 내보낼까요?', '이 학생의 현재 참가 세션이 종료돼요.'],
        'end-game':['경기를 종료할까요?','현재 경기만 종료돼요. 방은 계속 열려 있어요.'],
      }[action];
      if (confirm && !await confirmAction(...confirm)) return;
      if (view !== state || state.session !== session) return;
      showMessage();
      await request(`rooms/${session.code}/${action}`, {token: session.token, data});
      if (view !== state || state.session !== session) return;
      if (action === 'leave' || action === 'close') terminate(state, action === 'close' ? 'closed' : 'left');
    } catch(error) {
      if (view === state && state.session === session) showMessage(error.reason || 'unavailable');
    } finally { button.disabled = false; }
  }

  function mount(role, invite) {
    const saved = load(role);
    const state = {role, remote:new Map(), session: saved && (!invite || saved.code === invite) ? saved : null, attempt:0, socket:null};
    view = state;
    if (role==='teacher') {
      TeacherGame.bind((button,action,data)=>manage(state,button,action,data));
      state.gameTimer=setInterval(()=>TeacherGame.sync(state.game,state.clock),150);
    }
    const form = element('online-entry');
    if (invite) form.elements.code.value = invite;
    form.onsubmit = event => { event.preventDefault(); start(state, form); };
    element('online-exit').onclick = event => manage(state, event.currentTarget, role === 'teacher' ? 'close' : 'leave');
    element('online-roster').onclick = event => {
      const button = event.target.closest('[data-online-action]');
      if (!button) return;
      const row = button.closest('li');
      manage(state, button, button.dataset.onlineAction, {id:row.dataset.member,name:row.querySelector('input').value});
    };
    if (state.session) {
      showLobby(state);
      connect(state);
    }
  }


  function cachePose(state) {
    if (!state?.pose || state.role!=='student' || !state.session) return;
    try {sessionStorage.setItem(storageKey+'pose-'+state.session.id, JSON.stringify(Motion.resting(state.pose)));}
    catch {}
  }

  function cachedPose(state) {
    if (Motion.valid(state.pose)) return Motion.resting(state.pose);
    try {
      const pose = JSON.parse(sessionStorage.getItem(storageKey+'pose-'+state.session.id));
      return Motion.valid(pose) ? Motion.resting(pose) : null;
    } catch { return null; }
  }

  function publishArena(state, own) {
    if (!state.arenaReady) return;
    const students = state.room?.students.filter(student=>student.online) || [];
    const online = new Set(students.map(student=>student.slot));
    for (const slot of state.remote.keys()) if (!online.has(slot)) state.remote.delete(slot);
    state.arena.contentWindow.postMessage({type:'quizrun-lobby-state',students,poses:[...state.remote.values()],own,game:state.game??null,clock:state.clock??0},'*');
    state.remote.clear();
  }

  function receivePoses(state, poses) {
    if (!state.arenaReady) for (const row of poses) state.remote.set(row[0],row);
    else state.arena.contentWindow.postMessage({type:'quizrun-lobby-state',poses},'*');
  }

  function restoreArena(state, data) {
    const me = state.room?.students.find(student=>student.id===state.session.id);
    if (!me) return;
    const own = (data.resume && cachedPose(state)) || data.own;
    state.connected = true;
    state.pose = own;
    state.remote = new Map(data.poses.map(row=>[row[0],row]));
    state.own = own;
    if (state.arena) {
      publishArena(state,own);
      return;
    }
    const arena = document.createElement('iframe');
    arena.title = '온라인 3D 대기실 경기장';
    arena.setAttribute('sandbox','allow-scripts');
    arena.srcdoc = arenaDocument({practice:true,settings:defaultSettings,color:me.color,
      online:{slot:me.slot,own,game:state.game??null,clock:state.clock??0,poses:data.poses,students:state.room.students.filter(student=>student.online)}});
    state.arena = arena;
    element('online-stage').replaceChildren(arena);
  }

  function showGame(state,payload) {
    state.game=payload.state;
    if (payload.reset && payload.pose) {
      state.own=payload.pose;
      state.pose=payload.pose;
    }
    if (state.role==='teacher') {
      TeacherGame.render(state.game,state.clock);
      if(state.room)renderRoster(state,state.room);
    } else publishArena(state,payload.reset&&payload.pose?payload.pose:undefined);
  }

  addEventListener('message',event=>{
    const state = view;
    if (!state?.arena || event.source!==state.arena.contentWindow) return;
    if (receiveArenaSound(event,state.arena)) return;
    const data = event.data;
    if (data?.type==='quizrun-lobby-ready') {
      state.arenaReady = true;
      publishArena(state,state.own);
      return;
    }
    if(data?.type==='quizrun-lobby-push'){
      if(state.game?.push&&state.game.roundKey===data.roundKey&&state.socket?.readyState===WebSocket.OPEN)
        state.socket.send(JSON.stringify([data.roundKey,'push']));
      return;
    }
    if (data?.type!=='quizrun-lobby-pose') return;
    const game=state.game;
    if(game ? !Motion.validInput(data.pose) : !Motion.valid(data.pose))return;
    if (game && (!ArenaEvent.moving(game.phase)||game.roundKey!==data.roundKey||
         !game.players.some(p=>p.slot===state.room?.students.find(student=>student.id===state.session.id)?.slot&&p.hp!==0&&!p.out&&p.fallenAt==null))) return;
    if(!game)state.pose=data.pose;
    const now = performance.now();
    if (!state.cachedAt || now-state.cachedAt>=1000) {
      state.cachedAt = now;
      cachePose(state);
    }
    if (!state.connected || state.socket?.readyState!==WebSocket.OPEN || state.socket.bufferedAmount>2048) return;
    if (state.sentAt && now-state.sentAt<Motion.interval-12) return;
    state.sentAt = now;
    const packet=game?[game.roundKey,...data.pose,...(data.respawn?[1]:[])]:data.pose;
    state.socket.send(JSON.stringify(packet));
  });
  addEventListener('pagehide',()=>cachePose(view));

  return {layout,mount,unmount};
})();
