'use strict';
/* ============================================================
   PFANDJÄGER 3D — U-Bahn endless runner (Subway-Surfers-style core)
   Three.js r160, zero network deps. Portrait, mobile-first.
   Logic (update) is decoupled from render so tests can step
   deterministically through window.__game.
   ============================================================ */

/* ---------------- boot ---------------- */
const cv = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const PR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(PR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 40, 170);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 220);
camera.position.set(0, 4.8, 9.8);
camera.lookAt(0, 1.6, -8);

// lights
scene.add(new THREE.HemisphereLight(0x8fa3c8, 0x1a1626, 1.15));
const sun = new THREE.DirectionalLight(0xffd9a0, 1.9);
sun.position.set(6, 14, -6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x5f7bb0, 0.5);
fill.position.set(-8, 6, 4);
scene.add(fill);

/* ---------------- constants ---------------- */
const LANES = [-2.4, 0, 2.4];
const LANE_W = 2.4;
const TRACK_W = 8.6;
const SEG_LEN = 14;          // world length per track segment
const SEGS_AHEAD = 18;       // pooled segments ahead of player
const PLAYER_Z = 0;
const BASE_SPEED = 12;
const MAX_SPEED = 30;

/* ---------------- i18n ---------------- */
const I18N = {
  de: {
    sub: 'U-Bahn Runner. Sammle Pfand. Weiche den Zügen aus.',
    hint: '<b>← →</b> Spur wechseln · <b>↑</b> springen · <b>↓</b> rutschen<br>' +
          'Züge: Spur wechseln. Hürden: springen. Balken: rutschen.<br>' +
          'Flaschen <b>+0,25 €</b> · Kisten <b>+1,00 €</b><br>' +
          'Kombos: 4 = x2, 8 = x3. Knapp vorbei zählt!<br>' +
          'Mobil: wischen — links/rechts/hoch/runter.',
    start: "LOS GEHT'S", again: 'NOCHMAL',
    over: 'ABGERÄUMT', earned: 'Eingesammelt', best: 'Rekord', newBest: 'NEUER REKORD!',
    combo: 'Kombo', paused: 'PAUSIERT', lang: 'DE'
  },
  en: {
    sub: 'U-Bahn runner. Grab Pfand. Dodge the trains.',
    hint: '<b>← →</b> switch · <b>↑</b> jump · <b>↓</b> slide<br>' +
          'Trains: switch lane. Hurdles: jump. Beams: slide.<br>' +
          'Bottles <b>+€0.25</b> · Crates <b>+€1.00</b><br>' +
          'Combos: 4 = x2, 8 = x3. Near misses count!<br>' +
          'Mobile: swipe — left/right/up/down.',
    start: "LET'S GO", again: 'AGAIN',
    over: 'CAUGHT', earned: 'Collected', best: 'Best', newBest: 'NEW BEST!',
    combo: 'Combo', paused: 'PAUSED', lang: 'EN'
  }
};
let lang = localStorage.getItem('pj.lang') || 'de';
let muted = localStorage.getItem('pj.muted') === '1';
const t = () => I18N[lang];

/* ---------------- audio ---------------- */
let AC = null;
function audio() {
  if (!AC) { const C = window.AudioContext || window.webkitAudioContext; if (C) AC = new C(); }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, slideTo) {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.05, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(ac.currentTime + dur);
}
const SFX = {
  collect() { tone(880, .09, 'square', .05, 1320); },
  crate()   { tone(660, .12, 'triangle', .07, 990); setTimeout(() => tone(990, .14, 'triangle', .06, 1480), 90); },
  jump()    { tone(300, .14, 'square', .045, 620); },
  slide()   { tone(240, .2, 'sawtooth', .035, 90); },
  lane()    { tone(520, .05, 'square', .03); },
  nearMiss(){ tone(1180, .06, 'square', .032); },
  crash()   { tone(150, .4, 'sawtooth', .12, 45); setTimeout(() => tone(90, .6, 'sawtooth', .09, 35), 120); },
  best()    { tone(784, .1, 'triangle', .06); setTimeout(() => tone(1046, .16, 'triangle', .06), 110); }
};

/* ---------------- state ---------------- */
let state = 'menu';            // menu | play | dying | over | pause
let speed = BASE_SPEED;
let runTime = 0;
let cents = 0;
let combo = 0, comboTimer = 0;
const COMBO_WINDOW = 3.5;
const mult = () => 1 + Math.min(2, Math.floor(combo / 4));
let best = parseInt(localStorage.getItem('pj.best') || '0', 10);
let newBest = false;
let shakeT = 0, shakeAmp = 0;
let timeScale = 1;
let dyingT = 0;
let spawnEnabled = true;
let dist = 0;                  // distance run (m)
let nearMissCount = 0;

/* ---------------- player ---------------- */
const player = {
  lane: 1, x: 0, targetX: 0,   // world x
  y: 0, vy: 0, onGround: true,
  slideT: 0,                  // >0 while sliding
  runPhase: 0,
  tilt: 0,                    // roll during lane switch
  group: null, legs: [], arms: [],
  bodyGroup: null
};

