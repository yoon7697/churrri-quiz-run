function buildSea(T,scene,software) {
  let seed=854;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const water=new T.Group();
  water.position.y=Rules.deck.water;
  scene.add(water);
  const map=(canvas)=>{
    const texture=new T.CanvasTexture(canvas);
    texture.colorSpace=T.SRGBColorSpace;
    return texture;
  };
  const oceanCanvas=ArenaArt.sheet(1024,1024,(g,w,h)=>{
    const gradient=g.createLinearGradient(100,0,w-100,h);
    gradient.addColorStop(0,'#27b9de');
    gradient.addColorStop(.38,'#149ac6');
    gradient.addColorStop(.72,'#087baa');
    gradient.addColorStop(1,'#07658d');
    g.fillStyle=gradient;
    g.fillRect(0,0,w,h);
    g.lineCap='round';
    for(let i=0;i<6500;i++){
      const x=noise()*w,y=noise()*h,l=3+noise()**3*27;
      g.strokeStyle=i%5===0?'#e7fff8a0':i%3===0?'#035e934a':'#6ce7ef48';
      g.lineWidth=.40+noise()*1.11;
      g.beginPath();
      g.moveTo(x,y);
      g.quadraticCurveTo(x+l*.55,y-(noise()-.25)*2.4,x+l,y+.7);
      g.stroke();
    }
    const sun=g.createRadialGradient(575,350,5,575,350,185);
    sun.addColorStop(0,'#d2ffde48');sun.addColorStop(1,'#cffff700');
    g.fillStyle=sun;g.fillRect(385,160,380,380);
  });
  const ocean=new T.Mesh(new T.PlaneGeometry(600,600),new T.MeshBasicMaterial({map:map(oceanCanvas)}));
  ocean.userData.ocean=true;
  ocean.rotation.x=-Math.PI/2;
  water.add(ocean);
  const detailCanvas=ArenaArt.sheet(768,768,(g,w,h)=>{
    for(let i=0;i<1450;i++){
      const x=noise()*w,y=noise()*h,l=2+noise()**2*20;
      const feather=Math.sin(Math.PI*x/w)*Math.sin(Math.PI*y/h);
      g.strokeStyle=`rgba(184,255,247,${.5*feather*noise()})`;
      g.lineWidth=.45+noise()*.8;g.lineCap='round';
      g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+l*.5,y-1,x+l,y+.3);g.stroke();
    }
  });
  const rippleTexture=map(detailCanvas);
  const detail=new T.Mesh(new T.PlaneGeometry(132,119),new T.MeshBasicMaterial({map:rippleTexture,transparent:true,depthWrite:false}));
  detail.rotation.x=-Math.PI/2;detail.position.y=.012;water.add(detail);detail.visible=!software;
  const shade=ArenaArt.sheet(192,192,(g,w,h)=>{
    const shadow=g.createRadialGradient(96,96,34,96,96,96);
    shadow.addColorStop(0,'#01476c7c');shadow.addColorStop(.77,'#03587d39');shadow.addColorStop(1,'#03587d00');
    g.fillStyle=shadow;g.fillRect(0,0,w,h);
  });
  const shadow=new T.Mesh(new T.PlaneGeometry(76,68),new T.MeshBasicMaterial({map:map(shade),transparent:true,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.position.set(0,.022,1.2);water.add(shadow);shadow.visible=!software;
  const foamGeometry=new T.RingGeometry(.88,1,38);
  const foam=Array.from({length:11},()=>{
    const ring=new T.Mesh(foamGeometry,new T.MeshBasicMaterial({color:'#d3fff9',transparent:true,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.visible=false;water.add(ring);return ring;
  });
  const splashTexture=map(ArenaArt.sheet(96,96,(g)=>{
    for(const [x,y,r] of [[18,67,7],[35,46,9],[67,53,7],[49,67,11],[79,71,4],[57,25,5]]){
      g.beginPath();g.ellipse(x,y,r*.58,r,0,0,Math.PI*2);g.fillStyle='#ebfff7d9';g.fill();
    }
  }));
  const splashes=Array.from({length:9},()=>{
    const mesh=new T.Mesh(new T.PlaneGeometry(2.4,2.4),new T.MeshBasicMaterial({
      map:splashTexture,transparent:true,side:T.DoubleSide,depthWrite:false
    }));
    mesh.visible=false;water.add(mesh);return mesh;
  });
  function animate(time,elapsed,correct,points,camera){
    detail.position.x=Math.sin(time*.29)*2.9;
    detail.position.z=Math.cos(time*.24)*1.35;
    detail.material.opacity=.64+.20*Math.sin(time*.71);
    const locations=Rules.pads.flatMap(([x,z],i)=>i===correct?[]:[[x,z,3.9,.63]]);
    if(correct>=0)locations.push([0,0,8.6,.70]);
    for(const {x,z,age} of points.slice(0,7))locations.push([x,z,1.45,elapsed-age]);
    foam.forEach((ring,i)=>{
      const point=locations[i];
      const progress=point ? (elapsed-point[3])/1.22 : -1;
      ring.visible=correct>=0&&progress>=0&&progress<1;
      if(!ring.visible)return;
      ring.position.set(point[0],.036+i*.001,point[1]);
      const scale=point[2]*(.65+.78*progress);
      ring.scale.set(scale,scale*.85,1);
      ring.material.opacity=.52*(1-progress)**1.55;
    });
    splashes.forEach((mesh,i)=>{
      const point=points[i] || (i>=7?{x:i===7?-11:11,z:0,y:0}:null);
      const progress=point?(point.age??(elapsed-.77))/.67:-1;
      mesh.visible=correct>=0&&progress>=0&&progress<1;
      if(!mesh.visible)return;
      mesh.position.set(point.x,.34+Math.sin(Math.PI*progress)*.84,point.z);
      mesh.scale.setScalar(.65+progress*.65);
      mesh.rotation.y=Math.atan2(camera.position.x-point.x,camera.position.z-point.z);
      mesh.material.opacity=1-progress;
    });
  }
  return {water,animate};
}
