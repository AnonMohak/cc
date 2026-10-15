/**
 * The intro's camera keys (introTimeline.js reads them), as data: t (s), r
 * (Rs), el (deg above the disc plane), az (deg, the disc turns toward
 * +azimuth), lead (deg the view turns from the hole toward the motion),
 * aimY (Rs: the aim point's height), roll (deg), fov (deg, vertical), exp
 * (exposure), sparse (0–1: inner gas thinned to clumps), haze, sat, ghost,
 * and look (introLook.js values for this key; eased between keys).
 *
 * Inside the film shots (introTimeline.js FILM_SCHEDULE) the keys sit at
 * measured clip frames, first solved from the measured shadow circles
 * (shotSolve.js), then fitted to the clip (scripts/fit-intro.mjs); between
 * the shots they are set by hand. Written by scripts/write-keys.mjs.
 */

export const CAMERA_KEYS = [
  // gap-dome: Gap → dome: the film's dolly zoom (inside the clear gap with a wide lens, back over the inner edge and up over the cloud tops as the lens narrows).
  {"t":0,"r":2.87,"el":-0.3471,"az":0,"lead":-11.77,"aimY":-0.66,"roll":0,"fov":90,"exp":0.0265,"sparse":1,"haze":0,"sat":0.5,"ghost":0,"look":{"CLUMP_HEIGHT":8.0775,"CLUMP_LO":0.686,"CLUMP_RAD":3.2486,"EMIT":20.4354,"SHEET_GLOW":1.7496,"RIM_CLUMP_LO":0.5304}},
  {"t":2.002,"r":2.76,"el":0.127,"az":2.4,"lead":-11.96,"aimY":-0.72,"roll":0,"fov":90,"exp":0.0441,"sparse":1,"haze":0,"sat":0.5,"ghost":0,"look":{"CLUMP_HEIGHT":8.0775,"CLUMP_LO":0.686,"CLUMP_RAD":3.2486,"EMIT":20.4354,"SHEET_GLOW":1.7496,"RIM_CLUMP_LO":0.5304}},
  {"t":3.003,"r":2.89,"el":0.4118,"az":3.6,"lead":-12.15,"aimY":-0.71,"roll":0,"fov":84,"exp":0.3507,"sparse":1,"haze":0,"sat":0.5,"ghost":0,"look":{"CLUMP_HEIGHT":8.0775,"CLUMP_LO":0.686,"CLUMP_RAD":3.2486,"EMIT":20.4354,"SHEET_GLOW":1.7496,"RIM_CLUMP_LO":0.5304}},
  {"t":3.754,"r":3.98,"el":1.5,"az":4.5,"lead":-10.07,"aimY":-0.68,"roll":0,"fov":60,"exp":0.5,"sparse":0.8,"haze":0,"sat":0.5,"ghost":0},
  {"t":4.254,"r":5.88,"el":3.5,"az":5.1,"lead":-7.48,"aimY":-0.76,"roll":0,"fov":42,"exp":0.213,"sparse":0.3,"haze":0,"sat":1,"ghost":0,"look":{"SMOKE_COOL":[0.0151,0,0.0147],"LIGHT_GAIN":3.9997,"EMIT":4.6705,"EMIT_POWER":4.963,"EMIT_DEPTH":3,"SHEET_GLOW":6,"TAU":6.2908}},
  {"t":5.005,"r":7.75,"el":4.5,"az":6,"lead":-6.83,"aimY":-0.62,"roll":0,"fov":32,"exp":3.9665,"sparse":0,"haze":0,"sat":1,"ghost":0,"look":{"SMOKE_COOL":[0.0151,0,0.0147],"LIGHT_GAIN":3.9997,"EMIT":4.6705,"EMIT_POWER":4.963,"EMIT_DEPTH":3,"SHEET_GLOW":6,"TAU":6.2908}},
  {"t":6.256,"r":8.55,"el":5,"az":7.5,"lead":-6.88,"aimY":-0.69,"roll":0,"fov":28,"exp":4,"sparse":0,"haze":0,"sat":0.4,"ghost":0,"look":{"SMOKE_COOL":[0.0151,0,0.0147],"LIGHT_GAIN":3.9997,"EMIT":4.6705,"EMIT_POWER":4.963,"EMIT_DEPTH":3,"SHEET_GLOW":6,"TAU":6.2908}},
  // Move between the shots.
  {"t":9.7,"r":7,"el":4,"az":22,"lead":-20,"aimY":-0.3,"roll":0,"fov":50,"exp":1,"sparse":0,"haze":0,"sat":1,"ghost":0},
  // clouds: Low over the orange cloud tops toward the glow.
  {"t":13,"r":7.7019,"el":2.8065,"az":40,"lead":-29.7237,"aimY":-0.1284,"roll":0,"fov":60.3492,"exp":1.5074,"sparse":0,"haze":0,"sat":1,"ghost":0,"look":{"EMIT":18.1791,"EMIT_POWER":2.1977,"LIGHT_GAIN":2.7499,"TAU":4.5747}},
  // Move between the shots.
  {"t":15.42,"r":7.7019,"el":2.8065,"az":44,"lead":-29.7237,"aimY":-0.1284,"roll":0,"fov":60.3492,"exp":1.5074,"sparse":0,"haze":0,"sat":1,"ghost":0},
  {"t":18.5,"r":7.5,"el":4,"az":65,"lead":-40,"aimY":-1,"roll":0,"fov":60,"exp":2,"sparse":0,"haze":0,"sat":1,"ghost":0},
  // wall: The flame wall: the far disc bent up beside the shadow.
  {"t":21.6,"r":7.3415,"el":4.2268,"az":90,"lead":-36.6751,"aimY":-2.4317,"roll":0,"fov":61.1958,"exp":3.7976,"sparse":0,"haze":0,"sat":1.9,"ghost":1,"look":{"EMIT":13.1593,"EMIT_POWER":2.2141,"EMIT_DEPTH":0.2798,"FLAME":0.9722,"FLAME_DARK":0.9472,"LIGHT_GAIN":2.7359,"SMOKE_COOL":[0.0617,0.0649,0.1273],"TAU":4.7726,"SATURATION":1.0711}},
  {"t":26.104,"r":8.2246,"el":4.2268,"az":100,"lead":-49.2023,"aimY":-1.7294,"roll":0,"fov":61.1958,"exp":3.0344,"sparse":0,"haze":0,"sat":1.6,"ghost":1,"look":{"EMIT":13.1593,"EMIT_POWER":2.2141,"EMIT_DEPTH":0.2798,"FLAME":0.9722,"FLAME_DARK":0.9472,"LIGHT_GAIN":2.7359,"SMOKE_COOL":[0.0617,0.0649,0.1273],"TAU":4.7726,"SATURATION":1.0711}},
  {"t":30.609,"r":6.6232,"el":4.2268,"az":110,"lead":-50.379,"aimY":-1.2833,"roll":0,"fov":61.1958,"exp":1.7186,"sparse":0,"haze":0,"sat":1.7,"ghost":1,"look":{"EMIT":13.1593,"EMIT_POWER":2.2141,"EMIT_DEPTH":0.2798,"FLAME":0.9722,"FLAME_DARK":0.9472,"LIGHT_GAIN":2.7359,"SMOKE_COOL":[0.0617,0.0649,0.1273],"TAU":4.7726,"SATURATION":1.0711}},
  // Move between the shots.
  {"t":34,"r":7.5,"el":4,"az":140,"lead":-45,"aimY":-2,"roll":0,"fov":65,"exp":1,"sparse":0,"haze":0,"sat":1,"ghost":0},
  // skim: Skimming the cloud tops toward the shadow.
  {"t":38.101,"r":7.2422,"el":3.771,"az":170,"lead":-38.0764,"aimY":-5.5275,"roll":0,"fov":69.5453,"exp":1.7279,"sparse":0,"haze":0,"sat":0.8,"ghost":0,"look":{"EMIT":15.0366,"EMIT_POWER":1.5297,"LIGHT_GAIN":2.7069,"SMOKE_COOL":[0.0964,0.0346,0.1578],"TAU":4.6991,"SHUTTER_S":0.2352,"SATURATION":1.2634}},
  {"t":39.603,"r":5.9505,"el":3.771,"az":176,"lead":-37.9342,"aimY":-3.0086,"roll":0,"fov":69.5453,"exp":0.6537,"sparse":0,"haze":0,"sat":0.8,"ghost":0,"look":{"EMIT":15.0366,"EMIT_POWER":1.5297,"LIGHT_GAIN":2.7069,"SMOKE_COOL":[0.0964,0.0346,0.1578],"TAU":4.6991,"SHUTTER_S":0.2352,"SATURATION":1.2634}},
  {"t":40.854,"r":5.6788,"el":3.771,"az":182,"lead":-39.7496,"aimY":-0.3881,"roll":0,"fov":69.5453,"exp":0.7121,"sparse":0,"haze":0,"sat":0.8,"ghost":0,"look":{"EMIT":15.0366,"EMIT_POWER":1.5297,"LIGHT_GAIN":2.7069,"SMOKE_COOL":[0.0964,0.0346,0.1578],"TAU":4.6991,"SHUTTER_S":0.2352,"SATURATION":1.2634}},
  // Move between the shots.
  {"t":44.2,"r":5.2,"el":5,"az":190,"lead":-25,"aimY":1,"roll":0,"fov":65,"exp":1.2,"sparse":0,"haze":0,"sat":1,"ghost":0},
  // bright: Looking up into the bright bent light.
  {"t":47.4,"r":5.2219,"el":3.1432,"az":200,"lead":6.3648,"aimY":0.5385,"roll":0,"fov":63.8258,"exp":2.6068,"sparse":0,"haze":0,"sat":1,"ghost":0,"look":{"EMIT":20.8161,"EMIT_POWER":2.3777,"LIGHT_GAIN":2.8505}},
  // Move between the shots.
  {"t":50.03,"r":5.2219,"el":3.1432,"az":203,"lead":6.3648,"aimY":0.5385,"roll":0,"fov":63.8258,"exp":2.6068,"sparse":0,"haze":0,"sat":1,"ghost":0},
  // hole-far: The hole from farther away (it fades in over its first 0.8 s).
  {"t":52.751,"r":7.3793,"el":8.8944,"az":200.5,"lead":0.8451,"aimY":0.4924,"roll":0,"fov":58.5009,"exp":1.1374,"sparse":0,"haze":0,"sat":1,"ghost":0,"look":{"EMIT":26.3958,"EMIT_POWER":2.0318,"SHEET_GLOW":1.2024,"LIGHT_GAIN":2.2791}},
  {"t":56.296,"r":7.3793,"el":8.8944,"az":202,"lead":0.8451,"aimY":0.4924,"roll":0,"fov":58.5009,"exp":1.1374,"sparse":0,"haze":0,"sat":1,"ghost":0,"look":{"EMIT":26.3958,"EMIT_POWER":2.0318,"SHEET_GLOW":1.2024,"LIGHT_GAIN":2.2791}},
  // Move between the shots.
  {"t":57,"r":4,"el":8,"az":210,"lead":0,"aimY":0,"roll":0,"fov":20,"exp":1,"sparse":1,"haze":0,"sat":1,"ghost":0},
  // inside: Inside: the push-in has filled the frame with the shadow; the spray of specks over the black.
  {"t":59.1,"r":2.5,"el":8,"az":222,"lead":0,"aimY":0,"roll":0,"fov":18,"exp":1,"sparse":1,"haze":0,"sat":1,"ghost":0},
  {"t":65,"r":1.2,"el":8,"az":236,"lead":0,"aimY":0,"roll":0,"fov":16,"exp":1,"sparse":1,"haze":0,"sat":1,"ghost":0},
];
