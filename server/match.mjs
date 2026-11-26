import {Motion, Rules, QuizData, ArenaEvent} from './arena-motion.mjs';

const int = (value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const phasesWithAnswer = new Set(['drop','restore','between','end']);

export function configure(data,random=Math.random) {
  const s=data?.settings, q=data?.questions, title=data?.title;
  if (!s || typeof title!=='string' || !title.trim() || title.length>80 || !Array.isArray(q) || !int(q.length,1,50) ||
      !int(s.questionCount,1,q.length) || !int(s.reveal,1,30) || !int(s.move,3,60) ||
      ![1,3,5,'Infinity'].includes(s.lives) || (s.contact!==undefined&&typeof s.contact!=='boolean') || !['auto','manual'].includes(s.pace) ||
      !['ordered','random'].includes(s.questionOrder) || !['ordered','random'].includes(s.optionOrder)) return null;
  for (const row of q) {
    if (!Array.isArray(row)||row.length!==4||typeof row[0]!=='string'||!Array.isArray(row[1])||row[1].length!==4||
      row[1].some(value=>typeof value!=='string')||typeof row[3]!=='string'||QuizData.questionErrors(row).length) return null;
  }
  return {title,questions:QuizData.prepare(q,s,random),reveal:s.reveal*1000,move:s.move*1000,life:s.lives==='Infinity'?-1:s.lives,pace:s.pace,contact:s.contact===true,push:s.push===true,...ArenaEvent.settings(s)};
}

export function begin(config,students, now) {
  return {...config,id:crypto.randomUUID(),phase:'countdown',round:0,until:now+3000,
    roundKey:crypto.randomUUID(),players:students.map(p=>({id:p.id,slot:p.slot,name:p.name,color:p.color??0,hp:config.life})),
    answers:[],prior:[],winners:[],reason:null,event:null};
}

const alive = player=>player.hp!==0&&!player.out;

export function nextRound(game,now) {
  game.round++;
  game.roundKey=crypto.randomUUID();
  game.phase='question';
  game.until=now+game.reveal;
  game.event=null;
  game.answers=[];
  game.prior=[];
  for(const player of game.players){player.fallenAt=null;player.charged=false;}
}

export function charge(player) {
  if(player.charged||!alive(player))return;
  player.charged=true;
  if(player.hp>0)player.hp--;
}

export function drown(game,player,now) {
  if(!ArenaEvent.live(game.phase)||!alive(player)||player.fallenAt!=null)return false;
  player.fallenAt=now;
  charge(player);
  return true;
}

export function finish(game,now,winners,reason) {
  if(game.phase==='end')return false;
  const players=game.players.map(({slot,name,color,hp,out})=>({slot,name,color,hp,out:!!out}));
  Object.assign(game,{phase:'end',until:null,event:null,winners,reason,
    result:{id:game.id,players,winners,reason,ceremonyAt:winners.length?now:null}});
  return true;
}

export function replay(game,students,now) {
  const {title,questions,reveal,move,life,pace,contact,push,hazards}=game;
  const participants=new Set(game.players.map(player=>player.id));
  return begin({title,questions,reveal,move,life,pace,contact,push,hazards},
    students.filter(student=>participants.has(student.id)),now);
}

export function advance(game,now,position,random=Math.random) {
  if (game.until===null || now<game.until) return false;
  switch (game.phase) {
    case 'countdown':
      game.phase='question';game.until=now+game.reveal;break;
    case 'question':
      game.phase='move';game.until=now+game.move;game.event=ArenaEvent.choose(game.round,game,now,random,game.move);
      game.previousCombination=ArenaEvent.combination(game.event);break;
    case 'move': {
      const cutoff=game.until;
      game.phase='drop';game.revealAt=cutoff;game.dropAt=cutoff;
      game.until=cutoff+ArenaEvent.config.survival;
      game.prior=game.players.filter(alive).map(p=>p.slot);
      game.answers=game.players.filter(alive).map(p=>{
        const pose=position(p.slot);
        const choice=pose ? Rules.answerPad(Motion.position(pose)) : -1;
        return {slot:p.slot,choice,correct:choice===game.questions[game.round][2]};
      });
      for (const answer of game.answers) {
        const player=game.players.find(p=>p.slot===answer.slot);
        if (!answer.correct) charge(player);
      }
      break;
    }
    case 'drop':
      game.phase='restore';game.restoreAt=now;game.until=now+ArenaEvent.config.restore;break;
    case 'restore': {
      game.event=null;
      const survivors=game.players.filter(alive);
      if (survivors.length<=1 || game.round+1===game.questions.length) {
        const winners=(survivors.length?survivors:game.players.filter(p=>!p.out&&game.prior.includes(p.slot))).map(p=>p.slot);
        finish(game,now,winners,survivors.length?'complete':'all-out');
      } else if (game.pace==='manual') {
        game.phase='between';game.until=null;
      } else nextRound(game,now);
      break;
    }
    default: return false;
  }
  return true;
}

export function viewMatch(game,teacher,now) {
  if (!game) return null;
  const show = phasesWithAnswer.has(game.phase);
  const [question,options,correct,explanation]=game.questions[game.round];
  const entry=game.phase==='countdown'?null:teacher||show?[question,options,correct,explanation]:[question,options];
  return {id:game.id,phase:game.phase,round:game.round,roundKey:game.roundKey,until:game.until,serverNow:now,
    total:game.questions.length,title:game.title,entry,contact:game.contact,push:game.push===true,pace:game.pace,dropAt:game.dropAt,revealAt:game.revealAt,
    players:game.players.map(({slot,name,hp,out,fallenAt})=>({slot,name,hp,out:!!out,fallenAt:fallenAt??null})),
    answers:show?game.answers:[],prior:show?game.prior:[],winners:game.winners,reason:game.reason,result:game.result??null,event:game.event,restoreAt:game.restoreAt};
}
