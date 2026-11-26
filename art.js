const ArenaArt=(()=>{
  const palette=[['#ff53b7','#c32a87','#ff94d3'],['#ffcc35','#df8a16','#ffe17b'],['#45bdff','#187bda','#8ddfff'],['#b768ff','#8538cd','#d29bff']];
  function sheet(w,h,paint){const c=document.createElement('canvas');c.width=w;c.height=h;paint(c.getContext('2d'),w,h);return c;}
  function round(g,x,y,w,h,r,fill){g.fillStyle=fill;g.beginPath();g.roundRect(x,y,w,h,r);g.fill();}
  function crown(g,x,y,size,color){g.save();g.translate(x,y);g.scale(size,size);g.fillStyle=color;g.beginPath();for(const [a,b] of [[-1,-.45],[-.49,-.15],[0,-.79],[.49,-.15],[1,-.45],[.8,.48],[-.8,.48]])g.lineTo(a,b);g.closePath();g.fill();g.restore();}
  function pad(i){return sheet(512,512,(g,w,h)=>{
    const [base,,light]=palette[i];const grad=g.createLinearGradient(40,0,380,h);grad.addColorStop(0,light);grad.addColorStop(.52,base);grad.addColorStop(1,base);g.fillStyle=grad;g.fillRect(0,0,w,h);
    g.translate(256,256);g.transform(1,0,-.065,1,0,0);g.font='1000 340px system-ui, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#ffffff';g.fillText(String(i+1),0,-10);
  });}
  function floor(){return sheet(1024,960,(g,w,h)=>{
    g.fillStyle='#6455a2';g.fillRect(0,0,w,h);
    for(let j=0;j<8;j++)for(let i=0;i<8;i++){
      const x=i*128,y=j*120,grad=g.createLinearGradient(x,y,x+100,y+115);
      grad.addColorStop(0,['#b3b7fe','#ada9fb','#b1afff'][(i+2*j)%3]);grad.addColorStop(.52,'#a6a1f2');grad.addColorStop(1,'#9394ea');
      round(g,x+3,y+3,122,114,8,grad);g.strokeStyle='#d2d0ff';g.lineWidth=2;g.stroke();
      g.fillStyle='#6854a99c';for(const [a,b] of [[12,12],[116,12],[12,108],[116,108]]){g.beginPath();g.arc(x+a,y+b,2.5,0,7);g.fill();}
      for(let k=0;k<4;k++){g.fillStyle=k%2?'#48417a':'#e2b66e';g.fillRect(x+44+k*10,y+105,8,4);}
    }
    // Baked contact shadows keep each freestanding platform grounded on the tiled deck.
    for(const [x,z] of Rules.pads){
      const cx=w/2+x*w/(45*Rules.scale),cy=h/2+z*h/(41*Rules.scale);
      g.save();g.shadowColor='#55428cad';g.shadowBlur=12;g.shadowOffsetY=9;round(g,cx-159,cy-136,318,272,37,'#8177ce');g.restore();
    }
    g.strokeStyle='#d9ddff';g.lineJoin='round';g.lineCap='round';g.lineWidth=6;
    for(const y of [98,146,197,731,784,840])for(const x of [493,531]){g.beginPath();g.moveTo(x-7,y+4);g.lineTo(x,y);g.lineTo(x+7,y+4);g.stroke();}
    for(const x of [104,164,851,911]){g.save();g.translate(x,481);crown(g,0,0,12,'#d9d9ff');g.restore();}
  });}
  function emblem(){return sheet(256,256,(g)=>{let grad=g.createLinearGradient(0,0,0,256);grad.addColorStop(0,'#ca8aff');grad.addColorStop(1,'#8854dc');g.fillStyle=grad;g.beginPath();g.arc(128,128,126,0,2*Math.PI);g.fill();g.lineWidth=5;g.strokeStyle='#e6baff';g.stroke();crown(g,128,133,56,'#fff6da');});}
  function board(entry,correct=-1){
    return sheet(1536,528,(g,w,h)=>{
      const bg=g.createLinearGradient(0,0,w,h);
      bg.addColorStop(0,'#454392');bg.addColorStop(1,'#22245b');
      round(g,0,0,w,h,48,bg);
      g.textAlign='center';g.textBaseline='middle';
      g.fillStyle='#fff';
      const title=entry?entry[0]:'퀴즈 시작을 기다리는 중';
      g.font='900 86px system-ui';g.fillText(title,w/2,105,w-138);
      if(!entry)return;
      entry[1].forEach((answer,i)=>{
        const x=58+(i%2)*722,y=179+Math.floor(i/2)*155;
        round(g,x,y,698,132,28,i===correct?'#fff2ad':'#f7efff');
        round(g,x+20,y+20,96,92,24,palette[i][0]);
        g.fillStyle='#272459';g.font='950 66px system-ui';
        g.fillText(String(i+1),x+68,y+70);
        g.textAlign='left';g.font='850 70px system-ui';
        g.fillText(answer,x+144,y+71,525);g.textAlign='center';
      });
    });
  }
  return {palette,sheet,round,crown,pad,floor,emblem,board};
})();
