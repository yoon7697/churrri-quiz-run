// The same winner snapshots are staged locally, with the server clock supplying animation age.
function buildCeremony(T,host,scene,camera,maps,rabbit,suitColors,software){
  const stage=new T.Group();
  stage.visible=false;
  scene.add(stage);
  const mat=(color)=>new T.MeshStandardMaterial({color,roughness:.65});
  function cylinder(upper,lower,height,color,y){
    const piece=new T.Mesh(new T.CylinderGeometry(upper,lower,height,40),mat(color));
    piece.position.y=y;
    return piece;
  }
  const podium=new T.Group();
  podium.add(cylinder(1,1.06,.58,'#6939bb',.29),
    cylinder(1.025,1.025,.18,'#ffce54',.65),
    cylinder(.98,1,.19,'#a376ef',.83));
  stage.add(podium);
  const height=1.55;
  const shape=new T.OctahedronGeometry(.15,0);
  const palette=['#ffe77a','#ff86c8','#7debe6','#ba9aff','#ffac65'];
  const materials=palette.map(mat);
  // Only a few particles are needed at the software fallback's resolution.
  const sparks=Array.from({length:software?18:40},(_,i)=>{
    const mesh=new T.Mesh(shape,materials[i%materials.length]);stage.add(mesh);return mesh;
  });
  const names=document.createElement('div');
  names.className='ceremony-names';names.hidden=true;host.append(names);
  const plane=new T.PlaneGeometry(2.54,2.54);
  const spriteMaterials=QuizResults.palette.map((_,i)=>new T.MeshBasicMaterial({map:maps[i*4],transparent:true,alphaTest:.15}));
  const point=new T.Vector3(),eye=new T.Vector3(),target=new T.Vector3();
  let current,avatars=[];
  const radius=1.50;
  podium.scale.set(radius,1,radius);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function prepare(result){
    for(const {model} of avatars)stage.remove(model);
    names.replaceChildren();
    const winners=QuizResults.winners(result);
    const count=winners.length;
    const outer=count>12?Math.min(19,Math.ceil(count*.63)):count;
    const inner=count-outer;
    const size=count===1?.875:count<=4?.70:count<=8?.50:count<=12?.35:.24;
    const fullModels=!software&&winners.length<=4;

    avatars=winners.map((row,i)=>{
      const color=row.color??0;
      const model=fullModels?rabbit.clone(true):new T.Mesh(plane,spriteMaterials[color]);
      if(fullModels){
        model.traverse(part=>{
          if(part.isMesh&&part.material.name==='Jersey'){
            part.material=part.material.clone();
            part.material.color.set(suitColors[color]);
          }
        });
      }
      model.scale.setScalar(size);
      const perimeter=i<outer;
      const ring=count===1?0:perimeter?(count<=4?.86:1.18):.64;
      const angle=Math.PI*2*(perimeter?i/outer:(i-outer+.5)/inner)+Math.PI/2;
      const x=Math.cos(angle)*ring,z=Math.sin(angle)*ring;
      const tag=document.createElement('span');
      tag.textContent=row.name;tag.title=row.name;
      tag.style.setProperty('--winner-color',QuizResults.palette[color]);
      names.append(tag);stage.add(model);
      return {model,tag,x,z,fullModels,size};
    });
  }
  return frame=>{
    stage.visible=!!frame;names.hidden=!frame;
    if(!frame)return;
    if(current!==frame.result){current=frame.result;prepare(current);}
    const t=frame.elapsed/1000,scale=Math.min(1,Math.max(.1,t/.55));
    podium.scale.y=height*(reduce?1:1-(1-scale)**3);
    const span=7.8/Math.min(1,camera.aspect);
    eye.set(0,3.3+span*.34,span);
    target.set(0,1.95,0);
    camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld();
    for(const [i,{model,tag,x,z,fullModels,size}] of avatars.entries()){
      const hop=reduce?0:.16*Math.max(0,Math.sin(t*5-i*.68));
      const base=.93*podium.scale.y+hop;
      model.position.set(x,base+(fullModels?0:1.177*size),z);
      if(!fullModels)model.quaternion.copy(camera.quaternion);
      point.set(x,base+2.15*size,z).project(camera);
      tag.style.left=(50+point.x*50)+'%';tag.style.top=(50-point.y*50)+'%';
    }
    sparks.forEach((mesh,i)=>{
      const burst=i%2,elapsed=t-(burst?.96:.34);
      const progress=(elapsed-(i%5)*.05)/(i%3===0?1.25:2.7);
      mesh.visible=!reduce&&progress>=0&&progress<1;
      if(!mesh.visible)return;
      const a=i*2.399,far=1.1+progress*(3.4+i%5*.42);
      const spread=i%3===0?1:1.25;
      mesh.position.set((burst?1:-1)*radius+Math.cos(a)*far*spread,
        1.25+Math.sin(progress*Math.PI)*(i%3===0?5:3)+Math.sin(a)*far*.48,
        Math.sin(a)*far*.80);
      mesh.rotation.set(t+i,t*2+i,a);
      mesh.scale.setScalar(Math.max(.05,1-progress*.9));
      if(i%3===1)mesh.scale.z*=.27;
    });
  };
}
