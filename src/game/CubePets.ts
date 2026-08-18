import { Group, Mesh } from 'three';
import { assets } from '../core/Assets';
import type { LevelDef } from '../levels/types';

interface Pet {
  mesh: Mesh;
  baseY: number;
  baseYaw: number;
  phase: number;
}

/** Friendly cube pets make the picnic feel alive without adding more blockers. */
export class CubePets {
  readonly group = new Group();
  private pets: Pet[] = [];
  private t = 0;

  constructor(level: LevelDef) {
    this.group.name = 'cube-pets';
    const cols = level.map[0].length;
    const rows = level.map.length;
    for (let i = 0; i < (level.pets?.length ?? 0); i++) {
      const spec = level.pets![i];
      if (!assets.has('pets', spec.model)) continue;
      const src = assets.get('pets', spec.model);
      const scale = spec.scale ?? 1;
      const mesh = new Mesh(src.geometry, src.material);
      mesh.scale.setScalar(scale);
      mesh.position.set(
        (spec.at[0] - (cols - 1) / 2) * level.tileSize,
        src.size.y * scale * 0.5,
        (spec.at[1] - (rows - 1) / 2) * level.tileSize
      );
      mesh.rotation.y = (i * Math.PI) / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.pets.push({ mesh, baseY: mesh.position.y, baseYaw: mesh.rotation.y, phase: i * 1.73 });
    }
  }

  update(dt: number) {
    this.t += dt;
    for (const pet of this.pets) {
      const wave = this.t * 2.4 + pet.phase;
      pet.mesh.position.y = pet.baseY + Math.abs(Math.sin(wave)) * 0.16;
      pet.mesh.rotation.y = pet.baseYaw + Math.sin(wave * 0.55) * 0.3;
      pet.mesh.rotation.z = Math.sin(wave) * 0.06;
    }
  }

  dispose() {
    this.group.remove(...this.group.children);
    this.pets.length = 0;
  }
}
