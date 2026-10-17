import * as THREE from 'three';
import { BirdModel } from './birdMesh';
import { applyPalette, createBirdMaterial } from './birdShader';
import { FlightModel, type FlightInput } from './flight';
import type { Palette, Species } from './species';
import type { AirField } from './air';
import type { Heightfield } from '../world/heightfield';

/** The player's bird: species model + plumage + flight dynamics. */
export class Player {
  readonly object = new THREE.Group();
  readonly material = createBirdMaterial();
  model!: BirdModel;
  flight: FlightModel;
  species: Species;
  palette: Palette;
  shadowCaster?: THREE.Mesh;

  constructor(species: Species, palette: Palette, hf: Heightfield, air: AirField) {
    this.species = species;
    this.palette = palette;
    this.flight = new FlightModel(species, hf, air);
    this.setBird(species, palette);
  }

  setBird(species: Species, palette: Palette) {
    if (this.model) {
      this.object.remove(this.model.mesh);
      this.model.geometry.dispose();
    }
    this.species = species;
    this.palette = palette;
    this.model = new BirdModel(species.shape, this.material);
    this.object.add(this.model.mesh);
    if (this.shadowCaster) this.shadowCaster.geometry = this.model.geometry;
    this.flight.setSpecies(species);
    applyPalette(this.material, palette, this.model.headT, this.model.fingerStart);
  }

  setPalette(p: Palette) {
    this.palette = p;
    applyPalette(this.material, p, this.model.headT, this.model.fingerStart);
  }

  /** Advances the flight model, sub-stepping for stability at low frame rates. */
  step(dt: number, input: FlightInput) {
    const steps = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < steps; i++) this.flight.update(dt / steps, input);
  }

  /** Copies the simulated state onto the visible model (once per frame). */
  sync() {
    this.object.position.copy(this.flight.pos);
    this.object.quaternion.copy(this.flight.quaternion);
    this.model.update(this.flight.pose);
    this.object.updateMatrixWorld();
  }
}
