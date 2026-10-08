// Assembles the whole wyvern mesh for a rig and a look: body, head, limbs, wings and every
// cosmetic part, into one indexed BufferGeometry with two groups (0 = body, 1 = membranes).

import type { BufferGeometry, Vector3 } from 'three';
import type { WyvernLook } from '../../core/types';
import { GeoBuilder } from './builder';
import type { RigDef } from './rig';
import { buildBody } from './parts/body';
import { buildHead, type HeadInfo } from './parts/head';
import { buildLegs } from './parts/legs';
import { buildWings, type WingInfo } from './parts/wings';
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

interface BaseParts {
  builder: GeoBuilder;
  head: HeadInfo;
  wings: WingInfo;
}

/** The parts that only depend on the breed, built once per rig and copied for each look. */
const baseCache = new WeakMap<RigDef, BaseParts>();

function baseParts(rig: RigDef): BaseParts {
  let base = baseCache.get(rig);
  if (!base) {
    const builder = new GeoBuilder();
    buildBody(builder, rig);
    const head = buildHead(builder, rig);
    buildLegs(builder, rig);
    const wings = buildWings(builder, rig);
    base = { builder, head, wings };
    baseCache.set(rig, base);
  }
  return base;
}

export function buildWyvernGeometry(rig: RigDef, look: WyvernLook): WyvernMeshInfo {
  const base = baseParts(rig);
  const b = base.builder.snapshot();
  const head = base.head;
  const wings = base.wings;
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
