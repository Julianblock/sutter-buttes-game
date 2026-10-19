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
import { Grass } from './veg/grass';
import { WindParticles } from './life/windParticles';
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
import { RoadIndex } from './world/roadIndex';
import { Fences } from './world/fences';
import { Cemeteries, planCemeteries } from './world/cemetery';
import { resolveDestination } from './world/destinations';
import { Vehicle } from './vehicle/vehicle';
import { PAINTS } from './vehicle/carModel';
import { DriveControls } from './vehicle/driveControls';
import { DriveCamera } from './vehicle/driveCamera';
import { DustTrail } from './vehicle/dust';
import { Precipitation } from './weather/precip';
import { Water } from './world/water';
import { WaterSurface } from './render/waterSurface';
import { Fish } from './life/fish';
import { FISH } from './life/fishSpecies';
import { Ghosts } from './life/ghosts';
import { Discoveries } from './ui/discoveries';
import { Lore } from './world/lore';
import { VolcanoVision } from './world/volcano';
import { isTouch, lowPower } from './ui/device';
import { TouchControls } from './ui/touch';
import { Town } from './world/town';
import { Pedestrians } from './life/pedestrians';

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
  const cemeteryPlans = planCemeteries(world.osm);
  const roadIndex = new RoadIndex(world.osm);
  // Carves river and pond beds into the height grids, so it runs before the GPU copies.
  const water = new Water(world, heightfield, roadIndex);
  G.uWaterTex.value = water.texture;
  G.uWaterSize.value = water.size;
  const tex = createWorldTextures(world, engine.renderer);
  const regionSizes: [number, number, number] = [
    world.meta.regions.inner.size,
    world.meta.regions.mid.size,
    world.meta.regions.far.size,
  ];

  const settings = loadSettings(params);
  const env = new Environment();
  env.season = settings.season;
  env.setWeather(settings.weather);
  env.moon = settings.moon;
  env.timeFlow = settings.timeFlow;
  env.setPreset(settings.time);
  env.apply(0);

  const atmosphere = new Atmosphere(engine.renderer);
  const terrainShadow = new TerrainShadow(engine.renderer, tex, regionSizes);
  const terrain = new Terrain(tex, regionSizes, world.meta.landcover.size);
  const sky = new Sky();
  const waterSurface = new WaterSurface(terrain);
  engine.scene.add(sky.mesh, terrain.mesh, waterSurface.mesh);

  loading.progress('Growing the oak woodland', 0.95);
  const treeBuf = await fetch('data/trees.bin').then((r) => r.arrayBuffer());
  const trees = new Trees(treeBuf, world.meta.trees?.size ?? 16000, heightfield, roadIndex, cemeteryPlans.flatMap((p) => p.trees), water);
  engine.scene.add(trees.group);
  const seasonMonth = () => env.month - 1 + (env.day - 1) / 30;
  trees.setSeason(seasonMonth());
  const grass = new Grass(terrain.material.uniforms, heightfield);
  engine.scene.add(grass.group);
  const motes = new WindParticles();
  engine.scene.add(motes.points);

  loading.progress('Raising barns and broadcast towers', 0.97);
  // Before roads and traffic: the town's bridge decks carry them over the rivers.
  const town = world.town ? new Town(world.town.data, heightfield, water, world.osm) : null;
  const pedestrians = town ? new Pedestrians(town, world.osm, roadIndex, heightfield, lowPower ? 900 : 2800) : null;
  if (town) engine.scene.add(town.group);
  if (pedestrians) engine.scene.add(pedestrians.mesh);
  const power = new PowerLines(world.osm, heightfield);
  const props = new Props(world.osm, heightfield, power.pylons, town ? (x, z) => town.covers(x, z) : undefined);
  const lights = new LightPoints([...props.lights, ...(town?.lights ?? [])]);
  engine.scene.add(props.group, lights.points, power.mesh);
  const cemeteries = new Cemeteries(cemeteryPlans, heightfield);
  engine.scene.add(cemeteries.group);
  const roads = new Roads(world.osm, heightfield);
  engine.scene.add(roads.group);
  const fences = new Fences(world.osm, heightfield, roadIndex);
  engine.scene.add(fences.group);
  const traffic = new Traffic(world.osm, heightfield);
  engine.scene.add(traffic.group);
  const wildlife = new Wildlife(heightfield);
  engine.scene.add(wildlife.group);
  const flocks = new Flocks(heightfield);
  flocks.setMonth(env.month);
  engine.scene.add(flocks.mesh);

  const fish = new Fish(water, heightfield);
  fish.setMonth(env.month);
  engine.scene.add(fish.mesh);
  const witches = cemeteryPlans.find((p) => p.name === 'North Butte Cemetery');
  const ghosts = witches ? new Ghosts(witches, heightfield) : null;
  if (ghosts) engine.scene.add(ghosts.group);
  const vent = new THREE.Vector3(-487, heightfield.height(-487, -80) - 15, -80);
  const volcano = new VolcanoVision(vent, { x: -600, z: -1700, r: 4200 });
  engine.scene.add(volcano.points);

  const air = new AirField(heightfield);
  const species = speciesById(settings.bird) ?? SPECIES[0];
  const player = new Player(species, paletteFor(settings), heightfield, air);
  player.flight.water = (x, z) => water.sample(x, z);
  const sp = (params.get('spawn') || '-500,560,2600,3.1416').split(',').map(Number);
  player.flight.spawn(sp[0], sp[1], sp[2], sp[3]);
  engine.scene.add(player.object);
  const car = new Vehicle(heightfield, roadIndex, heightfield.mid.size);
  car.model.setPaint((PAINTS.find((p) => p.id === settings.truck) ?? PAINTS[0]).hex);
  car.physics.obstacles = (x, z, r) => trees.trunkHit(x, z, r);
  engine.scene.add(car.object);
  const dust = new DustTrail();
  engine.scene.add(dust.points);
  const precip = new Precipitation();
  engine.scene.add(precip.mesh);

  const shadow = new ShadowMap();
  trees.addShadowCasters(shadow);
  props.addShadowCasters(shadow);
  town?.addShadowCasters(shadow);
  pedestrians?.addShadowCasters(shadow);
  cemeteries.addShadowCasters(shadow);
  wildlife.addShadowCasters(shadow);
  player.shadowCaster = shadow.addCaster(player.model.geometry, createBirdShadowMaterial(), player.object);
  const carCasters = car.model.addShadows((g, m, f) => shadow.addCaster(g, m, f));

  const cam = engine.camera;
  const controls = new Controls();
  controls.invertPitch = settings.invertPitch;
  const chase = new ChaseCamera(cam, heightfield, canvas);
  const drive = new DriveControls(controls, canvas);
  const driveCam = new DriveCamera(cam, heightfield);
  const places = new Places(world.osm, town?.landmarks);
  const hud = new Hud(places);
  hud.units = settings.units;
  const menu = new Menu(settings);
  const journal = new Discoveries();
  const lore = new Lore(heightfield, journal, volcano, witches, town);
  journal.total = lore.ids.length + FISH.length + (ghosts ? 1 : 0);
  fish.onSpot = (s) => journal.discover({ id: 'fish-' + s.id, kind: 'fish', kicker: 'Fish spotted', title: s.name, text: s.note });
  if (ghosts)
    ghosts.onSight = () =>
      journal.discover({
        id: 'ghosts',
        kind: 'secret',
        kicker: 'North Butte Cemetery · after dark',
        title: 'You are not alone',
        text: 'Pale shapes drift between the old stones, and fade the moment you come close. Whatever they are, the stories were true.',
      });
  ui.append(menu.root, hud.root, hud.help, journal.root);
  const touch = isTouch ? new TouchControls(controls) : null;
  if (touch) {
    document.body.classList.add('touch');
    hud.useTouch();
    ui.append(touch.root);
  }
  /** Phones: go full screen in landscape when play starts (where the browser allows it). */
  const immerse = () => {
    if (!touch || document.fullscreenElement) return;
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  };

  const free = params.has('free');
  const inspect = params.has('inspect');
  let inspectAngle = Number(params.get('inspect') || 0.8);
  let inspectHeight = 0.35;
  let mode: 'menu' | 'fly' = params.has('fly') || params.has('drive') ? 'fly' : 'menu';
  let driving = false;
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
        env.setWeather(s.weather);
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
      case 'truck':
        car.model.setPaint((PAINTS.find((p) => p.id === s.truck) ?? PAINTS[0]).hex);
        break;
    }
    saveSettings(s);
  };
  menu.onChange = applySettings;

  const setMode = (m: 'menu' | 'fly') => {
    mode = m;
    menu.show(m === 'menu');
    hud.show(m === 'fly');
    touch?.show(m === 'fly');
    drive.enabled = m === 'fly' && driving;
    player.object.visible = !driving;
    if (m === 'fly') {
      if (driving) driveCam.reset();
      else chase.snapFrom(cam, player.object.position);
      canvas.focus();
    } else {
      drive.release();
      hud.toggleHelp(false);
    }
  };
  /** Swaps between the bird and the pickup at the current spot. */
  const setDriving = (d: boolean) => {
    driving = d;
    hud.setDriving(d);
    touch?.setDriving(d);
    drive.enabled = d && mode === 'fly';
    if (d) {
      const f = player.flight;
      car.spawn(f.pos.x, f.pos.z, f.psi);
      driveCam.reset();
    } else {
      drive.release();
      const p = car.physics;
      const fw = p.forward;
      player.flight.spawn(p.pos.x + fw.x * 2, p.pos.y + 4, p.pos.z + fw.z * 2, p.psi);
      player.flight.gamma = 0.3;
      chase.snapFrom(cam, player.object.position);
    }
    player.object.visible = !d;
    if (player.shadowCaster) player.shadowCaster.visible = !d;
  };
  for (const c of carCasters) c.visible = false;
  const syncCarCasters = () => {
    for (const c of carCasters) c.visible = car.object.visible;
  };
  const sound = new SoundScape();
  sound.muted = localStorage.getItem('sb-muted') === '1';
  const muteBtn = document.createElement('button');
  muteBtn.className = 'sound-btn';
  const ICON_ON = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none"/></svg>';
  const setMuted = (m: boolean) => {
    sound.setMuted(m);
    localStorage.setItem('sb-muted', m ? '1' : '0');
    muteBtn.innerHTML = m ? ICON_OFF : ICON_ON;
    muteBtn.title = m ? 'Unmute (M)' : 'Mute (M)';
    muteBtn.classList.toggle('off', m);
  };
  setMuted(sound.muted);
  muteBtn.onclick = (e) => {
    e.stopPropagation();
    sound.start();
    setMuted(!sound.muted);
    muteBtn.blur();
    canvas.focus();
  };
  ui.append(muteBtn);
  const wake = () => sound.start();
  addEventListener('pointerdown', wake);
  addEventListener('keydown', wake);
  /** Moves the truck or the bird to a named destination picked in the menu. */
  const goTo = (id: string) => {
    const s = resolveDestination(id, world.osm, cemeteryPlans, town);
    if (!s) return;
    let { x, z } = s;
    if (driving) {
      if (s.road) {
        x += -Math.cos(s.psi) * 1.6;
        z += Math.sin(s.psi) * 1.6;
      }
      car.place(x, z, s.psi);
      driveCam.reset();
    } else {
      player.flight.spawn(x, heightfield.height(x, z) + (s.alt ?? 45), z, s.psi);
      chase.snapFrom(cam, player.object.position);
    }
  };
  const travel = () => {
    if (!menu.place) return;
    goTo(menu.place);
    menu.place = null;
  };
  menu.onFly = () => {
    sound.start();
    immerse();
    if (driving) setDriving(false);
    travel();
    setMode('fly');
  };
  menu.onDrive = () => {
    sound.start();
    immerse();
    if (!driving) setDriving(true);
    travel();
    setMode('fly');
  };
  if (params.has('drive')) setDriving(true);
  if (params.get('place')) goTo(params.get('place')!);
  setMode(mode);

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') setMode(mode === 'menu' ? 'fly' : 'menu');
    if (mode !== 'fly') return;
    if (e.code === 'KeyH') hud.toggleHelp();
    if (e.code === 'KeyT') hud.toggleHidden();
    if (e.code === 'KeyV' && !driving) sound.call(player.species.id);
    if (e.code === 'KeyM') setMuted(!sound.muted);
    if (e.code === 'KeyG' && !e.repeat) setDriving(!driving);
    if (e.code === 'KeyL' && driving) car.headlights = !car.headlightsWanted(G.uNight.value, murky());
  });

  // Habitat sampled in a ring under the bird drives the ambient soundscape.
  const aud: AudioState = {
    speed: 0, agl: 100, flapPhase: 0, flapAmount: 0, perched: false, night: 0, month: 6, hour: 12,
    wet: 0, grass: 0, geese: Infinity, cattle: Infinity, car: Infinity, carSpeed: 0, active: false,
    drive: 0, rpm: 0, throttle: 0, tyre: 0, slip: 0, horn: false,
    rain: 0, snow: 0, roadWet: 0, windSpeed: 0,
  };
  let habitatT = 0;
  const updateSound = (dt: number) => {
    const f = player.flight;
    const p = driving ? car.object.position : player.object.position;
    const agl = driving ? 1.5 : f.agl;
    habitatT -= dt;
    if (habitatT <= 0) {
      habitatT = 0.5;
      let wet = 0;
      let grass = 0;
      const R = 60 + Math.min(agl, 400) * 0.5;
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
    const cp = car.physics;
    aud.speed = driving ? Math.abs(cp.speed) : f.speed;
    aud.agl = agl;
    aud.flapPhase = f.flapPhase;
    aud.flapAmount = driving ? 0 : f.flapAmount;
    aud.perched = !driving && f.state === 'perched';
    aud.drive = driving ? 1 : 0;
    aud.rpm = cp.rpm;
    aud.throttle = drive.input.throttle;
    aud.tyre = cp.surface.rough;
    aud.slip = cp.slip;
    aud.horn = driving && mode === 'fly' && controls.keys.has('KeyV');
    aud.night = G.uNight.value;
    aud.month = env.month;
    aud.hour = env.hours;
    aud.active = mode === 'fly' && !free;
    aud.rain = G.uRain.value;
    aud.snow = G.uSnowCover.value;
    aud.roadWet = G.uWet.value;
    aud.windSpeed = G.uWind.value.length();
    env.listener.copy(cam.position);
    for (const strike of env.takeStrikes()) sound.thunder(strike.dist);
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
    cam.position.y = Math.max(cam.position.y, heightfield.height(cam.position.x, cam.position.z) + 0.3);
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
    cam.near = 0.25;
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

  function previewCar(dt: number) {
    // Menu backdrop while driving: a slow orbit around the parked truck.
    previewT += dt;
    car.sync(dt, G.uNight.value, car.headlightsWanted(G.uNight.value, murky()));
    const b = car.object.position.clone();
    b.y += 1.1;
    const a = car.physics.psi + 0.9 + previewT * 0.06;
    const r = 8.5;
    cam.position.set(b.x + Math.sin(a) * r, b.y + 1.4, b.z + Math.cos(a) * r);
    cam.position.y = Math.max(cam.position.y, heightfield.height(cam.position.x, cam.position.z) + 1.2);
    cam.fov = 42;
    cam.near = 0.25;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(b);
    if (innerWidth > 820) {
      tmpRight.setFromMatrixColumn(cam.matrix, 0);
      const halfW = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * r * cam.aspect;
      cam.lookAt(b.clone().addScaledVector(tmpRight, -halfW * 0.38));
    }
    cam.updateMatrixWorld();
  }

  const clock = new THREE.Clock();
  let lastMie = -1;
  const murky = () => G.uFogDensity.value > 0.003 || G.uRain.value + G.uSnowFall.value > 0.04;

  function frame() {
    step();
    schedule(frame);
  }

  function step() {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    if (!params.has('timer')) engine.adapt(rawDt);
    G.uTime.value += dt;
    env.apply(dt);

    air.time += dt;
    const deck = Math.min(1, Math.max(G.uRain.value, G.uSnowFall.value) * 5);
    air.sun = Math.max(0, Math.sin(env.sunAltitude * THREE.MathUtils.DEG2RAD) * 1.2) * (1 - 0.6 * G.uCloudCover.value) * (1 - deck);
    air.rain = G.uRain.value;
    air.snow = G.uSnowFall.value;
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
      if (driving) previewCar(dt);
      else previewCam(dt);
    } else if (driving) {
      const input = drive.update(dt);
      if (controls.consume('KeyC')) driveCam.cycle();
      car.step(dt, input);
      if (car.physics.crashed > 0) {
        sound.crash(car.physics.crashed);
        driveCam.shake = Math.min(1.5, car.physics.crashed / 6);
        car.physics.crashed = 0;
      }
      car.sync(dt, G.uNight.value, car.headlightsWanted(G.uNight.value, murky()));
      driveCam.update(dt, car.physics, car.model, drive.consumeLook());
      hud.updateCar(dt, car.physics);
    } else {
      const input = controls.update(dt);
      if (controls.consume('KeyC')) chase.cycle();
      player.step(dt, input);
      player.sync();
      cam.near = 0.25;
      chase.update(dt, player.flight, player.object);
      hud.update(dt, player.flight, air);
    }

    if (G.uMieScale.value !== lastMie) {
      lastMie = G.uMieScale.value;
      atmosphere.rebuildTransmittance();
    }
    G.uCamPos.value.copy(cam.position);
    const camWater = water.sample(cam.position.x, cam.position.z);
    const underwater = camWater.mask > 0.3 && cam.position.y < camWater.level - 0.02;
    G.uUnderwater.value = underwater ? 1 : 0;
    G.uCamWaterY.value = camWater.level;
    G.uCloudOffset.value.addScaledVector(G.uWind.value, dt * 4);
    atmosphere.update();
    terrainShadow.update();
    terrain.update(cam);
    trees.update(cam);
    grass.setCar(car.physics.pos.x, car.physics.pos.z, car.physics.psi, car.object.visible);
    grass.update(cam.position, seasonMonth());
    motes.update(cam, heightfield.height(cam.position.x, cam.position.z), window.innerHeight * engine.pixelRatio, (1 - G.uNight.value * 0.9) * (1 - Math.min(1, (G.uRain.value + G.uSnowFall.value) * 4)) * (1 - G.uWet.value * 0.7));
    lights.resize(cam, window.innerHeight * engine.pixelRatio);
    traffic.lights.resize(cam, window.innerHeight * engine.pixelRatio);
    power.resize(cam, window.innerHeight * engine.pixelRatio);
    fences.update(cam, heightfield.height(cam.position.x, cam.position.z), window.innerHeight * engine.pixelRatio);
    traffic.update(dt, cam.position, G.uNight.value, Math.max(G.uNight.value, murky() ? 0.35 : 0), 1 - 0.2 * G.uWet.value - 0.35 * G.uSnowCover.value);
    const sw = G.uSeason.value;
    dust.update(dt, car.physics, driving && mode === 'fly', Math.min(1, sw.z + sw.w * 0.8 + sw.y * 0.2), cam, window.innerHeight * engine.pixelRatio);
    precip.update(dt, cam, window.innerHeight * engine.pixelRatio, car.object.visible ? car.object.matrixWorld : null);
    if (underwater) precip.mesh.visible = false;
    car.model.weather(dt, car.physics.speed);
    car.physics.wet = G.uWet.value;
    car.physics.snow = G.uSnowCover.value;
    car.physics.waterDepth = car.physics.onDeck ? 0 : water.depthAt(car.physics.pos.x, car.physics.pos.z);
    const actor = driving ? car.object.position : player.object.position;
    wildlife.update(dt, cam.position, actor);
    flocks.setMonth(env.month);
    fish.setMonth(env.month);
    fish.update(dt, cam, camWater.mask > 0.3 && cam.position.y < camWater.level + 6, actor);
    ghosts?.update(dt, cam, G.uNight.value);
    volcano.update(dt, cam, window.innerHeight * engine.pixelRatio);
    if (mode === 'fly' && !free) {
      const body = water.sample(actor.x, actor.z).mask > 0.3 ? water.bodyAt(actor.x, actor.z) : null;
      lore.update({
        pos: actor,
        driving,
        underwater,
        truckUnder: driving && car.physics.waterDepth > 1.7,
        water: body,
        agl: driving ? 1.5 : player.flight.agl,
        night: G.uNight.value,
        snowCover: G.uSnowCover.value,
      });
    }
    sound.setFx(underwater ? 1 : 0, ghosts?.presence ?? 0, volcano.level);
    flocks.update(dt, cam.position, { x: air.windX, z: air.windZ });
    syncCarCasters();
    G.uHeadOn.value = car.object.visible ? car.headOn : 0;
    if (G.uHeadOn.value > 0) {
      car.model.body.updateWorldMatrix(true, false);
      G.uHeadPos.value.set(2.9, 0.95, 0).applyMatrix4(car.model.body.matrixWorld);
      G.uHeadDir.value.set(1, -0.035, 0).transformDirection(car.model.body.matrixWorld);
    }
    const focus = free ? cam.position : actor;
    props.update(cam.position, focus);
    town?.update(cam.position, focus);
    pedestrians?.update(dt, cam.position, env.hours);
    shadow.update(engine.renderer, focus);
    G.uInvExposure.value = 1 / env.exposure;
    updateSound(dt);
    sky.update(cam, env.exposure);
    engine.render(env.exposure, G.uNight.value, G.uTime.value);
  }
  // Background/headless tabs throttle rAF; ?timer keeps the loop alive for capture.
  const schedule = params.has('timer') ? (f: () => void) => setTimeout(f, 16) : requestAnimationFrame;
  frame();
  loading.done();
  Object.assign(window, {
    town, pedestrians, touch, engine, env, terrain, water, waterSurface, fish, ghosts, volcano, journal, lore, heightfield, G, player, chase, air, car, driveCam, roadIndex, fences, dust, drive, shadow, precip, cemeteries, controls, menu, hud, places, trees, props, lights, traffic, wildlife, flocks, sound, power, grass,
    inspectView: (a: number, h: number) => ((inspectAngle = a), (inspectHeight = h)),
    /** Renders a frame and returns it as a JPEG data URL (debug capture). */
    snap: (w = 1100, x0 = 0, y0 = 0, cw = 1, ch = 1) => {
      engine.render(env.exposure, G.uNight.value, G.uTime.value);
      const c = engine.renderer.domElement;
      const o = document.createElement('canvas');
      o.width = w;
      o.height = Math.round((w * c.height * ch) / (c.width * cw));
      o.getContext('2d')!.drawImage(c, x0 * c.width, y0 * c.height, cw * c.width, ch * c.height, 0, 0, o.width, o.height);
      return o.toDataURL('image/jpeg', 0.88);
    },
    setMode,
    setDriving,
    /** Debug: runs whole frames now, for captures from throttled background tabs. */
    tick: (n = 1) => {
      for (let i = 0; i < n; i++) step();
    },
    /** Debug: [x, y, z, tx, ty, tz, minAGL?] views → 'x|jpeg|jpeg…' (needs ?free). */
    capture: (views: number[][], w = 700) => {
      const shots = ['x'];
      for (const v of views) {
        const h = heightfield.height(v[0], v[2]);
        (window as unknown as { freeLook: (...a: number[]) => void }).freeLook(v[0], Math.max(v[1], h + (v[6] ?? 3)), v[2], v[3], v[4], v[5]);
        controls.keys.clear();
        for (let i = 0; i < 6; i++) step();
        engine.render(env.exposure, G.uNight.value, G.uTime.value);
        const c = engine.renderer.domElement;
        const o = document.createElement('canvas');
        o.width = w;
        o.height = Math.round((w * c.height) / c.width);
        o.getContext('2d')!.drawImage(c, 0, 0, o.width, o.height);
        shots.push(o.toDataURL('image/jpeg', 0.88));
      }
      return shots.join('|');
    },
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;padding:20px">${err.stack || err}</pre>`);
});