let shadow = null;
function buildPlayer() {
  const g = new THREE.Group();
  // blob shadow (grounds the character, stays on the track)
  shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.44, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);
  const matJacket = new THREE.MeshStandardMaterial({ color: 0x6b7a4d, roughness: 0.85 });
  const matJeans  = new THREE.MeshStandardMaterial({ color: 0x35405e, roughness: 0.9 });
  const matSkin   = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.7 });
  const matBeanie = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.8 });
  const matBag    = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9 });
  const matBottle = new THREE.MeshStandardMaterial({ color: 0x4fae74, roughness: 0.5 });
  const matShoe   = new THREE.MeshStandardMaterial({ color: 0xdfe4ee, roughness: 0.8 });

  const body = new THREE.Group();
  // legs
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.18), matJeans);
  legL.position.set(-0.14, 0.36, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.18), matJeans);
  legR.position.set(0.14, 0.36, 0);
  // shoes
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), matShoe);
  shoeL.position.set(-0.14, 0.05, 0.06);
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), matShoe);
  shoeR.position.set(0.14, 0.05, 0.06);
  legL.add(shoeL); legR.add(shoeR);
  player.legs = [legL, legR];
  // torso (jacket)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), matJacket);
  torso.position.y = 1.05;
  // arms
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.14), matJacket);
  armL.position.set(-0.34, 0.99, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.14), matJacket);
  armR.position.set(0.34, 0.99, 0);
  player.arms = [armL, armR];
  // backpack with bottles
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.24), matBag);
  bag.position.set(0, 1.08, -0.24);
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), matBottle);
  b1.position.set(-0.12, 1.55, -0.24); b1.rotation.x = 0.35;
  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), matBottle);
  b2.position.set(0.12, 1.6, -0.24); b2.rotation.x = -0.3;
  // head + beanie
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), matSkin);
  head.position.y = 1.72;
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), matBeanie);
  beanie.position.y = 1.78;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.08, 18), matBeanie);
  band.position.y = 1.66;

  body.add(legL, legR, torso, armL, armR, bag, b1, b2, head, beanie, band);
  body.position.y = 0.72; // hip pivot at ground
  g.add(body);
  player.bodyGroup = body;
  player.group = g;
  scene.add(g);
  return g;
}

/* ---------------- track ---------------- */
const segPool = [];
let segHead = 0; // distance already built
const matGround = new THREE.MeshStandardMaterial({ color: 0x232a3e, roughness: 0.95 });
const matRail   = new THREE.MeshStandardMaterial({ color: 0x3a4668, roughness: 0.7, metalness: 0.3 });
const matMarker = new THREE.MeshStandardMaterial({ color: 0xffb545, roughness: 0.8, emissive: 0x332200 });
const matPillar = new THREE.MeshStandardMaterial({ color: 0x1a2138, roughness: 0.9 });

function buildSegment(z) {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W, 0.5, SEG_LEN), matGround);
  ground.position.y = -0.25;
  g.add(ground);
  // amber lane markers (dashed)
  for (let i = 0; i < 2; i++) {
    const lx = (LANES[i] + LANES[i + 1]) / 2;
    for (let k = 0; k < 3; k++) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 2.6), matMarker);
      dash.position.set(lx, 0.02, -SEG_LEN / 2 + 1.8 + k * 4.6);
      g.add(dash);
    }
  }
  // side rails (U-Bahn elevated vibe)
  for (const sx of [-TRACK_W / 2, TRACK_W / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, SEG_LEN), matRail);
    rail.position.set(sx, 0.45, 0);
    g.add(rail);
    for (let k = 0; k < 4; k++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), matRail);
      post.position.set(sx, 0.47, -SEG_LEN / 2 + 1.8 + k * 3.6);
      g.add(post);
    }
  }
  g.position.z = z;
  scene.add(g);
  return g;
}
function ensureTrack(zMax) {
  while (segHead < zMax) {
    const seg = buildSegment(segHead - SEG_LEN / 2);
    segPool.push({ obj: seg, z: segHead - SEG_LEN / 2 });
    segHead += SEG_LEN;
  }
  // recycle far-behind segments
  for (let i = segPool.length - 1; i >= 0; i--) {
    if (segPool[i].z + SEG_LEN < dist - 40) {
      scene.remove(segPool[i].obj);
      const newZ = segHead - SEG_LEN / 2;
      const seg = buildSegment(newZ);
      segPool[i] = { obj: seg, z: newZ };
      segHead += SEG_LEN;
    }
  }
}

