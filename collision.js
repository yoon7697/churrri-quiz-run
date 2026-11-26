// Five parallel probes cover the camera near plane. Static world bounds reject distant geometry.
function createCameraCollision(T,meshes){
  const bounds=meshes.map(mesh=>mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld));
  const ray=new T.Raycaster(),origin=new T.Vector3(),right=new T.Vector3(),up=new T.Vector3(),hits=[];
  return function limit(pivot,axis,length,aspect){
    right.set(axis.z,0,-axis.x).normalize();up.crossVectors(axis,right).normalize();
    const halfH=.22,halfW=Math.min(.8,halfH*aspect);
    for(const [x,y] of [[0,0],[-1,1],[1,1],[-1,-1],[1,-1]]){
      origin.copy(pivot).addScaledVector(right,x*halfW).addScaledVector(up,y*halfH);
      ray.set(origin,axis);ray.far=length+.4;
      for(let i=0;i<meshes.length;i++){
        const sphere=bounds[i],range=ray.far+sphere.radius;
        if(origin.distanceToSquared(sphere.center)>range*range||!ray.ray.intersectsSphere(sphere))continue;
        hits.length=0;ray.intersectObject(meshes[i],false,hits);
        if(hits.length){length=Math.min(length,Math.max(.08,hits[0].distance-.38));ray.far=length+.38;}
      }
    }
    return length;
  };
}
if(typeof module!=='undefined')module.exports=createCameraCollision;
