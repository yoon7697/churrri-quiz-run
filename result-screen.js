const QuizResults=(()=>{
  const duration=5200;
  const colors=['보라','분홍','민트','노랑'];
  const palette=['#7957df','#e64a8a','#159d89','#d99518'];
  const winners=result=>result.players.filter(row=>result.winners.includes(row.slot));
  function title(result){
    return result.winners.length>1?'공동 우승!':result.winners.length?'우승!':'우승자 없음';
  }
  function age(result,clock){
    return result?.ceremonyAt==null?Infinity:Math.max(0,clock-result.ceremonyAt);
  }
  function render(host,result,note){
    host.replaceChildren();
    function add(parent,tag,text,className){
      const el=document.createElement(tag);
      el.textContent=text;
      if(className)el.className=className;
      parent.append(el);
      return el;
    }
    add(host,'p','경기 결과','result-kicker');
    add(host,'h2',title(result));
    const names=winners(result).map(row=>row.name);
    if(names.length)add(host,'p',names.join(', '),'result-winners');
    else if(result.reason==='stopped')add(host,'p','선생님이 경기를 종료했어요.');
    if(note)add(host,'p',note,'result-note');
    const table=add(host,'table','','result-table');
    table.setAttribute('aria-label','전체 참가자 최종 결과');
    const heading=add(table.createTHead(),'tr','');
    for(const name of ['참가자','최종 상태','남은 목숨']){
      add(heading,'th',name).scope='col';
    }
    const body=table.createTBody();
    const win=new Set(result.winners);
    for(const row of result.players){
      const tr=body.insertRow(),name=add(tr,'th','');
      name.scope='row';
      const swatch=add(name,'i','','result-swatch');
      swatch.style.backgroundColor=palette[row.color]??palette[0];
      swatch.setAttribute('aria-hidden','true');
      name.append(row.name);
      if(win.has(row.slot))add(name,'span','우승','result-badge');
      add(tr,'td',row.out?'이탈':row.hp===0?'탈락':'생존');
      add(tr,'td',row.hp===-1?'무제한':String(row.hp));
    }
  }
  function arena(actions){
    const panel=document.getElementById('match-results'),banner=document.getElementById('ceremony-banner');
    let current,shown=false;
    return (result,clock)=>{
      if(result!==current){
        current=result;shown=false;
        if(result){
          banner.textContent='👑 '+title(result);
          render(panel,result,actions?null:'선생님의 다음 진행을 기다리고 있어요.');
          if(actions){
            const controls=document.createElement('div');
            controls.className='result-actions';
            for(const [title,click] of actions){
              const button=document.createElement('button');button.type='button';button.textContent=title;
              button.onclick=click;controls.append(button);
            }
            panel.append(controls);
          }
          panel.scrollTop=0;
        }
      }
      const elapsed=age(result,clock);
      shown||=!!result&&elapsed>=duration;
      const ceremony=!!result&&!shown;
      banner.hidden=!ceremony;
      panel.hidden=!shown;
      return ceremony?{result,elapsed}:null;
    };
  }
  return {age,arena,colors,duration,palette,render,winners};
})();