/* ---------------- streetlamps (world density) ---------------- */
const lamps = [];
const matLampPole = new THREE.MeshStandardMaterial({ color: 0x2e3a52, roughness: 0.6, metalness: 0.5 });
const matLampHead = new THREE.MeshStandardMaterial({ color: 0xffb545, emissive: 0xff9a2a, emissiveIntensity: 1.6, roughness: 0.5 });
function buildLamp(z) {
  const g = new THREE.Group();
  const side = Math.random() < 0.5 ? -1 : 1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), matLampPole);
  pole.position.set(side * (TRACK_W / 2 + 1.6), 1.7, 0);
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), matLampPole);
  arm.position.set(side * (TRACK_W / 2 + 1.05), 3.35, 0);
  g.add(arm);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), matLampHead);
  head.position.set(side * (TRACK_W / 2 + 0.55), 3.28, 0);
  g.add(head);
  g.position.z = z;
  scene.add(g);
  return g;
}
function updateLamps() {
  for (const l of lamps) {
    if (l.position.z - dist * 0.9 > 12) l.position.z -= 320;
  }
}
for (let i = 0; i < 22; i++) lamps.push(buildLamp(-i * 14.5));

/* ---------------- music (generative synth loop) ---------------- */
let musicOn = false;
let musicTimer = null;
let musicStep = 0;
const BASS = [55, 55, 65.41, 55, 49, 49, 55, 55];      // A1-ish driving line
const HAT_P = [0, 1, 0, 1, 0, 1, 0, 1];
function musicStart() {
  if (musicOn || muted) return;
  const ac = audio(); if (!ac) return;
  musicOn = true;
  musicStep = 0;
  musicTimer = setInterval(() => {
    if (muted || state !== 'play') return;
    const t = ac.currentTime;
    const step = musicStep % 8;
    // kick
    const k = ac.createOscillator(), kg = ac.createGain();
    k.type = 'sine';
    k.frequency.setValueAtTime(120, t);
    k.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    kg.gain.setValueAtTime(0.16, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    k.connect(kg); kg.connect(ac.destination);
    k.start(t); k.stop(t + 0.18);
    // bass
    const b = ac.createOscillator(), bg = ac.createGain();
    b.type = 'triangle';
    b.frequency.setValueAtTime(BASS[step], t);
    bg.gain.setValueAtTime(0.07, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    b.connect(bg); bg.connect(ac.destination);
    b.start(t); b.stop(t + 0.24);
    // hats
    if (HAT_P[step]) {
      const h = ac.createOscillator(), hg = ac.createGain(), hf = ac.createBiquadFilter();
      h.type = 'square'; h.frequency.value = 6800;
      hf.type = 'highpass'; hf.frequency.value = 6000;
      hg.gain.setValueAtTime(0.018, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      h.connect(hf); hf.connect(hg); hg.connect(ac.destination);
      h.start(t); h.stop(t + 0.04);
    }
    musicStep++;
  }, 150); // 150ms step ≈ 133 BPM
}
function musicStop() {
  musicOn = false;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}
const props = [];
const matBldg = new THREE.MeshStandardMaterial({ color: 0x141b30, roughness: 0.95 });
const matWin = new THREE.MeshStandardMaterial({ color: 0xffb545, emissive: 0x553300, roughness: 0.9 });
function buildSkyline() {
  for (let i = 0; i < 26; i++) {
    const h = 6 + ((i * 37) % 22);
    const w = 4 + ((i * 53) % 6);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), matBldg);
    const x = ((i % 2) ? 1 : -1) * (TRACK_W / 2 + 6 + ((i * 29) % 30));
    b.position.set(x, h / 2 - 1.5, -160 + (i * 13.7) % 160);
    scene.add(b);
    // a few lit windows
    for (let k = 0; k < 5; k++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.06), matWin);
      win.position.set(((k * 17) % 3 - 1) * w * 0.28, 1 + ((k * 31) % Math.max(2, h - 2)), w / 2 + 0.04);
      b.add(win);
    }
    props.push(b);
  }
  // move buildings with player (loop)
}
function updateSkyline() {
  for (const b of props) {
    b.position.z = ((-((b.position.z + 160 - (dist * 0.9)) % 320)) + 160) - 160 + (b.position.z >= 0 ? 0 : 0);
  }
  // simple: wrap z so buildings stay ahead
  for (const b of props) {
    if (b.position.z - dist * 0.9 > 10) b.position.z -= 320;
  }
}
buildSkyline();

/* ---------------- entities (obstacles + pickups) ---------------- */
const ents = [];   // active
const pool = [];   // dead for reuse
const geos = {};   // shared geometries
const mats = {
  train: new THREE.MeshStandardMaterial({ color: 0xf2b90c, roughness: 0.55, metalness: 0.25 }),
  trainDark: new THREE.MeshStandardMaterial({ color: 0x8a6a05, roughness: 0.7 }),
  trainWin: new THREE.MeshStandardMaterial({ color: 0x1a2038, roughness: 0.3, metalness: 0.5 }),
  hurdle: new THREE.MeshStandardMaterial({ color: 0xff5d5d, roughness: 0.8 }),
  hurdleDark: new THREE.MeshStandardMaterial({ color: 0x8a3a3a, roughness: 0.9 }),
  beam: new THREE.MeshStandardMaterial({ color: 0xe8ecf5, roughness: 0.75 }),
  beamLeg: new THREE.MeshStandardMaterial({ color: 0x8b96ad, roughness: 0.8 }),
  bottle: new THREE.MeshStandardMaterial({ color: 0x4fae74, roughness: 0.35, metalness: 0.15, emissive: 0x0a2a18, emissiveIntensity: 0.55 }),
  propColored: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 }),
  bottleCap: new THREE.MeshStandardMaterial({ color: 0xdfe4ee, roughness: 0.6 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xc2432e, roughness: 0.85 }),
};

