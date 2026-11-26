const MovementConfig=Object.freeze({
  previousSpeed:5.7,
  runMultiplier:1.17,
  sprintMultiplier:1.5,
  contactDiameter:.86,
  maxContactOffsetPerSecond:4,
  contactHeight:.73,
});
if(typeof module!=='undefined')module.exports=MovementConfig;
