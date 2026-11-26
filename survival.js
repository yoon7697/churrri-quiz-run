const SoloArenaEvent=typeof module==='undefined'?ArenaEvent:require('./arena-event.js');
const sampleQuestions=[
  ['대한민국의 수도는 어디일까요?', ['부산','서울','대전','제주'],1,'서울은 대한민국의 수도입니다.'],
  ['7 × 8의 값은?', ['56','48','54','64'],0,'7을 8번 더하면 56입니다.'],
  ['식물이 광합성을 할 때 흡수하는 기체는?', ['산소','질소','수소','이산화 탄소'],3,'식물은 빛을 이용해 물과 이산화 탄소로 양분을 만듭니다.'],
  ['한글을 창제한 왕은?', ['태조','정조','세종','고종'],2,'세종 때 훈민정음이 창제되었습니다.'],
  ['지구에서 가장 넓은 바다는?', ['태평양','대서양','인도양','북극해'],0,'태평양은 지구에서 가장 넓은 바다입니다.'],
  ['삼각형의 세 내각의 합은?', ['90°','270°','180°','360°'],2,'평면 위 삼각형의 세 내각의 합은 180°입니다.'],
  ['다음 중 별(항성)은?', ['달','태양','화성','목성'],1,'태양은 스스로 빛을 내는 항성입니다.'],
  ['물 1L는 몇 mL일까요?', ['10','100','500','1000'],3,'1리터는 1000밀리리터입니다.'],
  ['다음 중 포유류는?', ['상어','문어','돌고래','거북'],2,'돌고래는 폐로 숨을 쉬고 새끼에게 젖을 먹이는 포유류입니다.'],
  ['5의 제곱은?', ['25','10','15','20'],0,'5의 제곱은 5 × 5 = 25입니다.'],
];

function createSurvival(questions=sampleQuestions, random=Math.random){
  const state={phase:'idle', round:0, until:0, lives:[], choices:[], previous:[], fallen:[], charged:[], winners:[], spectator:0, lost:false};
  function open(now){
    state.phase='question';state.until=now+state.reveal;state.choices=[];state.lost=false;state.event=null;state.charged=[];state.fallen=[];
  }
  function start(now,{reveal=3,move=15,lives=3,contact=true,push=false,bots=29,...options}={}){
    Object.assign(state,{round:0,reveal,move,contact,push,...SoloArenaEvent.settings(options),lives:Array(bots+1).fill(lives),winners:[],endedAt:null,returning:[],previous:[],spectator:0,previousCombination:null});
    open(now);
  }
  function charge(index){
    if(state.charged[index]||!state.lives[index])return;
    state.charged[index]=true;
    if(state.lives[index]!==Infinity)state.lives[index]--;
  }
  function drown(index,now){
    if(!SoloArenaEvent.live(state.phase)||!state.lives[index]||state.fallen[index]!=null)return;
    state.fallen[index]=now;
    charge(index);
  }
  function next(now,readAnswer,readBotAnswer){
    if(now<state.until)return false;
    const correct=questions[state.round][2];
    if(state.phase==='question'){
      state.phase='move';state.until=now+state.move;
      state.event=SoloArenaEvent.choose(state.round,state,now*1000,random,state.move*1000);
      state.previousCombination=SoloArenaEvent.combination(state.event);
      state.choices=state.lives.map((hp,i)=>!i||hp===0?-1:random()<.65?correct:((correct+1+Math.floor(random()*3))%4));
    }else if(state.phase==='move'){
      const cutoff=state.until;
      state.phase='drop';state.revealAt=cutoff;state.dropAt=cutoff;
      state.until=cutoff+SoloArenaEvent.config.survival/1000;
      state.previous=state.lives.slice();
      state.choices[0]=state.previous[0]>0?readAnswer():-1;
      if(readBotAnswer)for(let i=1;i<state.choices.length;i++){
        state.choices[i]=state.previous[i]>0?readBotAnswer(i):-1;
      }
      state.lost=state.previous[0]>0 && state.choices[0]!==correct;
      state.lives.forEach((_,i)=>{if(state.choices[i]!==correct)charge(i);});
    }else if(state.phase==='drop'){
      state.phase='restore';state.restoreAt=now;state.until=now+SoloArenaEvent.config.restore/1000;
    }else if(state.phase==='restore'){
      state.event=null;
      state.returning=state.fallen.slice();
      const alive=state.lives.flatMap((hp,i)=>hp>0?[i]:[]);
      if(alive.length<=1 || state.round===questions.length-1){
        state.phase='end';state.endedAt=now*1000;state.winners=alive.length?alive:state.previous.flatMap((hp,i)=>hp>0?[i]:[]);
      }else{state.round++;open(now);}
    }else return false;
    if(state.lives[0]===0&&!state.lives[state.spectator])state.spectator=Math.max(0,state.lives.findIndex(hp=>hp>0));
    return true;
  }
  function spectate(direction){
    const alive=state.lives.flatMap((hp,i)=>hp>0?[i]:[]);
    if(!alive.length)return;
    const index=alive.indexOf(state.spectator);
    state.spectator=alive[(index+direction+alive.length)%alive.length];
  }
  return {state,start,next,drown,spectate,question:()=>questions[state.round],total:questions.length};
}
if(typeof module!=='undefined')module.exports=createSurvival;