function buildTrain() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.55, 26), mats.train);
  body.position.y = 1.28;
  g.add(body);
  // windows strip
  for (let k = 0; k < 9; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 0.9), mats.trainWin);
    w.position.set(0, 1.55, -11.5 + k * 2.9);
    g.add(w);
  }
  // nose (front toward player, +z)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.6, 1.2), mats.train);
  nose.position.set(0, 1.45, 13.1);
  g.add(nose);
  const light = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.12), mats.bottleCap);
  light.position.set(0, 0.8, 13.75);
  g.add(light);
  // bumper stripes
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.3, 26.02), mats.trainDark);
  stripe.position.y = 0.45;
  g.add(stripe);
  return g;
}
function buildHurdle() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.24, 0.16), mats.hurdle);
  bar.position.y = 0.95;
  g.add(bar);
  for (const sx of [-0.95, 0.95]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.14), mats.hurdleDark);
    leg.position.set(sx, 0.475, 0);
    g.add(leg);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.1, 0.18), mats.hurdleDark);
  stripe.position.y = 1.08;
  g.add(stripe);
  return g;
}
function buildBeam() {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 0.7), mats.beam);
  beam.position.y = 1.85;
  g.add(beam);
  for (const sx of [-1.2, 1.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 0.16), mats.beamLeg);
    leg.position.set(sx, 0.925, 0);
    g.add(leg);
  }
  return g;
}
function buildBottle() {
  const g = new THREE.Group();
  if (propGeos.bottle) {
    const m = new THREE.Mesh(propGeos.bottle, propColored.bottle ? mats.propColored : mats.bottle);
    g.add(m);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.52, 10), mats.bottle);
    body.position.y = 0.32;
    g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 10), mats.bottle);
    neck.position.y = 0.63;
    g.add(neck);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10), mats.bottleCap);
    cap.position.y = 0.73;
    g.add(cap);
  }
  return g;
}
/* Modly-generated GLB props (decimated) — load async, replace placeholders */
const gltfLoader = new THREE.GLTFLoader();
const propGeos = {};
const propColored = {};
function loadPropGLB(name, path, targetHeight) {
  gltfLoader.load(path, (gltf) => {
    let best = null, bestVol = -1;
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        const vol = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
        if (vol > bestVol) { bestVol = vol; best = o; }
      }
    });
    if (best) {
      const bb = best.geometry.boundingBox;
      const h = Math.max(0.001, bb.max.y - bb.min.y);
      const geo = best.geometry.clone();
      geo.scale(targetHeight / h, targetHeight / h, targetHeight / h);
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      propGeos[name] = geo;
      propColored[name] = best.geometry.hasAttribute('color');
      console.log('[pfandjager] ' + name + ' GLB loaded:', geo.attributes.position.count, 'verts');
    }
  }, undefined, (e) => console.warn('[pfandjager] ' + name + ' load failed:', e));
}
loadPropGLB('bottle', 'assets/bottle.glb', 0.9);
loadPropGLB('crate', 'assets/crate.glb', 0.55);
function buildCrate() {
  const g = new THREE.Group();
  if (propGeos.crate) {
    const m = new THREE.Mesh(propGeos.crate, propColored.crate ? mats.propColored : mats.crate);
    g.add(m);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), mats.crate);
    box.position.y = 0.25;
    g.add(box);
    const grid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.72), mats.beamLeg);
    grid.position.y = 0.5;
    g.add(grid);
  }
  return g;
}
const BUILDERS = { train: buildTrain, hurdle: buildHurdle, beam: buildBeam, bottle: buildBottle, crate: buildCrate };

function spawnEnt(type, lane, z, opts = {}) {
  let e = pool.find(p => p.type === type && p.dead);
  if (!e) {
    const mesh = BUILDERS[type]();
    scene.add(mesh);
    e = { type, mesh, dead: true };
    pool.push(e);
  }
  e.dead = false;
  e.lane = lane;
  e.z = z;
  e.passed = false;
  e.collected = false;
  e.spin = 0;
  const d = {
    train:  { halfLen: 13.2, yTop: 2.6,  yBot: 0 },
    hurdle: { halfLen: 0.35, yTop: 1.15, yBot: 0 },
    beam:   { halfLen: 0.5,  yTop: 2.6,  yBot: 1.7 },
    bottle: { halfLen: 0.3,  yTop: 0.75, yBot: 0 },
    crate:  { halfLen: 0.45, yTop: 0.55, yBot: 0 }
  }[type];
  e.halfLen = d.halfLen; e.yTop = d.yTop; e.yBot = d.yBot;
  e.mesh.position.set(LANES[lane], 0, z);
  e.mesh.visible = true;
  ents.push(e);
  return e;
}
function killEnt(e) {
  e.dead = true; e.mesh.visible = false;
  const i = ents.indexOf(e);
  if (i >= 0) ents.splice(i, 1);
}

