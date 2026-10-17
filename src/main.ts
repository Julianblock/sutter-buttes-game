import './style.css';
import './ui/ui.css';
import * as THREE from 'three';
import { Engine } from './render/engine';
import { Atmosphere } from './render/atmosphere';
import { G } from './render/globals';
import { Terrain } from './render/terrain';
import { TerrainShadow } from './render/terrainShadow';
import { Sky } from './sky/sky';
import { loadWorld } from './world/loader';
import { Heightfield } from './world/heightfield';
import { createWorldTextures } from './world/textures';
import { Environment } from './world/environment';
import { Places } from './world/places';
import { AirField } from './birds/air';
import { Player } from './birds/player';
import { ChaseCamera } from './birds/camera';
import { Controls } from './birds/input';
import { SPECIES, speciesById, type Palette } from './birds/species';
import { Trees } from './veg/trees';
import { ShadowMap } from './render/shadows';
import { Props } from './world/props';
import { PowerLines } from './world/powerLines';
import { LightPoints } from './render/lightPoints';
import { Traffic } from './life/traffic';
import { Roads } from './world/roads';
import { Wildlife } from './life/wildlife';
import { Flocks } from './life/flocks';
import { SoundScape, type AudioState } from './audio/audio';
import { LC } from './world/meta';
import { createBirdShadowMaterial } from './birds/birdShader';
import { LoadingScreen } from './ui/loading';
import { Menu } from './ui/menu';
import { Hud } from './ui/hud';
import { loadSettings, saveSettings, type GameSettings } from './ui/settings';

