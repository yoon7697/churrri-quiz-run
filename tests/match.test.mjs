import assert from 'node:assert/strict';
import {test} from 'node:test';
import {configure,begin,advance,viewMatch,drown} from '../server/match.mjs';
import {ArenaEvent,Motion,Rules} from '../server/arena-motion.mjs';

const teachers={questionCount:2,reveal:3,move:15,lives:1,pace:'auto',questionOrder:'ordered',optionOrder:'ordered'};
const input={title:'교실',settings:teachers,questions:[['수도',['A','B','C','D'],2,'해설'],['나라',['가','나','다','라'],1,'설명']]};
const students=[{id:'first',slot:0,name:'A'},{id:'second',slot:1,name:'B'}];
const pose=(slot,air=0)=>{
  const [x,z]=Rules.pads[slot];
  return Motion.encode({x,y:Rules.top+air,z},0,air?4:0);
};

test('server draw order preserves right answer and does not mutate the authored quiz',()=>{
  const original=JSON.stringify(input);
  const prepared=configure({...input,settings:{...teachers,questionOrder:'random',optionOrder:'random'}},()=>0);
  assert.equal(prepared.questions[0][0],'나라');
  assert.equal(prepared.questions[0][1][prepared.questions[0][2]],'나');
  assert.equal(JSON.stringify(input),original);
  assert.equal(configure({...input,settings:{...teachers,move:0}}),null);
});

test('automatic advancement, exact cutoff, one deduction, and all-out final tie',()=>{
  const match=begin(configure(input),students,0);
  assert.equal(advance(match,2999,()=>null),false);
  for(const phase of ['question','move']){advance(match,match.until,()=>null);assert.equal(match.phase,phase);}
  assert.equal(viewMatch(match,false,0).entry.length,2);
  assert.equal(advance(match,match.until-1,()=>pose(1)),false);
  advance(match,match.until,slot=>pose(2,slot?.95:0));
  assert.ok(match.answers.every(a=>a.correct));
  for(let i=0;i<2;i++)advance(match,match.until,()=>null);
  assert.equal(match.round,1);
  assert.equal(match.phase,'question');
  for(let i=0;i<2;i++)advance(match,match.until,()=>pose(0));
  assert.ok(match.players.every(p=>p.hp===0));
  assert.equal(advance(match,match.until-1,()=>pose(1)),false);
  advance(match,match.until,()=>pose(1));
  assert.equal(match.phase,'restore');
  advance(match,match.until,()=>pose(1));
  assert.equal(match.reason,'all-out');
  assert.deepEqual(match.winners,[0,1]);
  assert.equal(advance(match,100000,()=>null),false);
});

test('a delayed final position can catch up within a bounded interval; instant teleports remain invalid',()=>{
  const before=[141,0,-216,157,1],after=[464,102,-766,314,0];
  assert.equal(Motion.plausible(before,after,100),false);
  assert.equal(Motion.plausible(before,after,900),true);
  assert.equal(Motion.plausible(before,[1541,0,-216,157,3],10_000),false);
});

test('correct survivor can fall, a wrong answer costs at most one life, and the last round waits for survival',()=>{
  const game=begin(configure({...input,settings:{...teachers,lives:3,questionCount:1}}),students,0);
  advance(game,game.until,()=>null);
  advance(game,game.until,()=>null);
  advance(game,game.until,slot=>pose(slot?0:2,.5));
  assert.equal(game.answers[0].correct,true);
  assert.equal(game.players[1].hp,2);
  assert.equal(drown(game,game.players[1],game.until-4),true);
  assert.equal(drown(game,game.players[1],game.until-3),false);
  assert.equal(game.players[1].hp,2);
  assert.equal(drown(game,game.players[0],game.until-2),true);
  assert.equal(game.players[0].hp,2);
  assert.equal(game.answers[0].correct,true);
  assert.deepEqual(game.winners,[]);
  advance(game,game.until);
  assert.equal(game.phase,'restore');
  advance(game,game.until);
  assert.equal(game.phase,'end');
});

