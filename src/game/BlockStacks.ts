import { Color, Group, Mesh, type Material, Vector3 } from 'three';
import { assets } from '../core/Assets';
import { Rand } from '../core/Math';
import { PROPS, type PropDef } from '../data/props';
import type { LevelDef } from '../levels/types';
import type { Ball } from './Ball';
import type { SpatialHash } from './SpatialHash';
import type { PropInstance } from './city/Props';

interface Piece {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  halfHeight: number;
  material: Material;
  def: PropDef;
  registered: boolean;
  fallen: boolean;
  resting: boolean;
}

interface Stack {
  x: number;
  z: number;
  pieces: Piece[];
  crumbled: boolean;
}

/**
 * Cheerful little towers that react on first contact. They are intentionally
 * scenery rather than a second collision system: before impact they make the
 * route legible; after it, the loose blocks are a visual reward the ball can
 * freely roll through.
 */
export class BlockStacks {
  readonly group = new Group();
  private stacks: Stack[] = [];
  private rand = new Rand(0xb10c5);
  /** Mild toy-box tints keep the stone/brick silhouettes playful rather than bleak. */
  private palette = [new Color(0xff9c8a), new Color(0x7fd6d0), new Color(0xffd166), new Color(0xa99bea)];

  constructor(
    level: LevelDef,
    private hash: SpatialHash<PropInstance>
  ) {
    this.group.name = 'block-stacks';
    const cols = level.map[0].length;
    const rows = level.map.length;
    const world = ([tx, ty]: [number, number]) => ({
      x: (tx - (cols - 1) / 2) * level.tileSize,
      z: (ty - (rows - 1) / 2) * level.tileSize,
    });

    for (const spec of level.blockStacks ?? []) {
      const models = spec.models.filter((model) => assets.has('blocks', model));
      if (!models.length) continue;
      const at = world(spec.at);
      const pieces: Piece[] = [];
      const scale = spec.scale ?? 1;
      const layers = spec.layers ?? 3;
      const layout: { layer: number; x: number; z: number }[] = [];
      for (let layer = 0; layer < layers; layer++) {
        const side = layers - layer;
        for (let z = 0; z < side; z++) {
          for (let x = 0; x < side; x++) layout.push({ layer, x: x - (side - 1) / 2, z: z - (side - 1) / 2 });
        }
      }
      // A 4-layer pyramid is thirty blocks: big enough to feel like the
      // centrepiece of a picnic playset, small enough that its individual
      // bounces still read when it tumbles.
      for (let i = 0; i < layout.length; i++) {
        const slot = layout[i];
        const model = models[i % models.length];
        const src = assets.get('blocks', model);
        const def = Object.values(PROPS).find((candidate) => candidate.kit === 'blocks' && candidate.model === model);
        if (!def) continue;
        const width = Math.max(src.size.x, src.size.z) * scale;
        const height = src.size.y * scale;
        // Each piece receives its own lightweight material clone, so the stack
        // gets a toy-box palette without recolouring every other use of the
        // source model. The geometry is still shared.
        const material = src.material.clone();
        if ('color' in material) (material as { color: Color }).color.multiply(this.palette[i % this.palette.length]);
        const mesh = new Mesh(src.geometry, material);
        mesh.scale.setScalar(scale);
        mesh.position.set(
          at.x + slot.x * width * 0.72,
          height * 0.5 + slot.layer * height * 0.82,
          at.z + (slot.z + (slot.layer % 2 ? 0.12 : -0.08)) * width * 0.72
        );
        mesh.rotation.y = (i % 2) * (Math.PI / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        pieces.push({ mesh, material, def, vel: new Vector3(), spin: new Vector3(), halfHeight: height * 0.5, fallen: false, resting: false, registered: false });
      }
      this.stacks.push({ x: at.x, z: at.z, pieces, crumbled: false });
    }
  }

  /** @returns how many individual blocks began falling this frame. */
  step(dt: number, ball: Ball) {
    let hit = 0;
    for (const stack of this.stacks) {
      if (!stack.crumbled && Math.hypot(ball.pos.x - stack.x, ball.pos.z - stack.z) < ball.visualRadius + 1.45) {
        stack.crumbled = true;
        hit += stack.pieces.length;
        const push = new Vector3(ball.pos.x - stack.x, 0, ball.pos.z - stack.z);
        if (push.lengthSq() < 0.01) push.set(1, 0, 0);
        push.normalize().multiplyScalar(-2.5);
        for (const piece of stack.pieces) {
          piece.fallen = true;
          piece.vel.set(push.x + this.rand.range(-1.7, 1.7), this.rand.range(2.8, 5.2), push.z + this.rand.range(-1.7, 1.7));
          piece.spin.set(this.rand.range(-7, 7), this.rand.range(-7, 7), this.rand.range(-7, 7));
        }
        ball.bump(0.14);
      }

      for (const piece of stack.pieces) {
        if (!piece.fallen || piece.resting) continue;
        piece.vel.y -= 15 * dt;
        piece.mesh.position.addScaledVector(piece.vel, dt);
        piece.mesh.rotation.x += piece.spin.x * dt;
        piece.mesh.rotation.y += piece.spin.y * dt;
        piece.mesh.rotation.z += piece.spin.z * dt;
        if (piece.mesh.position.y <= piece.halfHeight) {
          piece.mesh.position.y = piece.halfHeight;
          if (piece.vel.y < -1.2) {
            piece.vel.y *= -0.28;
            piece.vel.x *= 0.58;
            piece.vel.z *= 0.58;
            piece.spin.multiplyScalar(0.62);
          } else {
            piece.vel.set(0, 0, 0);
            piece.spin.set(0, 0, 0);
            piece.resting = true;
            this.register(piece);
          }
        }
      }
    }
    return hit;
  }

  /** Settled pieces become ordinary score-giving props, not scenery. */
  private register(piece: Piece) {
    if (piece.registered) return;
    piece.registered = true;
    const mesh = piece.mesh;
    const inst: PropInstance = {
      def: piece.def,
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
      rotY: mesh.rotation.y,
      scale: mesh.scale.x,
      absorbed: false,
      geometry: mesh.geometry,
      material: piece.material,
      hide: () => {
        mesh.visible = false;
        this.group.remove(mesh);
      },
    };
    this.hash.insert(inst);
  }

  dispose() {
    for (const stack of this.stacks) for (const piece of stack.pieces) piece.material.dispose();
    this.group.remove(...this.group.children);
    this.stacks.length = 0;
  }
}