/* ---------------- spawn patterns (safe-path guaranteed) ---------------- */
const ROW_Z = -100;
const ROW_GAP = 16;
let nextRowZ = ROW_Z;
function spawnRow() {
  const r = Math.random();
  const d = Math.random();
  let pattern;
  // weighted patterns; each leaves >=1 free lane (design rule)
  if (r < 0.30) pattern = 'train1';
  else if (r < 0.52) pattern = 'train2';
  else if (r < 0.72) pattern = 'hurdles';
  else if (r < 0.87) pattern = 'beams';
  else pattern = 'mix';
  const lane = (Math.random() * 3) | 0;
  const bottleLane = (Math.random() * 3) | 0;
  const z = nextRowZ;
  nextRowZ -= ROW_GAP;

  switch (pattern) {
    case 'train1': {
      spawnEnt('train', lane, z);
      spawnEnt('bottle', (lane + 1) % 3, z + 4);
      spawnEnt('bottle', (lane + 1) % 3, z + 6);
      break;
    }
    case 'train2': {
      const l1 = lane, l2 = (lane + 2) % 3;
      spawnEnt('train', l1, z);
      spawnEnt('train', l2, z - 40);
      for (let k = 0; k < 4; k++) spawnEnt('bottle', (lane + 1) % 3, z + 2 + k * 2.2);
      break;
    }
    case 'hurdles': {
      spawnEnt('hurdle', lane, z);
      spawnEnt('hurdle', (lane + 2) % 3, z);
      // arc of bottles over the first hurdle
      for (let k = 0; k < 3; k++) {
        const b = spawnEnt('bottle', lane, z + 0.6 + k * 0.7, { arcY: 1.0 + Math.sin((k + 0.5) / 3 * Math.PI) * 0.7 });
        b.spin = 1;
      }
      break;
    }
    case 'beams': {
      spawnEnt('beam', lane, z);
      spawnEnt('beam', (lane + 2) % 3, z);
      for (let k = 0; k < 3; k++) spawnEnt('bottle', (lane + 1) % 3, z + 1 + k * 2);
      break;
    }
    case 'mix': {
      if (d < 0.5) {
        spawnEnt('hurdle', lane, z);
        spawnEnt('beam', (lane + 2) % 3, z - 6);
        for (let k = 0; k < 2; k++) spawnEnt('bottle', lane, z + 0.6 + k * 1.2);
      } else {
        spawnEnt('train', lane, z);
        spawnEnt('hurdle', (lane + 1) % 3, z + 2);
        for (let k = 0; k < 2; k++) spawnEnt('bottle', (lane + 2) % 3, z - 2 + k * 2);
      }
      if (Math.random() < 0.25) spawnEnt('crate', (Math.random() * 3) | 0, z + 8);
      break;
    }
  }
}

/* ---------------- particles ---------------- */
const P_MAX = 320;
const pPos = new Float32Array(P_MAX * 3);
const pVel = new Float32Array(P_MAX * 3);
const pLife = new Float32Array(P_MAX);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const pMat = new THREE.PointsMaterial({ color: 0x6fd08c, size: 0.12, transparent: true, opacity: 0.9 });
const pPoints = new THREE.Points(pGeo, pMat);
scene.add(pPoints);
let pCursor = 0;
function burst(x, y, z, n, color, spread) {
  pMat.color.set(color);
  for (let i = 0; i < n; i++) {
    const idx = pCursor; pCursor = (pCursor + 1) % P_MAX;
    pPos[idx * 3] = x; pPos[idx * 3 + 1] = y; pPos[idx * 3 + 2] = z;
    pVel[idx * 3] = (Math.random() - 0.5) * (spread || 4);
    pVel[idx * 3 + 1] = Math.random() * 4 + 1;
    pVel[idx * 3 + 2] = (Math.random() - 0.5) * (spread || 4);
    pLife[idx] = 0.5 + Math.random() * 0.4;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < P_MAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; continue; }
    pVel[i * 3 + 1] -= 9 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true;
}

/* ---------------- floating score labels ---------------- */
const floats = [];
function addFloat(worldX, worldY, worldZ, text, color) {
  floats.push({ x: worldX, y: worldY, z: worldZ, text, color, life: 1.1, max: 1.1 });
}
function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.life -= dt; f.y += dt * 1.6;
    if (f.life <= 0) floats.splice(i, 1);
  }
}