test('cutoff sends the locked answer, charge and missing floor together even if the timer runs late',()=>{
  const game=begin(configure({...input,settings:{...teachers,lives:3}}),students,0);
  advance(game,game.until);
  advance(game,game.until);
  const cutoff=game.until;
  assert.equal(advance(game,cutoff-1,()=>pose(2)),false);
  advance(game,cutoff+78,slot=>pose(slot?2:1,.35));
  const view=viewMatch(game,false,cutoff+78);
  assert.equal(view.phase,'drop');
  assert.equal(view.dropAt,cutoff);
  assert.equal(view.revealAt,cutoff);
  assert.equal(view.until,cutoff+5000);
  assert.equal(view.players[0].hp,2);
  assert.equal(view.answers[0].choice,1);
  assert.equal(advance(game,cutoff+150,()=>pose(2)),false);
  assert.equal(drown(game,game.players[0],cutoff+600),true);
  assert.equal(game.answers[0].choice,1);
  assert.equal(game.players[0].hp,2);
});

test('12 server rounds renew the event for both views and clear it after restoration',()=>{
  const questions=Array.from({length:12},()=>input.questions[0]);
  const game=begin(configure({...input,questions,settings:{...teachers,questionCount:12,lives:'Infinity'}}),students,0);
  let rnd=125;
  const random=()=>((rnd=Math.imul(1664525,rnd)+1013904223>>>0)/4294967296);
  advance(game,game.until);
  let last=null;
  const kinds=new Set();
  for(let round=0;round<12;round++){
    advance(game,game.until,()=>null,random);
    const event=viewMatch(game,false,game.until).event;
    assert.deepEqual(event,viewMatch(game,true,game.until).event);
    if(round===0)assert.equal(event,null);
    if(round>0&&!last)assert.ok(event);
    if(event){
      assert.equal(event.start,event.cue+(event.kind==='flood'?3000:1000));
      assert.ok(event.cue>0);
      assert.notEqual(ArenaEvent.combination(event),ArenaEvent.combination(last));
      kinds.add(ArenaEvent.combination(event));
    }
    last=event;
    advance(game,game.until,()=>pose(2));
    assert.deepEqual(game.event,event);
    advance(game,game.until);
    assert.equal(game.phase,'restore');
    assert.deepEqual(game.event,event);
    advance(game,game.until);
    assert.equal(game.event,null);
  }
  assert.equal(game.phase,'end');
  assert.ok(kinds.size>=3);
});

test('one winner is announced only after the five-second survival and restore, with frozen results',()=>{
  const game=begin(configure({...input,settings:{...teachers,questionCount:1}}),[
    {...students[0],color:2},{...students[1],color:3},
  ],0);
  advance(game,game.until);
  advance(game,game.until);
  const cutoff=game.until;
  advance(game,cutoff,slot=>pose(slot?0:2));
  assert.equal(game.until,cutoff+5000);
  assert.equal(viewMatch(game,false,cutoff+4999).result,null);
  assert.equal(advance(game,cutoff+4999),false);
  advance(game,cutoff+5000);
  assert.equal(viewMatch(game,false,game.until-1).result,null);
  const end=game.until;
  advance(game,end);
  assert.deepEqual(game.result,{id:game.id,ceremonyAt:end,reason:'complete',winners:[0],players:[
    {slot:0,name:'A',color:2,hp:1,out:false},{slot:1,name:'B',color:3,hp:0,out:false},
  ]});
  game.players[0].name='new lobby name';
  assert.deepEqual(viewMatch(game,true,end).result,viewMatch(game,false,end+1000).result);
  assert.equal(viewMatch(game,false,end+1000).result.players[0].name,'A');
  assert.equal(advance(game,end+1000),false);
});
