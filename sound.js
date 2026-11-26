// Original short synthesized cues. Entries are [offset, duration, pitch, end pitch].
const QuizSound=(()=>{
  const key='quizrun-sound';
  const cues={
    start:[[0,.11,523,660],[.10,.14,784,880]],
    round:[[0,.11,659,784]],
    tick:[[0,.075,790,620]],
    jump:[[0,.13,330,670]],
    bump:[[0,.10,175,87],[.025,.055,300,185]],
    warning:[[0,.15,430,285]],
    splash:[[0,.19,490,108],[.044,.13,250,130]],
    answer:[[0,.105,587,587],[.11,.105,740,740],[.22,.16,988,988]],
    life:[[.16,.12,380,320],[.29,.15,290,190]],
    end:[[0,.13,523,490],[.13,.22,440,390]],
    win:[[0,.11,523,523],[.095,.11,659,659],[.19,.125,784,784],[.31,.25,1047,1047]],
  };
  const cooldown={bump:540,splash:850,jump:200,warning:400,tick:400};
  function preference(storage){
    try{return storage().getItem(key)==='on';}catch{return false;}
  }
  function player({storage,Context,now=()=>performance.now()}){
    let enabled=preference(storage),context,volume;
    const last=new Map();
    function unlock(){
      if(!enabled||!Context)return;
      try{
        if(!context){
          context=new Context();
          volume=context.createGain();
          volume.gain.value=.26;
          volume.connect(context.destination);
        }
        if(context.state!=='running')context.resume().catch(()=>{});
      }catch{}
    }
    function set(next){
      enabled=next===true;
      try{storage().setItem(key,enabled?'on':'off');}catch{}
      if(volume)volume.gain.value=enabled?.26:0;
      if(enabled)unlock();
    }
    function play(name){
      if(!enabled||context?.state!=='running'||!Object.hasOwn(cues,name))return false;
      const time=now();
      if(time-(last.get(name)??-Infinity)<(cooldown[name]??350))return false;
      last.set(name,time);
      for(const [offset,length,from,to] of cues[name]){
        const at=context.currentTime+offset;
        const tone=context.createOscillator(),envelope=context.createGain();
        tone.type=['splash','warning','bump'].includes(name)?'triangle':'sine';
        tone.frequency.setValueAtTime(from,at);
        if(to!==from)tone.frequency.exponentialRampToValueAtTime(to,at+length);
        envelope.gain.setValueAtTime(.001,at);
        envelope.gain.linearRampToValueAtTime(name==='tick'?.09:.17,at+.013);
        envelope.gain.exponentialRampToValueAtTime(.001,at+length);
        tone.connect(envelope);envelope.connect(volume);
        tone.onended=()=>{tone.disconnect();envelope.disconnect();};
        tone.start(at);tone.stop(at+length+.015);
      }
      return true;
    }
    return {get enabled(){return enabled;},set,unlock,play};
  }
  function bind(button,read,toggle){
    const refresh=()=>{
      const enabled=read();
      button.textContent=enabled?'🔊 소리 ON':'🔇 소리 OFF';
      button.setAttribute('aria-pressed',String(enabled));
    };
    button.addEventListener('click',()=>{toggle();refresh();});
    refresh();
    return refresh;
  }
  function local(){
    return player({storage:()=>window.localStorage,Context:window.AudioContext||window.webkitAudioContext});
  }
  function unlockOnGesture(unlock){
    document.addEventListener('pointerup',unlock,true);
    document.addEventListener('keydown',event=>{if(!event.repeat)unlock();},true);
  }
  function arena(config){
    const button=document.getElementById('sound-game');
    if(!config){
      const sound=local();
      bind(button,()=>sound.enabled,()=>sound.set(!sound.enabled));
      unlockOnGesture(sound.unlock);
      return sound.play;
    }
    let enabled=config.sound===true;
    const send=(action,value)=>parent.postMessage({type:'quizrun-sound',action,value},'*');
    const refresh=bind(button,()=>enabled,()=>send('set',!enabled));
    addEventListener('message',event=>{
      if(event.source!==parent||event.data?.type!=='quizrun-sound-state')return;
      enabled=event.data.enabled===true;
      refresh();
    });
    unlockOnGesture(()=>{if(enabled)send('unlock');});
    return name=>{if(enabled)send('play',name);};
  }

  function sequence(play){
    let previous;
    function reset(){previous=undefined;}
    function sync({id,phase,round,life,fallen,winner,remaining,flood}){
      const same=!!previous&&previous.id===id;
      const enteredPhase=!same||phase!==previous.phase||round!==previous.round;
      if(enteredPhase){
        if((!same||previous.phase==='idle')&&['countdown','question'].includes(phase))play('start');
        if(phase==='question')play('round');
        if(phase==='drop'&&same)play('answer');
        if(phase==='end'&&same)play(winner?'win':'end');
      }
      if(same&&life<previous.life)play('life');
      if(same&&fallen&&!previous.fallen)play('splash');
      if(flood&&(enteredPhase||flood!==previous.flood))play('warning');
      if(!flood&&phase==='move'&&remaining>=1&&remaining<=3&&(enteredPhase||remaining!==previous.remaining))play('tick');
      previous={id,phase,round,life,fallen,remaining,flood};
    }
    return {sync,reset};
  }
  return {player,bind,local,unlockOnGesture,arena,sequence};
})();
if(typeof module!=='undefined')module.exports=QuizSound;
