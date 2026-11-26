const CharacterContact=((config)=>{
  function enabled(state,now,freePlayEnabled){
    return !state||state.phase==='idle'?freePlayEnabled:
      state.contact&&(state.phase==='drop'||state.phase==='move'&&now<state.until);
  }

  // Two bounded position passes handle crowds without storing impulses or changing vertical velocity.
  function resolve(bodies,dt,canStand){
    const limit=config.maxContactOffsetPerSecond*dt;
    const budget=bodies.map(body=>Math.max(0,limit-(body.pushUsed||0)));
    function displace(index,x,z,amount){
      const body=bodies[index].position;
      const step=Math.min(amount,budget[index]);
      if(step<=0||!canStand(body.x+x*step,body.z+z*step))return;
      body.x+=x*step;body.z+=z*step;budget[index]-=step;
    }
    for(let pass=0;pass<2;pass++){
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
        if(budget[i]+budget[j]<=0)continue;
        const a=bodies[i],b=bodies[j],p=a.position,q=b.position;
        if(Math.abs(p.y-q.y)>config.contactHeight)continue;
        const dx=q.x-p.x,dz=q.z-p.z,squared=dx*dx+dz*dz;
        if(squared>=config.contactDiameter**2)continue;
        const d=Math.sqrt(squared),angle=(i+1)*2.399+j;
        const nx=d>1e-7?dx/d:Math.cos(angle),nz=d>1e-7?dz/d:Math.sin(angle);
        const sprint=(a.sprinting&&a.dx*nx+a.dz*nz>.3?1:0)-(b.sprinting&&b.dx*nx+b.dz*nz<-.3?1:0);
        const overlap=config.contactDiameter-d;
        displace(i,-nx,-nz,overlap*(.48-sprint*.20));
        displace(j,nx,nz,overlap*(.48+sprint*.20));
      }
    }
  }
  return {enabled,resolve};
})(typeof module==='undefined'?MovementConfig:require('./movement-config.js'));
if(typeof module!=='undefined')module.exports=CharacterContact;
