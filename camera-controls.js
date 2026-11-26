// Both views use the same horizontal axes. Only a drag on the world changes yaw.
function createCameraControls(world){
  let yaw=0,targetYaw=0,pitch=.48,targetPitch=.48,dragId=null,lastX=0,lastY=0;
  function endDrag(e){
    if(dragId===null || (e.pointerId!==undefined && e.pointerId!==dragId))return;
    const id=dragId;
    dragId=null;
    if(world.hasPointerCapture(id))world.releasePointerCapture(id);
  }
  world.addEventListener('pointerdown',e=>{
    if(dragId!==null || e.button!==0)return;
    dragId=e.pointerId;lastX=e.clientX;lastY=e.clientY;
    world.setPointerCapture(dragId);
  });
  world.addEventListener('pointermove',e=>{
    if(e.pointerId!==dragId)return;
    const delta=e.clientX-lastX;lastX=e.clientX;
    targetYaw-=delta*Math.PI/Math.max(240,world.clientWidth*.5);
    targetPitch=Math.max(.075,Math.min(1.19,targetPitch+(e.clientY-lastY)*2.4/Math.max(320,world.clientHeight||600)));lastY=e.clientY;
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])world.addEventListener(event,endDrag);
  window.addEventListener('blur',endDrag);
  document.addEventListener('visibilitychange',endDrag);
  return {
    get yaw(){return yaw;},get pitch(){return pitch;},
    advance(dt){const k=1-Math.exp(-19*dt);yaw+=(targetYaw-yaw)*k;pitch+=(targetPitch-pitch)*k;},
    direction(x,z){
      const sin=Math.sin(yaw),cos=Math.cos(yaw);
      return [x*cos+z*sin,-x*sin+z*cos];
    }
  };
}
if(typeof module!=='undefined')module.exports=createCameraControls;
