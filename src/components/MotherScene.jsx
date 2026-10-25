import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Mother is constructed here from surfaces and articulated particle groups. No image,
// external model, API, or downloaded asset is used to render her.
const CYAN = new THREE.Color('#24bbf6');
const ICE = new THREE.Color('#a4e5ff');
const GOLD = new THREE.Color('#ffbc62');
const DEEP = new THREE.Color('#1560a4');
const TAU = Math.PI * 2;

function seededRandom(seed = 14012) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeMother(scene, reducedMotion) {
  const random = seededRandom();
  const uniforms = {
    uTime: { value: 0 },
    uAssembly: { value: 0 },
    uPixelRatio: { value: 1 },
    uEnergy: { value: 0.2 },
  };
  const materials = [];
  const geometries = [];
  const joints = {};
  const avatar = new THREE.Group();
  avatar.position.y = 0.1;
  scene.add(avatar);

  function points(parent, positions, colors, sizes, alpha = 0.8) {
    const geometry = new THREE.BufferGeometry();
    const count = positions.length / 3;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(Array.from({ length: count }, () => random()), 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uAlpha: { value: alpha } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aSeed;
        uniform float uTime;
        uniform float uAssembly;
        uniform float uPixelRatio;
        uniform float uEnergy;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          float stage = smoothstep(aSeed * .43, .50 + aSeed * .50, uAssembly);
          vec3 dispersed = vec3(
            cos(aSeed * 150. + uTime * .22) * (2.2 + aSeed * 2.5),
            -3. + sin(aSeed * 61. + uTime * .3) * 1.3,
            sin(aSeed * 150. + uTime * .22) * (2.2 + aSeed * 2.5)
          );
          vec3 p = mix(dispersed, position, stage);
          p += vec3(sin(uTime*.7 + aSeed*50.), cos(uTime*.5+aSeed*27.), sin(uTime*.8+aSeed*32.)) * .006 * stage;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * uPixelRatio * 22. / max(1.0, -mvPosition.z), .55, 10.0);
          vAlpha = (.60 + .40 * sin(aSeed * 43. + uTime * (1. + uEnergy))) * (.16 + .84 * stage) * smoothstep(0., .08, uAssembly);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(.5));
          if(d > .5) discard;
          float core = pow(1. - d * 2., 1.8);
          gl_FragColor = vec4(vColor, core * vAlpha * uAlpha * .48);
        }
      `,
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    parent.add(cloud);
    materials.push(material);
    geometries.push(geometry);
    return cloud;
  }

  function pushColor(colors, gold = 0.13, bright = false) {
    const c = random() < gold ? GOLD.clone() : CYAN.clone();
    if (bright) c.lerp(ICE, 0.48);
      c.multiplyScalar(0.62 + random() * 0.67);
    colors.push(c.r, c.g, c.b);
  }

  function ellipsoid(parent, center, radii, count, options = {}) {
    const p = [], c = [], s = [];
    for (let i = 0; i < count; i++) {
      const v = random() * 2 - 1;
      const angle = random() * TAU;
      const ring = Math.sqrt(1 - v * v);
      let x = ring * Math.cos(angle) * radii[0];
      let y = v * radii[1];
      let z = ring * Math.sin(angle) * radii[2];
      if (options.face && z > 0) {
        // Sculpted brow, eye sockets, bridge, nose, cheek, mouth and chin.
        const gauss = (px, py, sx, sy) => Math.exp(-((x-px)**2/(sx*sx) + (y-py)**2/(sy*sy)));
        z += .13 * gauss(0, .015, .068, .22);
        z += .105 * gauss(0, -.065, .078, .065);
        z -= .045 * (gauss(.17, .12, .10, .067) + gauss(-.17, .12, .10, .067));
        z += .04 * (gauss(.22, -.02, .13, .11) + gauss(-.22, -.02, .13, .11));
        z += .045 * gauss(0, -.235, .13, .035);
        // Jaw narrows into the chin.
        x *= y < -.12 ? 1 - Math.min(.23, (-y-.12)*.55) : 1;
      }
      p.push(center[0]+x, center[1]+y, center[2]+z);
      pushColor(c, options.gold ?? .12, options.face && z > .18);
      s.push(options.face ? .5 + random()*.65 : .45 + random()*.65);
    }
    return points(parent,p,c,s,options.alpha ?? .82);
  }

  function contour(parent, fn, samples, color = CYAN, size = .8, opacity = .55) {
    const p=[],c=[],s=[];
    for(let i=0;i<samples;i++) {
      const v=fn(i/(samples-1));
      p.push(...v); c.push(color.r,color.g,color.b); s.push(size * (.8 + random()*.4));
    }
    return points(parent,p,c,s,opacity);
  }

  // A fitted, continuous silhouette from the pelvis to the base of the neck.
  const bodyRings = [
    [2.78,.46,.27],[2.95,.53,.30],[3.2,.51,.29],[3.45,.43,.255],
    [3.68,.37,.235],[3.93,.41,.27],[4.2,.54,.30],[4.42,.63,.305],
    [4.61,.72,.255],[4.73,.66,.22],[4.8,.37,.20],[4.88,.19,.18],
  ];
  function bodyShape(y) {
    const index = Math.max(0,bodyRings.findIndex((r,i)=>i<bodyRings.length-1 && y>=r[0] && y<=bodyRings[i+1][0]));
    const a=bodyRings[index],b=bodyRings[index+1];
    const t=THREE.MathUtils.smoothstep(y,a[0],b[0]);
    return [THREE.MathUtils.lerp(a[1],b[1],t),THREE.MathUtils.lerp(a[2],b[2],t)];
  }
  {
    const p=[],c=[],s=[];
    for(let i=0;i<13500;i++) {
      const y=2.78+random()*2.1;
      const [rx,rz]=bodyShape(y);
      const a=random()*TAU;
      p.push(Math.cos(a)*rx,y,Math.sin(a)*rz);
      pushColor(c,.11);s.push(.42+random()*.55);
    }
    points(avatar,p,c,s,.7);
    // Curving scan contours define the garment-like particle surface.
    for(let y=2.81;y<4.86;y+=.061) {
      const [rx,rz]=bodyShape(y);
      contour(avatar,t=>[Math.cos(t*TAU)*rx,y+.015*Math.cos(t*TAU*2),Math.sin(t*TAU)*rz],170,CYAN,.58,.62);
    }
    // Strong shoulder/waist edge lines anchor the silhouette without solid skin.
    for(const side of [-1,1]) {
      contour(avatar,t=>{
        const y=2.8+t*2.05;
        const [rx]=bodyShape(y);
        return [side*rx,y,.02];
      },230,ICE,1,.83);
    }
  }

  // Neck, face, ears, and facial contours.
  ellipsoid(avatar,[0,5.02,0],[.195,.39,.18],1700,{gold:.17});
  const head=new THREE.Group();head.position.set(0,5.76,.025);avatar.add(head);joints.head=head;
  // A faint transparent scaffold gives the facial particles actual modeled depth.
  const faceGeometry=new THREE.SphereGeometry(1,64,48);
  const facePositions=faceGeometry.attributes.position;
  for(let i=0;i<facePositions.count;i++) {
    let x=facePositions.getX(i)*.362,y=facePositions.getY(i)*.532,z=facePositions.getZ(i)*.312;
    if(z>0) {
      const g=(px,py,sx,sy)=>Math.exp(-((x-px)**2/(sx*sx)+(y-py)**2/(sy*sy)));
      z+=.13*g(0,.015,.068,.22)+.105*g(0,-.065,.078,.065);
      z-=.045*(g(.17,.12,.10,.067)+g(-.17,.12,.10,.067));
      z+=.04*(g(.22,-.02,.13,.11)+g(-.22,-.02,.13,.11))+.045*g(0,-.235,.13,.035);
      if(y<-.12)x*=1-Math.min(.23,(-y-.12)*.55);
    }
    facePositions.setXYZ(i,x,y,z);
  }
  faceGeometry.computeVertexNormals();
  const faceMaterial=new THREE.MeshStandardMaterial({color:0x245678,emissive:0x031523,roughness:.75,metalness:.1,transparent:true,opacity:0,depthWrite:false});
  const faceScaffold=new THREE.Mesh(faceGeometry,faceMaterial);head.add(faceScaffold);
  geometries.push(faceGeometry);materials.push(faceMaterial);
  ellipsoid(head,[0,0,0],[.365,.535,.315],6900,{face:true,gold:.025,alpha:.48});
  ellipsoid(head,[-.36,-.015,-.018],[.056,.12,.05],230,{gold:.08});
  ellipsoid(head,[.36,-.015,-.018],[.056,.12,.05],230,{gold:.08});
  for(let y=-.45;y<.50;y+=.039) {
    const f=Math.sqrt(Math.max(0,1-(y/.535)**2));
    contour(head,t=>{
      const a=t*TAU;
      let x=Math.cos(a)*.365*f;
      if(y<-.12)x*=1-Math.min(.23,(-y-.12)*.55);
      let z=Math.sin(a)*.315*f;
      if(z>0)z+=.055*Math.exp(-(x*x/.009 + (y+.035)**2/.04));
      return [x,y,z];
    },130,CYAN,.65,.56);
  }
  const eyes=[];
  for(const side of [-1,1]) {
    const eye=new THREE.Group();eye.position.set(side*.153,.105,.293);head.add(eye);eyes.push(eye);
    // Almond lids plus a luminous iris give a readable expressive face.
    for(const direction of [-1,1]) {
      contour(eye,t=>[(t-.5)*.162,direction*Math.sin(t*Math.PI)*.026,.006],48,ICE,.85,.92);
    }
    ellipsoid(eye,[0,0,.012],[.019,.024,.012],130,{gold:0,alpha:1});
    const pupilGeometry=new THREE.SphereGeometry(.008,10,8);
    const pupilMaterial=new THREE.MeshBasicMaterial({color:0x001119,transparent:true,opacity:0});
    const pupil=new THREE.Mesh(pupilGeometry,pupilMaterial);pupil.position.set(0,0,.025);eye.add(pupil);
    geometries.push(pupilGeometry);materials.push(pupilMaterial);
    eye.userData.pupilMaterial=pupilMaterial;
    contour(head,t=>[side*(.075+t*.165),.17+Math.sin(t*Math.PI)*.023,.278-t*.01],60,DEEP,.9,.9);
  }
  const mouth=new THREE.Group();mouth.position.set(0,-.226,.32);head.add(mouth);
  contour(mouth,t=>[(t-.5)*.145,.006+Math.cos(t*TAU)*.009,Math.sin(t*Math.PI)*.014],90,GOLD,.78,.8);
  contour(mouth,t=>[(t-.5)*.135,-.009-Math.sin(t*Math.PI)*.012,.001],70,ICE,.65,.8);
  contour(head,t=>[.017*Math.sin(t*Math.PI),.15-t*.24,.315+Math.sin(t*Math.PI/2)*.10],80,ICE,.74,.84);

  // Long streaming hair: many individual filaments, with a middle part and swept sides.
  const hair=new THREE.Group();head.add(hair);
  const hp=[],hc=[],hs=[];
  for(let strand=0;strand<205;strand++) {
    const angle=random()*TAU;
    const side=Math.cos(angle)>=0?1:-1;
    const isFront=Math.sin(angle)>.35;
    const length=1.2+random()*1.05;
    for(let step=0;step<72;step++) {
      const t=step/71;
      const arch=Math.sin(Math.min(1,t*2)*Math.PI/2);
      const x=Math.cos(angle)*(.13+.32*arch)+side*(t*t*.22)+Math.sin(t*14+strand)*.024*t;
      const y=.48 + Math.sin(angle)*.045-t*length + Math.sin(t*4+strand)*.025;
      // Front strands fall beside the face, never across its center.
      const xx=isFront?side*(.12+.28*arch+t*.15)+Math.sin(t*10+strand)*.025:x;
      const z=Math.sin(angle)*(.16+.22*arch)-t*.12+Math.cos(t*11+strand)*.03;
      hp.push(xx,y,z);
      pushColor(hc,strand%9===0?.85:.06);
      hs.push(.38+random()*.58);
    }
  }
  points(hair,hp,hc,hs,.7);
  joints.hair=hair;

  function limb(parent, start, end, radiusA, radiusB, samples, gold=.08) {
    const p=[],c=[],s=[];
    const a=new THREE.Vector3(...start),b=new THREE.Vector3(...end);
    const dir=b.clone().sub(a).normalize();
    const axis=Math.abs(dir.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
    const u=new THREE.Vector3().crossVectors(dir,axis).normalize();
    const v=new THREE.Vector3().crossVectors(dir,u).normalize();
    for(let i=0;i<samples;i++) {
      const t=random(),angle=random()*TAU;
      const r=THREE.MathUtils.lerp(radiusA,radiusB,t)*(1+.07*Math.sin(t*Math.PI));
      const pt=a.clone().lerp(b,t).addScaledVector(u,Math.cos(angle)*r).addScaledVector(v,Math.sin(angle)*r*.9);
      p.push(pt.x,pt.y,pt.z);pushColor(c,gold);s.push(.4+random()*.55);
    }
    points(parent,p,c,s,.74);
    for(let lane=0;lane<9;lane++) {
      const angle=lane/9*TAU;
      contour(parent,t=>{
        const r=THREE.MathUtils.lerp(radiusA,radiusB,t);
        const pt=a.clone().lerp(b,t).addScaledVector(u,Math.cos(angle)*r).addScaledVector(v,Math.sin(angle)*r*.9);
        return [pt.x,pt.y,pt.z];
      },70,lane===1||lane===5?GOLD:CYAN,lane===1||lane===5?.82:.62,lane===1||lane===5?.9:.45);
    }
  }

  for(const side of [-1,1]) {
    // Joint pivots keep the elbow, wrist, fingers, knee and ankle attached in 3D.
    const shoulder=new THREE.Group();shoulder.position.set(side*.70,4.58,0);avatar.add(shoulder);
    const upper=new THREE.Group();shoulder.add(upper);
    limb(upper,[0,0,0],[side*.16,-.87,.02],.16,.115,1700);
    ellipsoid(upper,[0,-.03,0],[.185,.20,.17],650);
    const elbow=new THREE.Group();elbow.position.set(side*.16,-.87,.02);upper.add(elbow);
    limb(elbow,[0,0,0],[side*.04,-.78,.05],.118,.071,1300);
    const wrist=new THREE.Group();wrist.position.set(side*.04,-.78,.05);elbow.add(wrist);
    ellipsoid(wrist,[0,-.12,.015],[.085,.155,.047],600,{gold:.15});
    const fingers=[];
    for(let finger=0;finger<4;finger++) {
      const knuckle=new THREE.Group();knuckle.position.set((finger-1.5)*.041,-.22,.019);wrist.add(knuckle);
      const length=[.21,.245,.228,.18][finger];
      limb(knuckle,[0,0,0],[side*.018,-length*.57,.013],.021,.016,110,.18);
      const tip=new THREE.Group();tip.position.set(side*.018,-length*.57,.013);knuckle.add(tip);
      limb(tip,[0,0,0],[0,-length*.43,.009],.016,.009,80,.2);
      fingers.push({knuckle,tip});
    }
    limb(wrist,[side*.065,-.07,.025],[side*.14,-.19,.047],.026,.015,160,.19);
    joints[side<0?'leftArm':'rightArm']={shoulder,upper,elbow,wrist,fingers,side};

    const hip=new THREE.Group();hip.position.set(side*.28,2.9,0);avatar.add(hip);
    limb(hip,[0,0,0],[side*.035,-1.28,0],.255,.136,2800);
    const knee=new THREE.Group();knee.position.set(side*.035,-1.28,0);hip.add(knee);
    limb(knee,[0,0,0],[-side*.015,-1.28,-.015],.138,.075,2300);
    ellipsoid(knee,[-side*.015,-1.27,.10],[.095,.10,.24],650,{gold:.12});
    joints[side<0?'leftLeg':'rightLeg']={hip,knee};
  }

  // Golden branching filaments converge on the blue-white heart.
  for(let strand=0;strand<8;strand++) {
    const side=strand%2?-1:1;
    contour(avatar,t=>{
      const y=3.15+t*2.02;
      const spread=Math.sin(t*Math.PI)*(.09+strand*.013);
      return [side*spread+Math.sin(t*17+strand*.9)*.035,y,.32-(y>4.7?.14:0)];
    },180,GOLD,1.0,.9);
  }
  for(let strand=0;strand<12;strand++) {
    contour(avatar,t=>{
      const y=2.82+t*2.02;
      const [rx,rz]=bodyShape(y);
      const angle=strand/12*TAU+t*TAU*(strand%2?1.3:-1.3)+Math.sin(t*11+strand)*.16;
      return [Math.cos(angle)*(rx+.008),y,Math.sin(angle)*(rz+.014)];
    },260,GOLD,.83,.83);
  }
  const core=new THREE.Group();core.position.set(0,4.36,.335);avatar.add(core);joints.core=core;
  ellipsoid(core,[0,0,0],[.055,.07,.045],500,{gold:0,alpha:1});
  for(let ring=0;ring<3;ring++) contour(core,t=>[Math.cos(t*TAU)*(.09+ring*.035),Math.sin(t*TAU)*(.09+ring*.035),0],110,ICE,.72,.6);

  const flareCanvas=document.createElement('canvas');flareCanvas.width=128;flareCanvas.height=128;
  const ctx=flareCanvas.getContext('2d');
  const gradient=ctx.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.045,'rgba(255,255,255,1)');
  gradient.addColorStop(.13,'rgba(255,255,255,.75)');gradient.addColorStop(.4,'rgba(255,255,255,.14)');gradient.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(64,15);ctx.lineTo(64,113);ctx.moveTo(15,64);ctx.lineTo(113,64);ctx.stroke();
  const flareTexture=new THREE.CanvasTexture(flareCanvas);
  const flares=[];
  for(const [x,y,z,size] of [[0,4.36,.40,.60],[-.64,4.59,.09,.33],[.60,4.56,.1,.30],[-.42,5.77,.12,.23],[.44,5.2,.02,.27],[.91,2.88,.15,.25],[-.29,1.71,.10,.20]]) {
    const material=new THREE.SpriteMaterial({map:flareTexture,color:flares.length===0?0x4dcfff:0xffbc62,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,opacity:0});
    const flare=new THREE.Sprite(material);flare.scale.set(size,size,1);
    if(x>.9){flare.position.set(0,-.10,.08);joints.rightArm.wrist.add(flare);}
    else {flare.position.set(x,y,z);avatar.add(flare);}
    flares.push({flare,material,size});materials.push(material);
  }
  // Broad, flowing hair accents and a few golden signal paths on the limbs.
  for(const side of [-1,1])for(let line=0;line<5;line++) {
    contour(head,t=>[
      side*(.20+.22*Math.sin(t*Math.PI*.7)+t*.17)+Math.sin(t*13+line)*.018,
      .43-t*(1.72+line*.07),
      .13+line*.018+Math.sin(t*10+line)*.035,
    ],150,GOLD,line%3===0?.95:.65,line%3===0?.85:.5);
  }

  // An ambient halo and a luminous circular plinth make the character feel present.
  const environment=new THREE.Group();scene.add(environment);
  const halo=new THREE.Group();halo.position.set(0,5.66,-.75);environment.add(halo);
  for(let r=0;r<5;r++) {
    const radius=.84+r*.22;
    contour(halo,t=>[Math.cos(t*TAU)*radius,Math.sin(t*TAU)*radius,0],450,CYAN,r===0?.75:.55,r===0?.42:.28);
  }
  const platform=new THREE.Group();platform.position.y=.11;environment.add(platform);
  for(let ring=0;ring<7;ring++) {
    const radius=.50+ring*.195;
    contour(platform,t=>[Math.cos(t*TAU)*radius,Math.sin(t*TAU*6)*.009,Math.sin(t*TAU)*radius],550,ring%3===0?ICE:CYAN,.65,ring%3===0?.58:.26);
  }
  for(let tick=0;tick<64;tick++) {
    const a=tick/64*TAU;
    contour(platform,t=>[Math.cos(a)*(1.48+t*.065),0,Math.sin(a)*(1.48+t*.065)],5,CYAN,.55,.35);
  }
  const terrain=new THREE.Group();environment.add(terrain);joints.terrain=terrain;
  const tp=[],tc=[],ts=[];
  for(let row=0;row<25;row++)for(let col=0;col<120;col++) {
    const x=(col/119-.5)*14;
    if(Math.abs(x)<1.05)continue;
    const z=-2.5-row*.10;
    const y=.35 + Math.sin(x*1.1+row*.12)*.20 + Math.sin(x*2.3+row*.21)*.20 + Math.abs(x)*.12;
    tp.push(x,y,z);pushColor(tc,row%8===0?.75:.02);ts.push(.45+random()*.3);
  }
  points(terrain,tp,tc,ts,.8);

  const starsP=[],starsC=[],starsS=[];
  for(let i=0;i<620;i++) {
    starsP.push((random()-.5)*15,random()*9-1,(random()-.5)*7-2);
    pushColor(starsC,.10);starsS.push(.3+random()*.55);
  }
  points(environment,starsP,starsC,starsS,.26);

  // Light pools are soft procedural sprites, with no texture files.
  const glowMaterial=new THREE.ShaderMaterial({
    uniforms:{uColor:{value:new THREE.Color('#0b98ee')},uOpacity:{value:.21}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; void main(){float d=length(vUv-.5)*2.;gl_FragColor=vec4(uColor,pow(max(0.,1.-d),3.)*uOpacity);}',
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
  });materials.push(glowMaterial);
  const glowGeometry=new THREE.PlaneGeometry(6,8);geometries.push(glowGeometry);
  const glow=new THREE.Mesh(glowGeometry,glowMaterial);glow.position.set(0,3.6,-1);environment.add(glow);
  const sparkMaterial=glowMaterial.clone();
  sparkMaterial.uniforms.uColor.value=new THREE.Color('#99eaff');
  sparkMaterial.uniforms.uOpacity.value=1;
  const sparkGeometry=new THREE.PlaneGeometry(.8,.8);
  const spark=new THREE.Mesh(sparkGeometry,sparkMaterial);
  spark.position.set(0,.28,.1);scene.add(spark);
  materials.push(sparkMaterial);geometries.push(sparkGeometry);

  let assembly=0;
  let phaseStart=0;
  let phaseAssembly=0;
  let previousPhase=null;
  let blinkAt=3.2;
  return {
    uniforms,
    avatar,
    update(time,delta,state) {
      const target=state.phase==='dormant'?0:1;
      if(state.phase!==previousPhase){previousPhase=state.phase;phaseStart=time;phaseAssembly=assembly;}
      const elapsed=(time-phaseStart)/(state.phase==='dormant'?1.1:4.5);
      assembly=THREE.MathUtils.lerp(phaseAssembly,target,THREE.MathUtils.smoothstep(elapsed,0,1));
      if(reducedMotion)assembly=target;
      uniforms.uTime.value=time;
      uniforms.uAssembly.value=assembly;
      faceMaterial.opacity=.32*Math.pow(assembly,4);
      flares.forEach(({flare,material,size},i)=>{
        material.opacity=Math.pow(assembly,3)*(.68+Math.sin(time*1.8+i)*.19);
        const scale=size*(1+Math.sin(time*1.2+i)*.12);flare.scale.set(scale,scale,1);
      });
      const speaking=state.activity==='speaking'?1:0;
      const thinking=state.activity==='thinking'?1:0;
      const listening=state.activity==='listening'?1:0;
      uniforms.uEnergy.value=THREE.MathUtils.damp(uniforms.uEnergy.value,.2+speaking*.9+thinking*.5+listening*.4,4,delta);
      const motion=reducedMotion?.12:1;
      avatar.position.y=.1+Math.sin(time*.9)*.019*motion;
      avatar.rotation.y=Math.sin(time*.21)*.035*motion;
      head.rotation.y=(Math.sin(time*.43)*.05+listening*.035)*motion;
      head.rotation.z=Math.sin(time*.31)*.018*motion;
      head.rotation.x=(Math.sin(time*.52)*.012 + speaking*Math.sin(time*2.6)*.013)*motion;
      mouth.scale.y=1+speaking*(.25+Math.abs(Math.sin(time*8.4))*.9)*motion;
      hair.rotation.z=Math.sin(time*.49)*.012*motion;
      hair.rotation.y=Math.sin(time*.33)*.016*motion;
      if(time>blinkAt+.14)blinkAt=time+3.8+random()*3;
      const blink=time>blinkAt?Math.max(.13,Math.abs(Math.cos((time-blinkAt)/.14*Math.PI))):1;
      eyes.forEach(eye=>{eye.scale.y=blink;eye.userData.pupilMaterial.opacity=assembly;});
      for(const arm of [joints.leftArm,joints.rightArm]) {
        const {side}=arm;
        const welcome=state.gesture==='welcome'?1:0;
        const wave=state.gesture==='wave'&&side===-1?1:0;
        const explaining=state.gesture==='explain'||speaking?1:0;
        const z=side*(.055+Math.sin(time*.6+side)*.018+welcome*.17+wave*.95+explaining*(.11+.04*Math.sin(time*1.1+side)));
        arm.shoulder.rotation.z=THREE.MathUtils.damp(arm.shoulder.rotation.z,z*motion,3,delta);
        arm.shoulder.rotation.x=THREE.MathUtils.damp(arm.shoulder.rotation.x,(-.05-explaining*.19+wave*.1)*motion,3,delta);
        arm.elbow.rotation.x=THREE.MathUtils.damp(arm.elbow.rotation.x,(-.12-welcome*.28-explaining*(.30+.13*Math.sin(time*1.4+side))-wave*1.35)*motion,3,delta);
        arm.wrist.rotation.z=(wave*Math.sin(time*5)*.35 + explaining*Math.sin(time*1.6+side)*.09)*motion;
        arm.wrist.rotation.y=side*(welcome*.33+explaining*.25)*motion;
        arm.fingers.forEach(({knuckle,tip},i)=>{
          knuckle.rotation.x=(.10+speaking*(.06+.06*Math.sin(time*1.6+i)))*motion;
          tip.rotation.x=(.12+.04*Math.sin(time*.7+i))*motion;
        });
      }
      joints.leftLeg.hip.rotation.z=.015;
      joints.rightLeg.hip.rotation.z=-.025;
      core.scale.setScalar(1+(Math.sin(time*(speaking?6:2))*.075+speaking*.12));
      platform.rotation.y=time*.025*motion;
      halo.rotation.z=Math.sin(time*.12)*.05*motion;
      terrain.position.y=Math.sin(time*.5)*.035*motion;
      environment.visible=assembly>.11;
      spark.visible=assembly<.85;
      spark.scale.setScalar((.9+Math.sin(time*2)*.15)*(1-assembly));
      glowMaterial.uniforms.uOpacity.value=.18+speaking*.05;
      return assembly;
    },
    dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());flareTexture.dispose();},
  };
}

export default function MotherScene({phase='assembling',activity='idle',gesture='welcome',reducedMotion=false,onReady}) {
  const host=useRef(null);
  const state=useRef({phase,activity,gesture});
  const readyCallback=useRef(onReady);
  const [failed,setFailed]=useState(false);
  state.current={phase,activity,gesture};
  readyCallback.current=onReady;

  useEffect(()=>{
    const container=host.current;
    let renderer,composer,bloom,frame,observer,controls,mother;
    let disposed=false;
    try {
      renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
      renderer.setClearColor(new THREE.Color().setRGB(.0008,.0016,.0033),1);
      renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure=.98;
      renderer.domElement.setAttribute('aria-label','Mother: an articulated blue and gold 3D particle humanoid. Drag to rotate; scroll to zoom.');
      renderer.domElement.setAttribute('role','img');
      container.appendChild(renderer.domElement);
      const scene=new THREE.Scene();
      scene.add(new THREE.AmbientLight(0x89c6ed,.7));
      const faceLight=new THREE.DirectionalLight(0x9edcff,2.0);faceLight.position.set(-3,7,5);scene.add(faceLight);
      const camera=new THREE.PerspectiveCamera(39,1,.1,100);
      camera.position.set(.2,3.55,11.9);
      camera.lookAt(0,3.35,0);
      controls=new OrbitControls(camera,renderer.domElement);
      controls.target.set(0,3.3,0);
      controls.enableDamping=true;
      controls.dampingFactor=.06;
      controls.enablePan=false;
      controls.minDistance=5.5;
      controls.maxDistance=18;
      controls.minPolarAngle=.35;
      controls.maxPolarAngle=Math.PI*.79;
      controls.rotateSpeed=.5;
      controls.zoomSpeed=.65;
      mother=makeMother(scene,reducedMotion);
      mother.uniforms.uPixelRatio.value=renderer.getPixelRatio();
      composer=new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene,camera));
      bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.55,.45,.3);
      composer.addPass(bloom);
      const resize=()=>{
        const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);
        renderer.setSize(width,height);
        composer.setSize(width,height);
        camera.aspect=width/height;
        camera.fov=width/height<.7?47:39;
        camera.updateProjectionMatrix();
      };
      observer=new ResizeObserver(resize);observer.observe(container);resize();
      const clock=new THREE.Clock();
      let ready=false;
      const animate=()=>{
        if(disposed)return;
        const delta=Math.min(clock.getDelta(),.07),time=clock.elapsedTime;
        const assembly=mother.update(time,delta,state.current);
        if(state.current.phase==='dormant')ready=false;
        if(assembly>.975&&!ready){ready=true;readyCallback.current?.();}
        controls.update();
        composer.render();
        frame=requestAnimationFrame(animate);
      };
      animate();
    }catch(error){
      console.warn('Mother 3D rendering unavailable:',error.message);
      setFailed(true);
    }
    return()=>{
      disposed=true;
      cancelAnimationFrame(frame);
      observer?.disconnect();controls?.dispose();mother?.dispose();bloom?.dispose();composer?.dispose();renderer?.dispose();
      if(renderer?.domElement.parentNode===container)container.removeChild(renderer.domElement);
    };
  },[reducedMotion]);

  return <div className="mother-scene" ref={host} style={{position:'absolute',inset:0,overflow:'hidden'}}>
    {failed&&<div className="scene-fallback" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',textAlign:'center',color:'#9fd8f1',padding:32}}><div><div style={{fontSize:64,color:'#62d2ff'}}>✧</div><p>Mother is here.</p><small>This device could not start 3D graphics. Conversations and memory remain available.</small></div></div>}
  </div>;
}
