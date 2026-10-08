// Assembles the whole wyvern mesh for a rig and a look: body, head, limbs, wings and every
// cosmetic part, into one indexed BufferGeometry with two groups (0 = body, 1 = membranes).

import type { BufferGeometry, Vector3 } from 'three';
import type { WyvernLook } from '../../core/types';
import { GeoBuilder } from './builder';
import type { RigDef } from './rig';
import { buildBody } from './parts/body';
import { buildHead } from './parts/head';
import { buildLegs } from './parts/legs';
import { buildWings } from './parts/wings';
import { buildFrill, buildHorns, buildPlates, buildTailTip } from './parts/cosmetics';
import { buildSaddle, type SaddleInfo } from './parts/saddle';

export interface WyvernMeshInfo {
  geometry: BufferGeometry;
  triangles: number;
  vertices: number;
  eyeCenter: Vector3;
  eyeAxis: Vector3;
  eyeRadius: number;
  membraneArea: number;
  saddle: SaddleInfo;
}

export function buildWyvernGeometry(rig: RigDef, look: WyvernLook): WyvernMeshInfo {
  const b = new GeoBuilder();
  buildBody(b, rig);
  const head = buildHead(b, rig);
  buildLegs(b, rig);
  const wings = buildWings(b, rig);
  if (rig.props.shape.plates) buildPlates(b, rig, look);
  buildHorns(b, rig, head, look.horns);
  buildFrill(b, rig, head, look.frill, look.saddle);
  buildTailTip(b, rig, look.tail);
  const saddle = buildSaddle(b, rig, look.saddle);
  return {
    geometry: b.build(),
    triangles: b.triangleCount,
    vertices: b.vertexCount,
    eyeCenter: head.eyeCenter,
    eyeAxis: head.eyeAxis,
    eyeRadius: head.eyeRadius,
    membraneArea: wings.membraneArea,
    saddle,
  };
}