/* ---------------- game logic (deterministic, dt-driven) ---------------- */
function fmtCents(c) {
  const eur = (c / 100).toFixed(2);
  return lang === 'de' ? eur.replace('.', ',') + ' €' : '€' + eur;
}
function startGame() {
  audio();
  state = 'play';
  runTime = 0; speed = BASE_SPEED; cents = 0;
  combo = 0; comboTimer = 0; newBest = false;
  dist = 0; nearMissCount = 0;
  timeScale = 1; dyingT = 0; shakeT = 0;
  spawnEnabled = true; // defensive: test hook must never leak across runs
  player.lane = 1; player.x = 0; player.targetX = 0;
  player.y = 0; player.vy = 0; player.onGround = true; player.slideT = 0;
  player.group.rotation.set(0, 0, 0);
  player.group.position.y = 0;
  for (const e of ents) killEnt(e);
  ents.length = 0;
  nextRowZ = ROW_Z;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('over').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('chrome').classList.remove('hidden');
  refreshHUD();
  musicStart();
}
function crash() {
  state = 'dying';
  dyingT = 0;
  timeScale = 0.22;
  shakeT = 0.9; shakeAmp = 1.6;
  burst(player.x, 1, PLAYER_Z, 40, 0xffd166, 6);
  SFX.crash();
}
function finishDeath() {
  state = 'over';
  timeScale = 1;
  newBest = cents > best;
  if (newBest) { best = cents; localStorage.setItem('pj.best', String(best)); SFX.best(); }
  document.getElementById('overStats').innerHTML =
    '<div style="font-size:clamp(24px,6vw,40px);color:var(--amber);margin-bottom:8px">' + fmtCents(cents) + '</div>' +
    t().earned + ' · ' + t().best + ': ' + fmtCents(best) +
    (newBest ? '<br><span style="color:var(--amber)">' + t().newBest + '</span>' : '');
  document.getElementById('over').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('chrome').classList.add('hidden');
}
function hitEntity(e) {
  crash();
  killEnt(e);
}
function collect(e) {
  combo++;
  comboTimer = COMBO_WINDOW;
  const m = mult();
  const val = (e.type === 'crate' ? 100 : 25) * m;
  cents += val;
  addFloat(e.mesh.position.x, 1.4, e.mesh.position.z, '+' + fmtCents(val), e.type === 'crate' ? '#ffb545' : '#6fd08c');
  burst(e.mesh.position.x, 0.8, e.mesh.position.z, e.type === 'crate' ? 22 : 10, e.type === 'crate' ? 0xffb545 : 0x6fd08c, 3);
  if (e.type === 'crate') SFX.crate(); else SFX.collect();
  killEnt(e);
  refreshHUD();
}
function nearMiss(e) {
  nearMissCount++;
  combo++;
  comboTimer = COMBO_WINDOW;
  cents += 5;
  addFloat(player.x, 2.0, PLAYER_Z + 2, '+0,05 €', '#8b96ad');
  SFX.nearMiss();
  refreshHUD();
}

function update(dt) {
  if (state !== 'play') { // dying continues with slow-mo
    if (state === 'dying') {
      dyingT += dt;
      player.group.rotation.x += dt * 14;
      player.group.position.y += dt * 3;
      if (dyingT > 1.1) finishDeath();
    }
    updateParticles(dt); updateFloats(dt);
    return;
  }
  runTime += dt;
  dist += speed * dt;
  speed = Math.min(MAX_SPEED, BASE_SPEED + 18 * (1 - Math.exp(-runTime / 42)));

  // combo window
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) { combo = 0; refreshHUD(); } }

  // player lateral
  const targ = LANES[player.lane];
  player.targetX = targ;
  const dx = targ - player.x;
  const switchSpeed = 11;
  if (Math.abs(dx) > 0.001) {
    const step = Math.sign(dx) * Math.min(Math.abs(dx), switchSpeed * dt);
    player.x += step;
    player.tilt = -Math.sign(dx) * Math.min(0.42, Math.abs(dx) * 0.5);
  } else {
    player.x = targ;
    player.tilt *= Math.max(0, 1 - 10 * dt);
  }

  // vertical: jump / slide
  if (!player.onGround) {
    player.vy -= 24 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; player.onGround = true; }
  }
  if (player.slideT > 0) {
    player.slideT -= dt;
    if (player.slideT <= 0) player.slideT = 0;
  }

  // run animation
  player.runPhase += speed * dt * 1.6;

  // spawn rows
  if (spawnEnabled) {
    while (nextRowZ > ROW_Z - (dist + 230)) { spawnRow(); }
  }

  // entities
  const playerTop = player.onGround ? 1.62 : 1.62 + player.y;
  const playerBot = player.slideT > 0 ? 0.62 : (player.onGround ? 0 : player.y);
  const sliding = player.slideT > 0;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    e.z += speed * dt;
    if (e.type === 'bottle' || e.type === 'crate') {
      e.mesh.rotation.y += (e.spin ? 3 : 1.2) * dt;
      e.mesh.position.y = e.type === 'crate' ? 0 : (e.arcY ? Math.max(0, Math.sin(e.arcY * Math.PI) * 1.1) : 0);
    }
    e.mesh.position.z = e.z;

    if (e.z > 6) { // passed player
      if (!e.passed) {
        e.passed = true;
        if ((e.type === 'train' || e.type === 'hurdle') && Math.abs(e.lane - player.lane) === 1 && player.onGround && !sliding) {
          nearMiss(e);
        }
      }
      if (e.z > 20) killEnt(e);
      continue;
    }
    const zOverlap = Math.abs(e.z - PLAYER_Z) < e.halfLen + 0.35;
    if (!zOverlap) continue;
    const laneOverlap = Math.abs(e.mesh.position.x - player.x) < LANE_W * 0.44;
    if (!laneOverlap) continue;
    if (e.type === 'bottle' || e.type === 'crate') {
      if (playerBot < e.yTop && playerTop > e.yBot) collect(e);
    } else {
      // obstacle
      const under = playerTop < e.yBot + 0.05;
      const over = playerBot > e.yTop - 0.08;
      if (!(under || over)) hitEntity(e);
    }
  }

  // shake decay
  if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) shakeAmp = 0; }

  updateParticles(dt);
  updateFloats(dt);
  ensureTrack(dist + SEGS_AHEAD * SEG_LEN);
  updateSkyline();
  updateLamps();
}