function paletteFor(s: GameSettings): Palette {
  const sp = speciesById(s.bird) ?? SPECIES[0];
  const base = sp.palettes[s.palette] ?? sp.palettes[0];
  const c = s.custom;
  const p: Palette = { ...base };
  if (c.back) Object.assign(p, { back: c.back, coverts: c.back, secondaries: c.back });
  if (c.belly) Object.assign(p, { belly: c.belly, breast: c.belly, underCoverts: c.belly });
  if (c.head) p.head = c.head;
  if (c.tail) Object.assign(p, { tail: c.tail, tailUnder: c.tail });
  return p;
}

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  const params = new URLSearchParams(location.search);
  const loading = new LoadingScreen();
  document.body.append(loading.root);

  const engine = new Engine(canvas);
  const world = await loadWorld((label, f) => loading.progress(label, f * 0.9));
  loading.progress('Building the valley', 0.92);
  const heightfield = new Heightfield(world);
  const tex = createWorldTextures(world, engine.renderer);
  const regionSizes: [number, number, number] = [
    world.meta.regions.inner.size,
    world.meta.regions.mid.size,
    world.meta.regions.far.size,
  ];

  const settings = loadSettings(params);
  const env = new Environment();
  env.season = settings.season;
  env.weather = settings.weather;
  env.moon = settings.moon;
  env.timeFlow = settings.timeFlow;
  env.setPreset(settings.time);
  env.apply(0);

  const atmosphere = new Atmosphere(engine.renderer);
  const terrainShadow = new TerrainShadow(engine.renderer, tex, regionSizes);
  const terrain = new Terrain(tex, regionSizes, world.meta.landcover.size);
  const sky = new Sky();
  engine.scene.add(sky.mesh, terrain.mesh);

  loading.progress('Growing the oak woodland', 0.95);
  const treeBuf = await fetch('data/trees.bin').then((r) => r.arrayBuffer());
  const trees = new Trees(treeBuf, world.meta.trees?.size ?? 16000, heightfield);
  engine.scene.add(trees.group);
  const seasonMonth = () => env.month - 1 + (env.day - 1) / 30;
  trees.setSeason(seasonMonth());

  loading.progress('Raising barns and broadcast towers', 0.97);
  const power = new PowerLines(world.osm, heightfield);
  const props = new Props(world.osm, heightfield, power.pylons);
  const lights = new LightPoints(props.lights);
  engine.scene.add(props.group, lights.points, power.mesh);
  const roads = new Roads(world.osm, heightfield);
  engine.scene.add(roads.group);
  const traffic = new Traffic(world.osm, heightfield);
  engine.scene.add(traffic.group);
  const wildlife = new Wildlife(heightfield);
  engine.scene.add(wildlife.group);
  const flocks = new Flocks(heightfield);
  flocks.setMonth(env.month);
  engine.scene.add(flocks.mesh);

  const air = new AirField(heightfield);
  const species = speciesById(settings.bird) ?? SPECIES[0];
  const player = new Player(species, paletteFor(settings), heightfield, air);
  const sp = (params.get('spawn') || '-500,560,2600,3.1416').split(',').map(Number);
  player.flight.spawn(sp[0], sp[1], sp[2], sp[3]);
  engine.scene.add(player.object);

  const shadow = new ShadowMap();
  trees.addShadowCasters(shadow);
  props.addShadowCasters(shadow);
  wildlife.addShadowCasters(shadow);
  player.shadowCaster = shadow.addCaster(player.model.geometry, createBirdShadowMaterial(), player.object);

  const cam = engine.camera;
  const controls = new Controls();
  controls.invertPitch = settings.invertPitch;
  const chase = new ChaseCamera(cam, heightfield, canvas);
  const places = new Places(world.osm);
  const hud = new Hud(places);
  hud.units = settings.units;
  const menu = new Menu(settings);
  ui.append(menu.root, hud.root, hud.help);

  const free = params.has('free');
  const inspect = params.has('inspect');
  let inspectAngle = Number(params.get('inspect') || 0.8);
  let inspectHeight = 0.35;
  let mode: 'menu' | 'fly' = params.has('fly') ? 'fly' : 'menu';
  const previewAngle = 0.95;
  let previewT = 0;

  const applySettings = (s: GameSettings, what: keyof GameSettings) => {
    switch (what) {
      case 'bird':
      case 'palette':
      case 'custom':
        player.setBird(speciesById(s.bird) ?? SPECIES[0], paletteFor(s));
        break;
      case 'season':
        env.season = s.season;
        env.setPreset(s.time);
        trees.setSeason(seasonMonth());
        break;
      case 'time':
        env.setPreset(s.time);
        break;
      case 'weather':
        env.weather = s.weather;
        break;
      case 'moon':
        env.moon = s.moon;
        env.setPreset(s.time);
        break;
      case 'timeFlow':
        env.timeFlow = s.timeFlow;
        break;
      case 'invertPitch':
        controls.invertPitch = s.invertPitch;
        break;
      case 'units':
        hud.units = s.units;
        break;
    }
    saveSettings(s);
  };
  menu.onChange = applySettings;

  const setMode = (m: 'menu' | 'fly') => {
    mode = m;
    menu.show(m === 'menu');
    hud.show(m === 'fly');
    if (m === 'fly') {
      chase.snapFrom(cam, player.object.position);
      canvas.focus();
    } else {
      hud.toggleHelp(false);
    }
  };
  const sound = new SoundScape();
  const wake = () => sound.start();
  addEventListener('pointerdown', wake);
  addEventListener('keydown', wake);
  menu.onFly = () => {
    sound.start();
    setMode('fly');
  };
  setMode(mode);

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') setMode(mode === 'menu' ? 'fly' : 'menu');
    if (mode !== 'fly') return;
    if (e.code === 'KeyH') hud.toggleHelp();
    if (e.code === 'KeyT') hud.toggleHidden();
    if (e.code === 'KeyV') sound.call(player.species.id);
    if (e.code === 'KeyM') sound.setMuted(!sound.muted);
  });

  // Habitat sampled in a ring under the bird drives the ambient soundscape.
  const aud: AudioState = {
    speed: 0, agl: 100, flapPhase: 0, flapAmount: 0, perched: false, night: 0, month: 6, hour: 12,
    wet: 0, grass: 0, geese: Infinity, cattle: Infinity, car: Infinity, carSpeed: 0, active: false,
  };
  let habitatT = 0;
  const updateSound = (dt: number) => {
    const f = player.flight;
    const p = player.object.position;
    habitatT -= dt;
    if (habitatT <= 0) {
      habitatT = 0.5;
      let wet = 0;
      let grass = 0;
      const R = 60 + Math.min(f.agl, 400) * 0.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 2 ? R : R * 0.4;
        const lc = heightfield.landcover(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        if (lc === LC.RICE || lc === LC.WETLAND || lc === LC.WATER) wet++;
        if (lc === LC.GRASS || lc === LC.HAY || lc === LC.FALLOW || lc === LC.WOODLAND) grass++;
      }
      aud.wet = wet / 12;
      aud.grass = grass / 12;
      aud.geese = flocks.nearest(p, 0);
      aud.cattle = wildlife.nearest(p, 'cattle');
      const c = traffic.nearest(p);
      aud.car = c.d;
      aud.carSpeed = c.v;
    }
    aud.speed = f.speed;
    aud.agl = f.agl;
    aud.flapPhase = f.flapPhase;
    aud.flapAmount = f.flapAmount;
    aud.perched = f.state === 'perched';
    aud.night = G.uNight.value;
    aud.month = env.month;
    aud.hour = env.hours;
    aud.active = mode === 'fly' && !free;
    sound.update(dt, aud);
  };

  // Debug free camera (?free).
  const c = (params.get('cam') || '0,900,9000,0,-0.08').split(',').map(Number);
  let yaw = c[3];
  let pitch = c[4];
  if (free) cam.position.set(c[0], c[1], c[2]);
  canvas.addEventListener('mousemove', (e) => {
    if (free && e.buttons & 1) {
      yaw -= e.movementX * 0.003;
      pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003));
    }
  });

  /** Debug: aim the free camera at a world point. */
  (window as unknown as { freeLook: unknown }).freeLook = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
    cam.position.set(x, y, z);
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    yaw = Math.atan2(-dx, -dz);
    pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };

  function freeCam(dt: number) {
    const keys = controls.keys;
    const speed = keys.has('ShiftLeft') ? 800 : 120;
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.has('KeyW')) cam.position.addScaledVector(fwd, speed * dt);
    if (keys.has('KeyS')) cam.position.addScaledVector(fwd, -speed * dt);
    if (keys.has('KeyD')) cam.position.addScaledVector(right, speed * dt);
    if (keys.has('KeyA')) cam.position.addScaledVector(right, -speed * dt);
    if (keys.has('KeyE')) cam.position.y += speed * dt;
    if (keys.has('KeyQ')) cam.position.y -= speed * dt;
    cam.position.y = Math.max(cam.position.y, heightfield.height(cam.position.x, cam.position.z) + 2);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }

  const tmpRight = new THREE.Vector3();
  function previewCam(dt: number) {
    // Menu backdrop: the bird hangs in the air while the camera drifts around it.
    previewT += dt;
    player.flight.animateOnly(dt, previewT);
    player.sync();
    const b = player.object.position;
    const r = player.species.shape.wingspan * 2.1 + 1.2;
    // Keep the camera on the lit side of the bird, swaying slowly.
    const L = G.uSunDir.value.y > -0.05 ? G.uSunDir.value : G.uMoonDir.value;
    const sunAz = Math.atan2(L.x, L.z);
    // Front three-quarter view, on whichever side faces the light.
    const psi = player.flight.psi;
    const off = (x: number) => Math.abs(Math.atan2(Math.sin(x - sunAz), Math.cos(x - sunAz)));
    const side = off(psi + previewAngle) < off(psi - previewAngle) ? 1 : -1;
    const a = psi + side * (previewAngle + Math.sin(previewT * 0.12) * 0.35);
    cam.position.set(b.x + Math.sin(a) * r, b.y + r * 0.32, b.z + Math.cos(a) * r);
    const gh = heightfield.height(cam.position.x, cam.position.z);
    cam.position.y = Math.max(cam.position.y, gh + 1.5);
    cam.fov = 42;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(b);
    // Shift the bird right of centre, clear of the menu panel.
    if (innerWidth > 820) {
      tmpRight.setFromMatrixColumn(cam.matrix, 0);
      const halfW = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * r * cam.aspect;
      cam.lookAt(b.clone().addScaledVector(tmpRight, -halfW * 0.38));
    }
    cam.updateMatrixWorld();
  }

  const clock = new THREE.Clock();
  let lastMie = -1;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    G.uTime.value += dt;
    env.apply(dt);

    air.time += dt;
    air.sun = Math.max(0, Math.sin(env.sunAltitude * THREE.MathUtils.DEG2RAD) * 1.2) * (1 - 0.6 * G.uCloudCover.value);
    air.windX = G.uWind.value.x;
    air.windZ = G.uWind.value.y;

    if (free) {
      freeCam(dt);
    } else if (inspect) {
      inspectAngle += dt * 0.25;
      const b = player.flight.pos;
      player.flight.quaternion.identity();
      player.sync();
      const r = player.species.shape.wingspan * 1.6;
      cam.position.set(b.x + Math.sin(inspectAngle) * r, b.y + r * inspectHeight, b.z + Math.cos(inspectAngle) * r);
      cam.fov = 45;
      cam.updateProjectionMatrix();
      cam.lookAt(b);
      cam.updateMatrixWorld();
    } else if (mode === 'menu') {
      controls.update(dt);
      previewCam(dt);
    } else {
      const input = controls.update(dt);
      if (controls.consume('KeyC')) chase.cycle();
      player.step(dt, input);
      player.sync();
      chase.update(dt, player.flight, player.object);
      hud.update(dt, player.flight, air);
    }

    if (G.uMieScale.value !== lastMie) {
      lastMie = G.uMieScale.value;
      atmosphere.rebuildTransmittance();
    }
    G.uCamPos.value.copy(cam.position);
    G.uCloudOffset.value.addScaledVector(G.uWind.value, dt * 4);
    atmosphere.update();
    terrainShadow.update();
    terrain.update(cam);
    trees.update(cam);
    lights.resize(cam, window.innerHeight * engine.pixelRatio);
    traffic.lights.resize(cam, window.innerHeight * engine.pixelRatio);
    power.resize(cam, window.innerHeight * engine.pixelRatio);
    traffic.update(dt, cam.position, G.uNight.value);
    wildlife.update(dt, cam.position, player.object.position);
    flocks.setMonth(env.month);
    flocks.update(dt, cam.position, { x: air.windX, z: air.windZ });
    const focus = free ? cam.position : player.object.position;
    props.update(cam.position, focus);
    shadow.update(engine.renderer, focus);
    G.uInvExposure.value = 1 / env.exposure;
    updateSound(dt);
    sky.update(cam, env.exposure);
    engine.render(env.exposure, G.uNight.value, G.uTime.value);
    schedule(frame);
  }
  // Background/headless tabs throttle rAF; ?timer keeps the loop alive for capture.
  const schedule = params.has('timer') ? (f: () => void) => setTimeout(f, 16) : requestAnimationFrame;
  frame();
  loading.done();
  Object.assign(window, {
    engine, env, terrain, heightfield, G, player, chase, air, controls, menu, hud, places, trees, props, lights, traffic, wildlife, flocks, sound, power,
    inspectView: (a: number, h: number) => ((inspectAngle = a), (inspectHeight = h)),
    setMode,
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;padding:20px">${err.stack || err}</pre>`);
});
