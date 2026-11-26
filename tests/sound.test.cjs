const test=require('node:test');
const assert=require('node:assert/strict');
const Sound=require('../sound.js');

test('starts muted, uses gesture unlock, persists and rate limits impacts',()=>{
  const values=new Map();
  const storage=()=>({getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)});
  const pitches=[],contexts=[];
  const param=()=>({setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  class Context {
    state='suspended';currentTime=2;destination={};
    constructor(){contexts.push(this);}
    createGain(){return {gain:param(),connect(){},disconnect(){}};}
    createOscillator(){return {frequency:{...param(),setValueAtTime:value=>pitches.push(value)},connect(){},start(){},stop(){}};}
    async resume(){this.state='running';}
  }
  let now=0;
  const sound=Sound.player({storage,Context,now:()=>now});
  sound.unlock();
  assert.equal(sound.play('jump'),false);
  assert.equal(contexts.length,0);
  sound.set(true);
  assert.equal(contexts.length,1);
  assert.ok(sound.play('bump'));
  for(now=16;now<540;now+=16)assert.equal(sound.play('bump'),false);
  assert.ok(sound.play('bump'));
  assert.equal(pitches.length,4);
  const reopened=Sound.player({storage,Context});
  assert.equal(reopened.enabled,true);
  assert.equal(reopened.play('answer'),false);
  reopened.unlock();
  assert.ok(reopened.play('answer'));
  reopened.set(false);
  assert.equal(reopened.play('answer'),false);
  assert.equal(Sound.player({storage,Context}).enabled,false);
});

test('authoritative snapshots cue phase transitions and only the local life or fall',()=>{
  const sounds=[];
  const sequence=Sound.sequence(cue=>sounds.push(cue));
  let state={id:'game',phase:'countdown',round:0,life:3,remaining:3,flood:0};
  const sync=patch=>{state={...state,...patch};sequence.sync(state);};
  sync({});sync({});
  sync({phase:'question'});
  sync({phase:'move',remaining:3,flood:3});
  sync({flood:2,remaining:2});sync({});
  sync({flood:1,remaining:1});sync({});
  sync({phase:'drop',flood:0,life:2});sync({});sync({fallen:true});sync({});
  sync({phase:'end',winner:true});
  assert.deepEqual(sounds,['start','round','warning','warning','warning','answer','life','splash','win']);

  sounds.length=0;
  sequence.reset();
  sync({id:'rejoined',phase:'move',life:1,fallen:false,remaining:3});
  sync({remaining:2});sync({remaining:1});sync({});
  sync({phase:'end',winner:false});
  assert.deepEqual(sounds,['tick','tick','tick','end']);
});
