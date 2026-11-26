// The controllable rabbit occupies seat 30. No network or round state is needed.
const Participants=((Rules)=>{
  const count=30;
  function seat(i,zone){
    const [x,z]=Rules.pads[zone];
    return [x-5+(i%6)*2,z-3.8+Math.floor(i/6)*1.9];
  }
  function formation(i){return seat(i,0);}
  function scattered(i){
    const zone=i%4,k=Math.floor(i/4),[x,z]=Rules.pads[zone];
    const points=[[-5,-3.6],[4.5,3.2],[-1,-4.7],[5.7,-3.4],[-5.4,2.9],[1.3,4.4],[3,-.6],[-2,.3]];
    if(i%6===1)return [((Math.floor(i/6)%3)-1)*1.05,-14+i*.82];
    return [x+points[k][0],z+points[k][1]];
  }
  return {count,formation,scattered,seat};
})(typeof module==='undefined'?Rules:require('./rules.js'));
if(typeof module!=='undefined')module.exports=Participants;