/* ---------------- render ---------------- */
function render() {
  const px = player.x * 0.62;
  const py = 4.6 + player.y * 0.25;
  camera.position.x += (px - camera.position.x) * Math.min(1, 0.14);
  camera.position.y += (py - camera.position.y) * Math.min(1, 0.14);
  camera.position.z = 9.8;
  camera.lookAt(player.x * 0.8, 1.7 + player.y * 0.2, -9);

  // player pose
  const g = player.group;
  g.position.x = player.x;
  g.position.z = PLAYER_Z;
  g.rotation.z = player.tilt;
  shadow.position.x = player.x;
  shadow.position.z = PLAYER_Z;
  const ph = player.runPhase;
  if (player.onGround && state === 'play') {
    const sw = Math.sin(ph), sw2 = Math.sin(ph * 2);
    // run cycle: leg swing + counter arm swing + body bob + slight yaw
    g.position.y = 0.06 + Math.abs(Math.cos(ph)) * 0.07;
    g.rotation.x = 0.1;
    g.rotation.y = Math.sin(ph) * 0.06;
    player.legs[0].rotation.x = sw * 1.05;
    player.legs[1].rotation.x = -sw * 1.05;
    player.legs[0].position.y = 0.36 + Math.max(0, Math.sin(ph)) * 0.12;
    player.legs[1].position.y = 0.36 + Math.max(0, -Math.sin(ph)) * 0.12;
    player.arms[0].rotation.x = -sw * 0.85 - 0.25;
    player.arms[1].rotation.x = sw * 0.85 - 0.25;
    player.arms[0].rotation.z = 0.12;
    player.arms[1].rotation.z = -0.12;
    shadow.scale.setScalar(1 + Math.abs(Math.cos(ph)) * 0.12);
    shadow.position.y = 0.02;
  } else if (state === 'play' && !player.onGround) {
    // jump: legs tucked, arms out, lean forward
    g.position.y = player.y;
    g.rotation.x = 0.3;
    player.legs[0].rotation.x = 0.95;
    player.legs[1].rotation.x = 1.3;
    player.legs[0].position.y = 0.36;
    player.legs[1].position.y = 0.36;
    player.arms[0].rotation.x = -2.2;
    player.arms[1].rotation.x = -2.6;
    shadow.scale.setScalar(Math.max(0.55, 1 - player.y * 0.25));
    shadow.position.y = 0.02;
  }
  if (player.slideT > 0 && state === 'play') {
    // slide: lean back, legs forward, low
    g.rotation.x = 1.15;
    g.rotation.z += Math.sin(ph) * 0.05;
    g.position.y = 0.22;
    player.legs[0].rotation.x = 0.4;
    player.legs[1].rotation.x = 0.4;
    player.arms[0].rotation.x = 0.7;
    player.arms[1].rotation.x = 0.7;
    shadow.scale.setScalar(1.25);
    shadow.position.y = 0.02;
  }

  // shake
  if (shakeT > 0 && state !== 'menu') {
    camera.position.x += (Math.random() - 0.5) * shakeAmp * 0.12;
    camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.1;
  }

  renderer.render(scene, camera);
}

/* ---------------- HUD ---------------- */
function refreshHUD() {
  document.getElementById('score').innerHTML = '<span class="eur">' + fmtCents(cents) + '</span>';
  document.getElementById('combo').textContent =
    combo >= 2 ? t().combo + ' ' + combo + (mult() > 1 ? '  x' + mult() : '') : '';
}
function refreshText() {
  document.getElementById('menuSub').textContent = t().sub;
  document.getElementById('menuHint').innerHTML = t().hint;
  document.getElementById('startBtn').textContent = t().start;
  document.getElementById('againBtn').textContent = t().again;
  document.getElementById('langBtn').textContent = t().lang;
  document.getElementById('muteBtn').textContent = muted ? '✕' : '♪';
}
function toggleMute() { muted = !muted; localStorage.setItem('pj.muted', muted ? '1' : '0'); if (muted) musicStop(); refreshText(); }
function toggleLang() { lang = lang === 'de' ? 'en' : 'de'; localStorage.setItem('pj.lang', lang); refreshText(); refreshHUD(); }

