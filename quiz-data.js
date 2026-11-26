const QuizData=(()=>{
  const max=50;
  const headers=['문제','선택지 1','선택지 2','선택지 3','선택지 4','정답 번호','해설'];
  function text(value){return typeof value==='string'||typeof value==='number'?String(value).trim():'';}
  function questionErrors(entry){
    const errors=[];
    const title=text(entry[0]),choices=entry[1].map(text),correct=entry[2];
    if(!title)errors.push('문제를 입력하세요.');
    if(title.length>500)errors.push('문제는 500자 이내로 입력하세요.');
    choices.forEach((choice,index)=>{
      if(!choice)errors.push(`선택지 ${index+1}이 비어 있습니다.`);
      else if(choice.length>180)errors.push(`선택지 ${index+1}은 180자 이내로 입력하세요.`);
    });
    const nonempty=choices.filter(Boolean).map(v=>v.normalize('NFKC').toLowerCase());
    if(new Set(nonempty).size!==nonempty.length)errors.push('같은 선택지가 있습니다.');
    if(!Number.isInteger(correct)||correct<0||correct>3)errors.push('정답 번호는 1~4 중에서 선택하세요.');
    if(text(entry[3]).length>1200)errors.push('해설은 1,200자 이내로 입력하세요.');
    return errors;
  }
  function validate(draft){
    const errors=[];
    const title=text(draft.title);
    if(!title||title.length>80)errors.push('퀴즈 제목을 1~80자로 입력하세요.');
    if(!draft.entries.length||draft.entries.length>max)errors.push('문제는 1~50개까지 저장할 수 있습니다.');
    draft.entries.forEach((q,i)=>{
      for(const issue of questionErrors(q.entry))errors.push(`${q.row?`엑셀 ${q.row}행`:`${i+1}번 문제`} · ${issue}`);
    });
    return errors;
  }
  function fromExcel(rows,title){
    if(!rows.length||headers.some((header,i)=>text(rows[0].cells[i])!==header))throw Error('첫 행의 열 이름을 확인해 주세요. 엑셀 작성 양식을 이용하면 됩니다.');
    const entries=rows.slice(1).filter(row=>row.cells.some(v=>text(v)!=='')).map(({number,cells})=>{
      if(cells.slice(7).some(v=>text(v)!==''))throw Error(`엑셀 ${number}행 · 해설 열 뒤에 입력된 값이 있습니다.`);
      const answer=text(cells[5]);
      return {row:number,entry:[text(cells[0]),Array.from({length:4},(_,i)=>text(cells[i+1])),/^[1-4]$/.test(answer)?Number(answer)-1:-1,text(cells[6])]};
    });
    return {title,entries};
  }
  function decode(value){
    if(value?.version!==1||!['churrri-quiz','churrri-quizrun'].includes(value.format)||!Array.isArray(value.quizzes)||!value.quizzes.length||value.quizzes.length>100){
      throw Error('퀴즈왕 또는 퀴즈런에서 내보낸 JSON 파일을 선택해 주세요.');
    }
    return value.quizzes.map((quiz,i)=>{
      if(typeof quiz?.title!=='string'||!Array.isArray(quiz.questions)||quiz.questions.length>1000)throw Error(`파일의 ${i+1}번째 퀴즈에서 제목 또는 문제 목록을 읽을 수 없습니다.`);
      return {title:quiz.title,entries:quiz.questions.map((q,j)=>{
        if(typeof q?.text!=='string'||!Array.isArray(q.options)||q.options.length!==4||
            q.options.some(v=>!['string','number'].includes(typeof v)))throw Error(`${i+1}번째 퀴즈의 ${j+1}번 문제 또는 선택지 형식을 확인해 주세요.`);
        return {entry:[q.text,q.options.map(text),Number.isInteger(q.correct)?q.correct:-1,text(q.explanation)]};
      })};
    });
  }
  function backup(quiz){
    return {format:'churrri-quizrun',version:1,quizzes:[{title:quiz.title,questions:quiz.questions.map(([text,options,correct,explanation])=>({text,options,correct,explanation}))}]};
  }
  function shuffle(list,random){
    for(let i=list.length-1;i>0;i--){
      const j=Math.floor(random()*(i+1));
      [list[i],list[j]]=[list[j],list[i]];
    }
    return list;
  }
  function prepare(questions,settings,random=Math.random){
    const order=questions.slice();
    if(settings.questionOrder==='random')shuffle(order,random);
    const count=Math.max(1,Math.min(order.length,Math.trunc(Number(settings.questionCount))||order.length));
    return order.slice(0,count).map(([question,options,correct,explanation])=>{
      const indices=[0,1,2,3];
      if(settings.optionOrder==='random')shuffle(indices,random);
      return [question,indices.map(i=>options[i]),indices.indexOf(correct),explanation];
    });
  }
  return {max,headers,text,questionErrors,validate,fromExcel,decode,backup,prepare};
})();
if(typeof module!=='undefined')module.exports=QuizData;
