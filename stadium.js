function buildStadium(T,scene,padTemplate,software){
  const sea=buildSea(T,scene,software);
  const root=new T.Group();scene.add(root);root.scale.set(Rules.scale,1,Rules.scale);
  const deckCenter=new T.Group(),deckLinks=new T.Group(),padGroups=[],trim=[];
  deckCenter.name="center pontoon";deckLinks.name="link pontoons";root.add(deckLinks,deckCenter);
  const mat=new Map(),blockers=[];
  function material(color){
    if(!mat.has(color))mat.set(color,new T.MeshStandardMaterial({color,roughness:.27}));
    return mat.get(color);
  }
  function part(geo,color,x,y,z,parent=root){
    const m=new T.Mesh(geo,material(color));m.position.set(x,y,z);parent.add(m);return m;
  }
  function texture(canvas){const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;return map;}
  function graphic(canvas,w,h,x,y,z,flat=false){
    const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:texture(canvas),transparent:true,alphaTest:.08}));
    m.position.set(x,y,z);if(flat)m.rotation.x=-Math.PI/2;root.add(m);return m;
  }
  function slab(w,d,h,r,corners=[r,r,r,r]){
    const sh=new T.Shape(),x=w/2,z=d/2,[tl,tr,br,bl]=corners;
    sh.moveTo(-x+tl,-z);sh.lineTo(x-tr,-z);sh.quadraticCurveTo(x,-z,x,-z+tr);
    sh.lineTo(x,z-br);sh.quadraticCurveTo(x,z,x-br,z);sh.lineTo(-x+bl,z);
    sh.quadraticCurveTo(-x,z,-x,z-bl);sh.lineTo(-x,-z+tl);sh.quadraticCurveTo(-x,-z,-x+tl,-z);
    const geo=new T.ExtrudeGeometry(sh,{depth:h,bevelEnabled:true,bevelSize:.23,bevelThickness:.20,bevelSegments:3,curveSegments:5});geo.rotateX(-Math.PI/2);return geo;
  }
  function tube(a,b,r,color){
    const v=new T.Vector3(...a),to=new T.Vector3(...b),dir=to.clone().sub(v),m=part(new T.CylinderGeometry(r,r,dir.length(),16),color,0,0,0);
    m.position.copy(v).lerp(to,.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize());return m;
  }
  const orb=new T.SphereGeometry(1,16,10);
  function ball(x,y,z,sx,sy,sz,col){const m=part(orb,col,x,y,z);m.scale.set(sx,sy,sz);return m;}
  const {edgeX,edgeZ,coreX,coreZ}=Rules.deck;
  const limitsX=[-edgeX,-coreX,coreX,edgeX],limitsZ=[-edgeZ,-coreZ,coreZ,edgeZ];
  function coating(width,depth,light,corner){
    return ArenaArt.sheet(320,320,g=>{
      const paint=g.createLinearGradient(3,8,320,320);
      paint.addColorStop(0,light?'#c9f5f4':'#acdced');
      paint.addColorStop(.52,light?'#a5dfea':'#8dbfdd');
      paint.addColorStop(1,light?'#8bbddf':'#749bcf');
      g.beginPath();g.roundRect(0,0,320,320,corner.map(r=>r*320/width));g.clip();
      g.fillStyle=paint;g.fillRect(0,0,320,320);
      g.strokeStyle='#e6ffffa8';g.lineWidth=2;g.strokeRect(5,5,310,310);
      g.strokeStyle='#466c9d4b';g.lineWidth=1;g.strokeRect(9,9,302,302);
      const nx=Math.max(2,Math.round(width*1.4)),nz=Math.max(2,Math.round(depth*1.4));
      for(let x=1;x<nx;x++)for(let z=1;z<nz;z++){
        const u=x*320/nx,v=z*320/nz;
        g.fillStyle='#365e8a29';g.fillRect(u,v,1.8,1.8);
        g.fillStyle='#f1fffc53';g.fillRect(u,v+2,1.8,1.2);
      }
    });
  }
  for(let ix=0;ix<3;ix++)for(let iz=0;iz<3;iz++){
    const width=limitsX[ix+1]-limitsX[ix],depth=limitsZ[iz+1]-limitsZ[iz];
    const x=limitsX[ix]+width/2,z=limitsZ[iz]+depth/2;
    const parent=ix===1&&iz===1?deckCenter:deckLinks;
    const bright=ix===1||iz===1;
    // Shape coordinates reverse the deck's Z axis after extrusion.
    const corners=[ix===0&&iz===2,ix===2&&iz===2,ix===2&&iz===0,ix===0&&iz===0].map(outer=>outer?3.5:.24);
    part(slab(width-.52,depth-.52,.26,.57,corners),'#357eaf',x,-1.20,z,parent);
    part(slab(width-.52,depth-.52,.83,.57,corners),bright?'#81c2de':'#76abdc',x,-1.04,z,parent).receiveShadow=true;
    const face=graphic(coating(width,depth,bright,[corners[3],corners[2],corners[1],corners[0]]),width-.14,depth-.14,x,0,z,true);
    parent.add(face);
  }
  for(const [x,z] of [[-20,-18],[20,-18],[-20,18],[20,18],[-21,0],[21,0],[0,-19],[0,19]]){
    const float=part(slab(2.7,2.5,.80,.58),'#58a4bb',x,-2.25,z,deckLinks);
    float.receiveShadow=true;
    part(slab(2.8,2.6,.16,.62),'#c1f0ec',x,-1.64,z,deckLinks);
  }
  for(const [i,[x,z]] of Rules.pads.entries()){
    const pad=padTemplate.clone(true);pad.name='answer-'+(i+1);pad.scale.set(Rules.halfX/Rules.scale,4.15,Rules.halfZ/Rules.scale);pad.position.set(x/Rules.scale,Rules.top-.033*4.15,z/Rules.scale);padGroups.push(pad);
    const [color,dark]=ArenaArt.palette[i];const map=texture(ArenaArt.pad(i));
    pad.traverse(m=>{if(!m.isMesh)return;
      const old=m.material.name;m.material=m.material.clone();
      if(old==='Landing face'){
        const pos=m.geometry.attributes.position,uv=[];for(let v=0;v<pos.count;v++)uv.push(.5+pos.getX(v)/2,.5-pos.getZ(v)/2);
        m.geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));m.material.map=map;m.material.color.set('#ffffff');
      }else{
        m.material.color.set(old==='Shell'?dark:'#ffe5af');
        if(old==='Champagne trim')trim[i]=m.material;
      }
      m.receiveShadow=true;
    });root.add(pad);
  }
  for(const [r,h,y,c] of [[2.25,.22,.10,'#ffb93e'],[2.1,.15,.24,'#ffebbc'],[1.88,.1,.34,'#a05ce1']]){
    part(new T.CylinderGeometry(r,r+.06,h,48),c,0,y,0,deckCenter);
  }
  deckCenter.add(graphic(ArenaArt.emblem(),3.73,3.73,0,.401,0,true));
  const gold='#ffbb30',orchid='#9560d9',rose='#f565b6';
  function rails(x1,z1,x2,z2,segments){
    for(let j=0;j<segments;j++){
      const u=j/segments,v=(j+1)/segments;const x=x1+(x2-x1)*u,z=z1+(z2-z1)*u,X=x1+(x2-x1)*v,Z=z1+(z2-z1)*v;
      for(const [y,r,c] of [[.17,.24,rose],[.54,.16,'#ffad35'],[1.23,.27,gold]])blockers.push(tube([x,y,z],[X,y,Z],r,c));
      blockers.push(part(new T.CapsuleGeometry(.40,.92,4,12),j%2?orchid:'#d271df',x,.80,z));
    }
  }
  rails(-21.7,-19.8,21.7,-19.8,8);rails(21.7,-19.8,21.7,19.8,7);rails(21.7,19.8,-21.7,19.8,8);rails(-21.7,19.8,-21.7,-19.8,7);
  // Continuous padded housing around the recessed LED panel.
  const sign=new T.Group();sign.scale.set(1.42,1,1.17);sign.position.set(0,5.05,-22.1);sign.rotation.x=Math.PI/2;root.add(sign);
  part(slab(17,6.6,.8,1.4),'#e15bc9',0,-.7,0,sign);
  part(slab(16.35,6.12,.3,1.2),'#8356c7',0,.14,0,sign);
  const screen=graphic(ArenaArt.board(),22.5,6.55,0,5.05,-21.40);
  let previousEntry=null,previousAnswer=-1;
  const sparkleShape=new T.Shape();
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,r=i%2?.29:1;
    if(i===0)sparkleShape.moveTo(r,0);
    else sparkleShape.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);
  }
  sparkleShape.closePath();
  const sparkleGeometry=new T.ShapeGeometry(sparkleShape);
  const sparkleMaterial=new T.MeshBasicMaterial({color:'#fff0a5',side:T.DoubleSide});
  const stars=Array.from({length:20},()=>{
    const star=new T.Mesh(sparkleGeometry,sparkleMaterial);root.add(star);star.visible=false;return star;
  });
  const champagne=new T.Color('#ffe5af'),whiteGold=new T.Color('#fffde2');

  const halo=ArenaArt.sheet(64,64,g=>{const r=g.createRadialGradient(32,32,0,32,32,31);
    r.addColorStop(0,'#ffffdf');r.addColorStop(.37,'#fff9cfff');r.addColorStop(.59,'#ffd68893');r.addColorStop(1,'#ffd18800');g.fillStyle=r;g.fillRect(0,0,64,64);});
  const glow=new T.MeshBasicMaterial({map:texture(halo),transparent:true,depthWrite:false});
  for(const s of [-1,1]){
    const path=new T.CatmullRomCurve3([[s*6,1,-23.4],[s*10,2.5,-23.4],[s*12,4.0,-23.4],[s*14,1,-23.4]].map(p=>new T.Vector3(...p)));
    part(new T.TubeGeometry(path,22,.56,12,false),'#ff8bbf',0,0,0);
    tube([s*6,0,-22],[s*6,4,-22],.59,orchid);
    for(const [z,y] of [[-19.6,7.6],[15,6.2]]){
      const x=s*(z<0?16.8:21.3);
      const unit=new T.Group();unit.position.set(x,y,z);unit.scale.setScalar(z<0?1.65:1.0);
      const lower=z>0;
      unit.rotation.order='YXZ';
      unit.rotation.y=lower?Math.atan2(-x,-z):-s*.48;
      if(lower)unit.rotation.x=Math.atan2(y,Math.hypot(x,z));
      root.add(unit);
      if(lower){
        // Anchor the upright post to the bottom of the tilted housing.
        unit.updateMatrix();
        const mount=new T.Vector3(0,-1.01,-.19).applyMatrix4(unit.matrix);
        const jointY=mount.y-.26;
        tube([x,.1,z],[x,jointY,z],.4,orchid);
        tube([x,jointY,z],mount.toArray(),.35,orchid);
        ball(x,jointY,z,.4,.40,.4,orchid);
      }else{
        tube([x,.1,z],[x,y,z],.4,orchid);
      }
      tube([x,.5,z],[x,1.1,z],.58,'#ffcc68');
      const back=new T.Group();back.rotation.x=Math.PI/2;unit.add(back);part(slab(3.2,2.18,.5,.37),'#a55ac7',0,-.45,0,back);
      for(const col of [-1,0,1])for(const row of [-1,1]){
        const lamp=part(orb,'#ffcd65',col*.92,row*.47,.25,unit);lamp.scale.set(.45,.45,.25);
        const bulb=part(orb,'#fff8dd',col*.92,row*.47,.43,unit);bulb.scale.set(.35,.35,.14);bulb.material.emissive.setHex(0xffde92);bulb.material.emissiveIntensity=.52;
        const flare=new T.Mesh(new T.PlaneGeometry(1.05,1.05),glow);flare.position.set(col*.92,row*.47,.54);unit.add(flare);
      }
    }
  }
  const flagCanvas=c=>ArenaArt.sheet(96,134,g=>{g.fillStyle=c;g.beginPath();g.moveTo(0,0);g.lineTo(96,0);g.lineTo(96,133);g.lineTo(48,112);g.lineTo(0,133);g.fill();ArenaArt.crown(g,48,64,21,'#ffeabd');});
  const flags=[];
  for(const s of [-1,1]){
    tube([s*21.4,6.5,-19.5],[s*21.4,5.65,15],.12,gold);
    for(let k=0;k<7;k++){
      const z=-16+k*4.6,f=graphic(flagCanvas(k%2?'#9764de':'#f473b5'),1.9,2.25,s*21.38,5.27-k*.105,z);
      f.rotation.y=-s*1.12;f.material.side=T.DoubleSide;flags.push([f,f.rotation.y]);
    }
  }
  for(let i=0;i<10;i++){
    const a=i*2.4,r=50+(i%3)*9,x=r*Math.cos(a),z=r*Math.sin(a),y=5+(i%5)*2.75;
    for(const [ox,oy,rx,ry] of [[0,0,3,1.3],[-2,-.15,2,1],[1.4,.75,1.65,1.45],[3,-.1,1.75,.95]])ball(x+ox,y+oy,z,rx,ry,1.65,'#f8fbff');
  }
  root.updateMatrixWorld(true);for(const m of blockers)m.geometry.computeBoundingSphere();
  return {blockers,surfaces:{water:sea.water,pads:padGroups,center:deckCenter,links:deckLinks},
    update(entry,correct,elapsed,revealTime,restore,restoreAnswer){
      if(entry!==previousEntry||correct!==previousAnswer){
        screen.material.map.dispose();
        screen.material.map=texture(ArenaArt.board(entry,correct));
        previousEntry=entry;previousAnswer=correct;
      }
      trim.forEach((material,i)=>{
        const pulse=i===correct?.58+.42*Math.sin(revealTime*10):0;
        material.color.copy(champagne).lerp(whiteGold,pulse);
        material.emissive.setHex(0xffca61);material.emissiveIntensity=pulse*.75;
      });
      const pad=padGroups[correct];
      stars.forEach((star,i)=>{
        star.visible=!!pad;
        if(!pad)return;
        const phase=(revealTime*.85+i*.137)%1;
        const angle=i*Math.PI*2/stars.length;
        star.position.set(pad.position.x+Math.cos(angle)*(4.6+phase*2.4),1.18+phase*2.8,pad.position.z+Math.sin(angle)*(3.9+phase*1.7));
        star.rotation.set(-.35,i*.64+revealTime*2,phase*2);
        star.scale.setScalar((.23+i%4*.10)*Math.sin(Math.PI*phase));
      });
      const depth=elapsed>0?Rules.sink(elapsed):restore;
      const safe=elapsed>0?correct:restoreAnswer;
      deckCenter.position.y=-depth;
      deckLinks.position.y=-depth;
      padGroups.forEach((m,i)=>{
        m.position.y=Rules.top-.033*4.15-(i===safe?0:depth);
      });
    },
    animate(t,elapsed,correct,points,camera){
      flags.forEach(([m,a],i)=>m.rotation.y=a+.11*Math.sin(t*1.7+i));
      sea.animate(t,elapsed,correct,points,camera);
    }};
}