/* ---------------- input ---------------- */
function moveLane(d) {
  if (state !== 'play') return;
  const nl = Math.max(0, Math.min(2, player.lane + d));
  if (nl !== player.lane) { player.lane = nl; SFX.lane(); }
}
function jump() {
  if (state !== 'play') return;
  if (player.onGround && player.slideT <= 0) {
    player.onGround = false; player.vy = 9.6; SFX.jump();
  }
}
function slide() {
  if (state !== 'play') return;
  if (player.onGround) { player.slideT = 0.65; SFX.slide(); }
}
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); moveLane(-1); }
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); moveLane(1); }
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { e.preventDefault(); jump(); }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); slide(); }
  else if (k === 'Enter' || k === ' ') {
    if (state === 'menu') startGame();
    else if (state === 'over') startGame();
  }
  else if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'play') { state = 'pause'; showPause(true); }
    else if (state === 'pause') { state = 'play'; showPause(false); }
  }
  else if (k === 'm' || k === 'M') toggleMute();
  else if (k === 'l' || k === 'L') toggleLang();
});
window.addEventListener('blur', () => {
  if (state === 'play') { state = 'pause'; showPause(true); }
});
let touchStart = null;
window.addEventListener('touchstart', (e) => {
  audio();
  const tch = e.changedTouches[0];
  touchStart = { x: tch.clientX, y: tch.clientY };
}, { passive: true });
window.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const tch = e.changedTouches[0];
  const dx = tch.clientX - touchStart.x;
  const dy = tch.clientY - touchStart.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < 24) return;
  if (ax > ay) moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) jump();
  else slide();
  touchStart = null;
}, { passive: true });
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', startGame);
document.getElementById('langBtn').addEventListener('click', toggleLang);
document.getElementById('muteBtn').addEventListener('click', toggleMute);
document.getElementById('pauseBtn').addEventListener('click', () => {
  if (state === 'play') { state = 'pause'; showPause(true); }
  else if (state === 'pause') { state = 'play'; showPause(false); }
});
function showPause(on) {
  const hud = document.getElementById('hud');
  if (on) {
    hud.insertAdjacentHTML('beforeend', '<div id="pausedTag" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;color:var(--amber);background:rgba(8,12,24,.55);z-index:6">' + t().paused + '</div>');
  } else {
    const p = document.getElementById('pausedTag');
    if (p) p.remove();
  }
}

/* ---------------- main loop ---------------- */
let last = performance.now();
let fpsEma = 60;
function loop(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (rawDt > 0) fpsEma = fpsEma * 0.95 + (1 / rawDt) * 0.05;
  update(rawDt * timeScale);
  render();
  document.getElementById('fps').textContent = Math.round(fpsEma) + ' fps · ' + renderer.info.render.calls + ' calls';
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- test handle ---------------- */
window.__game = {
  get state() { return state; },
  get cents() { return cents; },
  get combo() { return combo; },
  get mult() { return mult(); },
  get speed() { return speed; },
  get dist() { return dist; },
  get ents() { return ents.length; },
  get fps() { return Math.round(fpsEma); },
  get calls() { return renderer.info.render.calls; },
  get player() { return { lane: player.lane, x: +player.x.toFixed(3), y: +player.y.toFixed(3), onGround: player.onGround, slideT: +player.slideT.toFixed(3) }; },
  start: startGame,
  jump, slide, moveLane,
  spawnRow,
  _update: (dt) => update(dt),
  _setSpawning: (v) => { spawnEnabled = !!v; },
  _ent: (i) => { const e = ents[i]; return e ? { type: e.type, lane: e.lane, z: +e.z.toFixed(2) } : null; },
  _forceTrain: (lane, z) => { spawnEnabled = false; return spawnEnt('train', lane, z); },
  _forceHurdle: (lane, z) => { spawnEnabled = false; return spawnEnt('hurdle', lane, z); },
  _forceBeam: (lane, z) => { spawnEnabled = false; return spawnEnt('beam', lane, z); },
  _forceBottle: (lane, z) => { spawnEnabled = false; return spawnEnt('bottle', lane, z); },
  _forceCrate: (lane, z) => { spawnEnabled = false; return spawnEnt('crate', lane, z); },
  _killAll: () => { for (const e of [...ents]) killEnt(e); ents.length = 0; },
  _bottleGLB: () => !!propGeos.bottle,
  _crateGLB: () => !!propGeos.crate
};

buildPlayer();
ensureTrack(dist + SEGS_AHEAD * SEG_LEN);
refreshText();
requestAnimationFrame(loop);
