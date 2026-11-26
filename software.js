// Low-resolution perspective rasterizer for browsers without a WebGL context.
// All triangles share a depth buffer, including the near-clipped foreground floor.
function softwareRenderer(){
  const T=THREE,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  const cache=new WeakMap();
  const view=new T.Matrix4(),normal=new T.Matrix3(),light=new T.Vector3(-.45,.82,.35).normalize();
  const fog=[191,224,239],textures=new WeakMap();
  let w,h,image,depth,sky,fx,fy;
  function texture(map){
    if(!map)return null;
    if(!textures.has(map)){const c=map.image; textures.set(map,c.getContext('2d').getImageData(0,0,c.width,c.height));}
    return textures.get(map);
  }
  function cut(poly){
    const out=[];let a=poly[poly.length-1];
    for(const b of poly){
      if((a[2]>.3)!==(b[2]>.3)){const t=(.3-a[2])/(b[2]-a[2]);out.push(a.map((v,j)=>v+t*(b[j]-v)));}
      if(b[2]>.3)out.push(b);a=b;
    }return out;
  }
  function triangle(a,b,c,color,tex,double,opacity,ocean){
    const pts=[a,b,c].map(v=>{const q=1/v[2];return [w*.5+v[0]*fx*q,h*.5-v[1]*fy*q,q,v[3],v[4]*q,v[5]*q,v[6]];});
    const [A,B,C]=pts,det=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);
    if(Math.abs(det)<.025||(!double&&det>0))return;
    const x0=Math.max(0,Math.ceil(Math.min(A[0],B[0],C[0]))),x1=Math.min(w-1,Math.floor(Math.max(A[0],B[0],C[0])));
    const y0=Math.max(0,Math.ceil(Math.min(A[1],B[1],C[1]))),y1=Math.min(h-1,Math.floor(Math.max(A[1],B[1],C[1])));
    const bx=(C[1]-A[1])/det,by=(A[0]-C[0])/det,cx=(A[1]-B[1])/det,cy=(B[0]-A[0])/det;
    const triangleHaze=Math.max(0,Math.min(.78,((a[2]+b[2]+c[2])/3-49)/150));
    for(let y=y0;y<=y1;y++){
      let wb=(x0-A[0])*bx+(y-A[1])*by,wc=(x0-A[0])*cx+(y-A[1])*cy;
      for(let x=x0;x<=x1;x++,wb+=bx,wc+=cx){
        const wa=1-wb-wc;if(Math.min(wa,wb,wc)<-.00002)continue;
        const q=wa*A[2]+wb*B[2]+wc*C[2],idx=y*w+x;if(q<depth[idx])continue;
        const shade=wa*A[3]+wb*B[3]+wc*C[3];let alpha=opacity,r=color[0],g=color[1],bl=color[2];
        if(tex){
          const u=(wa*A[4]+wb*B[4]+wc*C[4])/q,v=(wa*A[5]+wb*B[5]+wc*C[5])/q;
          const ti=4*(Math.min(tex.height-1,Math.max(0,((1-v)*tex.height)|0))*tex.width+Math.min(tex.width-1,Math.max(0,(u*tex.width)|0)));
          alpha*=tex.data[ti+3]/255;if(alpha<.02)continue;r=tex.data[ti];g=tex.data[ti+1];bl=tex.data[ti+2];
        }
        const haze=ocean?Math.max(0,Math.min(.92,(1/q-34)/104)):triangleHaze;
        if(alpha>.96)depth[idx]=q;const o=idx*4,k=shade*(1-haze),glint=wa*A[6]+wb*B[6]+wc*C[6];
        image.data[o]=(r*k+glint+fog[0]*haze)*alpha+image.data[o]*(1-alpha);image.data[o+1]=(g*k+glint+fog[1]*haze)*alpha+image.data[o+1]*(1-alpha);image.data[o+2]=(bl*k+glint+fog[2]*haze)*alpha+image.data[o+2]*(1-alpha);
      }
    }
  }
  return {software:true,domElement:canvas,setPixelRatio(){},setSize(width,height){
    const s=Math.min(1,760/width,500/height);w=canvas.width=Math.max(1,Math.round(width*s));h=canvas.height=Math.max(1,Math.round(height*s));
    image=ctx.createImageData(w,h);depth=new Float32Array(w*h);const grad=ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'#66a9fb');grad.addColorStop(.54,'#a3e3fc');grad.addColorStop(1,'#c7eefa');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);sky=ctx.getImageData(0,0,w,h);
  },render(scene,camera){
    if(!w)return;scene.updateMatrixWorld();camera.updateMatrixWorld();image.data.set(sky.data);depth.fill(0);
    fy=h*.5/Math.tan(camera.fov*Math.PI/360);fx=fy;
    const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    scene.traverseVisible(m=>{
      if(!m.isMesh||!frustum.intersectsObject(m))return;
      const geo=m.geometry,pos=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv;
      view.multiplyMatrices(camera.matrixWorldInverse,m.matrixWorld);
      const e=view.elements,col=m.material.color.getHex(),color=[col>>16,(col>>8)&255,col&255],tex=texture(m.material.map);
      let entry=cache.get(m);
      if(!entry){entry={verts:Array.from({length:pos.count},()=>new Float64Array(7)),basis:[],normVersion:-1};cache.set(m,entry);}
      const verts=entry.verts,wm=m.matrixWorld.elements;
      const lit=entry.normVersion!==n.version||[0,1,2,4,5,6,8,9,10].some(k=>entry.basis[k]!==wm[k]);
      if(lit){normal.getNormalMatrix(m.matrixWorld);entry.basis=wm.slice();entry.normVersion=n.version;}
      const l=normal.elements;
      for(let i=0;i<pos.count;i++){
        const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),v=verts[i];
        v[0]=e[0]*x+e[4]*y+e[8]*z+e[12];v[1]=e[1]*x+e[5]*y+e[9]*z+e[13];v[2]=-(e[2]*x+e[6]*y+e[10]*z+e[14]);
        if(lit){
          const nx=n.getX(i),ny=n.getY(i),nz=n.getZ(i),vx=l[0]*nx+l[3]*ny+l[6]*nz,vy=l[1]*nx+l[4]*ny+l[7]*nz,vz=l[2]*nx+l[5]*ny+l[8]*nz;
          const inv=1/(Math.hypot(vx,vy,vz)||1),lam=(vx*light.x+vy*light.y+vz*light.z)*inv;
          const reflection=Math.max(0,(vx*-.28+vy*.84+vz*.46)*inv);
          v[6]=m.material.isMeshBasicMaterial?0:Math.pow(reflection,24)*83;
          v[3]=m.material.isMeshBasicMaterial?1:.70+.34*Math.max(0,lam)+.07*vy*inv;v[4]=uv?.getX(i)||0;v[5]=uv?.getY(i)||0;
        }
      }
      const ids=geo.index?.array,count=ids?ids.length:verts.length;
      for(let j=0;j<count;j+=3){const a=verts[ids?ids[j]:j],b=verts[ids?ids[j+1]:j+1],c=verts[ids?ids[j+2]:j+2];
        if(Math.min(a[2],b[2],c[2])>.3)triangle(a,b,c,color,tex,m.material.side===T.DoubleSide,m.material.opacity,m.userData.ocean);
        else if(Math.max(a[2],b[2],c[2])>.3){const p=cut([a,b,c]);for(let k=1;k<p.length-1;k++)triangle(p[0],p[k],p[k+1],color,tex,true,m.material.opacity,m.userData.ocean);}
      }
    });ctx.putImageData(image,0,0);
  }};
}
