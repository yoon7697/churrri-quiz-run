import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acceptContactInput,contactActive,contactRow,solveContacts} from '../server/contact.mjs';
import {Motion,Rules} from '../server/arena-motion.mjs';

const target=(x,z,flags=0,y=Rules.surface(x,z))=>({pose:Motion.encode({x,y,z},0,flags),t:900,dx:1,dz:0});
test('online contact can be disabled and runs until judging',()=>{
  const game={phase:'move',contact:true,until:5000};
  assert.equal(contactActive(game,2999),true);
  assert.equal(contactActive(game,4999),true);
  assert.equal(contactActive(game,5000),false);
  assert.equal(contactActive({...game,contact:false},0),false);
  assert.equal(contactActive({...game,phase:'drop'},0),true);
});
test('bounded sprint displacement is stronger and ignores a high jumper',()=>{
  const compare=flag=>{
    const a=target(-.29,3,flag),b=target(.29,3);
    solveContacts([[0,a],[1,b]],1000,.1);
    return [Math.abs(a.ox),Math.abs(b.ox)];
  };
  const run=compare(1),sprint=compare(3);
  assert.ok(sprint[1]>run[1]);
  assert.ok([...run,...sprint].every(value=>value<=41));
  const jumper=target(-.2,3,4,1.2),ground=target(.2,3);
  assert.deepEqual(solveContacts([[0,jumper],[1,ground]],1000,.1),[]);
});
test('30 stacked students separate inside one correct pad without repeated excess correction',()=>{
  const actors=Array.from({length:30},(_,slot)=>[slot,target(-11.5,-9.45)]);
  for(let i=0;i<40;i++) {
    const prior=actors.map(([,state])=>state.pose);
    solveContacts(actors,1000+i*100,.1);
    actors.forEach(([,state],slot)=>{
      const old=prior[slot];
      assert.ok(Math.hypot(old[0]-state.pose[0],old[2]-state.pose[2])<42);
    });
  }
  assert.equal(new Set(actors.map(([,state])=>state.pose.slice(0,3).join('|'))).size,30);
  assert.ok(actors.every(([,state])=>Rules.answerPad(Motion.position(state.pose))===0));
  const state=actors[0][1],row=contactRow(0,state);
  const command=state.pose.slice();command[0]-=state.ox;command[2]-=state.oz;
  assert.equal(row.length,8);
  assert.deepEqual(acceptContactInput(command,state),state.pose);
  assert.equal(acceptContactInput([9999,0,9999,0,0],state),null);
});
