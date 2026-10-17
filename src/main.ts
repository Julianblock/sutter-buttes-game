import './style.css';
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
import { Environment, type Season, type TimePreset, type Weather } from './world/environment';
import { AirField } from './birds/air';
import { Player } from './birds/player';
import { ChaseCamera } from './birds/camera';
import { Controls } from './birds/input';
import { SPECIES, speciesById } from './birds/species';

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const engine = new Engine(canvas);
  const params = new URLSearchParams(location.search);

  const world = await loadWorld((label, f) => console.log(`[load] ${label} ${(f * 100).toFixed(0)}%`));
  const heightfield = new Heightfield(world);
  const tex = createWorldTextures(world, engine.renderer);
  const regionSizes: [number, number, number] = [
    world.meta.regions.inner.size,
    world.meta.regions.mid.size,
    world.meta.regions.far.size,
  ];

  const env = new Environment();
  env.season = (params.get('season') as Season) || 'summer';
  env.weather = (params.get('weather') as Weather) || 'clear';
  env.setPreset((params.get('time') as TimePreset) || 'golden');
  env.apply(0);

  const atmosphere = new Atmosphere(engine.renderer);
  const terrainShadow = new TerrainShadow(engine.renderer, tex, regionSizes);
  const terrain = new Terrain(tex, regionSizes, world.meta.landcover.size);
  const sky = new Sky();
  engine.scene.add(sky.mesh, terrain.mesh);

  const air = new AirField(heightfield);
  const species = speciesById(params.get('bird') || 'redtail') ?? SPECIES[0];
  const palette = species.palettes[Number(params.get('palette') || 0)] ?? species.palettes[0];
  const player = new Player(species, palette, heightfield, air);
  const sp = (params.get('spawn') || '1800,620,3600,3.3').split(',').map(Number);
  player.flight.spawn(sp[0], sp[1], sp[2], sp[3]);
  engine.scene.add(player.object);

  const cam = engine.camera;
  const controls = new Controls();
  const chase = new ChaseCamera(cam, heightfield, canvas);
  const free = params.has('free');
  const inspect = params.has('inspect');
  let inspectAngle = Number(params.get('inspect') || 0.8);
  let inspectHeight = 0.35;

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
      // Model viewer: frozen glide pose, camera orbiting the bird.
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
    } else {
      const input = controls.update(dt);
      if (controls.consume('KeyC')) chase.cycle();
      player.step(dt, input);
      player.sync();
      chase.update(dt, player.flight, player.object);
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
    sky.update(cam, env.exposure);
    engine.render(env.exposure, G.uNight.value, G.uTime.value);
    schedule(frame);
  }
  // Background/headless tabs throttle rAF; ?timer keeps the loop alive for capture.
  const schedule = params.has('timer') ? (f: () => void) => setTimeout(f, 16) : requestAnimationFrame;
  frame();
  Object.assign(window, {
    engine, env, terrain, heightfield, G, player, chase, air, controls,
    inspectView: (a: number, h: number) => ((inspectAngle = a), (inspectHeight = h)),
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;padding:20px">${err.stack || err}</pre>`);
});
