function buildSpongeBars(T,scene,template){
  const {radius,halfHeight,barY}=ArenaEvent.config;
  const source=template.getObjectByName('Sponge bar').children[0];
  const paints={z:[.96,.52,.09],spin:[.92,.20,.47]};
  const hub=new T.MeshStandardMaterial({color:'#9a62e7',roughness:.43});
  const materials=new Map(),geometries=new Map();
  source.geometry.computeBoundingBox();
  const referenceHalf=source.geometry.boundingBox.max.x-radius;

  function surface(key){
    if(!materials.has(key)){
      if(key==='x'){
        materials.set(key,source.material);
      }else{
        const sourceMap=source.material.map.image;
        const canvas=document.createElement('canvas');
        canvas.width=sourceMap.width;canvas.height=sourceMap.height;
        const context=canvas.getContext('2d');
        context.drawImage(sourceMap,0,0);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height);
        const [r,g,b]=paints[key];
        for(let i=0;i<pixels.data.length;i+=4){
          const red=pixels.data[i],green=pixels.data[i+1],blue=pixels.data[i+2];
          const tint=Math.max(0,Math.min(1,(green-red-32)/60));
          const light=green+18;
          pixels.data[i]=red+(light*r-red)*tint;
          pixels.data[i+1]=green+(light*g-green)*tint;
          pixels.data[i+2]=blue+(light*b-blue)*tint;
        }
        context.putImageData(pixels,0,0);
        const map=new T.CanvasTexture(canvas);
        map.colorSpace=T.SRGBColorSpace;
        const material=source.material.clone();
        material.map=map;
        materials.set(key,material);
      }
    }
    return materials.get(key);
  }

  function geometry(half){
    if(!geometries.has(half)){
      const shape=source.geometry.clone();
      const positions=shape.attributes.position;
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),extent=Math.abs(x);
        // Stretch the panel section and translate the caps at full radius.
        // This matches ArenaEvent.frame for all three physical shaft lengths.
        positions.setX(i,Math.sign(x)*(extent<=referenceHalf+1e-5?
          extent/referenceHalf*half:half+extent-referenceHalf));
      }
      shape.computeBoundingBox();
      shape.computeBoundingSphere();
      geometries.set(half,shape);
    }
    return geometries.get(half);
  }

  function model(){
    const group=new T.Group(),axle=new T.Group();
    const cushion=new T.Mesh(source.geometry,source.material);
    cushion.position.y=barY;group.add(cushion,axle);scene.add(group);
    group.visible=false;
    const baseY=Rules.deck.water-.15;
    const stem=new T.Mesh(new T.CylinderGeometry(.34,.51,barY-baseY,16),hub);
    stem.position.y=(barY+baseY)/2;axle.add(stem);
    const cap=new T.Mesh(new T.SphereGeometry(1,16,10),hub);
    cap.position.y=barY;cap.scale.set(.53,halfHeight,.53);axle.add(cap);
    return (event,now,exitAt)=>{
      const bar=ArenaEvent.display(event,now,exitAt);
      group.visible=!!bar;
      if(!bar)return;
      const spin=event.kind==='spin';
      cushion.material=surface(spin?'spin':event.axis);
      cushion.geometry=geometry(bar.half);
      axle.visible=spin;
      group.position.set(bar.x,bar.y||0,bar.z);
      cushion.rotation.y=-Math.atan2(bar.dz,bar.dx);
    };
  }
  const draws=[model(),model(),model()];
  return (event,now,exitAt)=>{
    const bars=ArenaEvent.pieces(event);
    draws.forEach((draw,i)=>draw(bars[i],now,exitAt));
  };
}
