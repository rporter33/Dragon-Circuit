// Assembles the whole wyvern mesh for a rig, a look and a level of detail: body, head, limbs,
// wings and every cosmetic part, into one indexed BufferGeometry with two groups (0 = body,
// 1 = membranes). Every LOD of a rig skins to the same skeleton (bone indices are the rig's).

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
import { RES, type Lod } from './parts/res';

export type { Lod } from './parts/res';

export interface WyvernMeshInfo {
  geometry: BufferGeometry;
  lod: Lod;
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

/** The parts that only depend on the breed, built once per rig and LOD and copied for each look. */
const baseCache = new WeakMap<RigDef, (BaseParts | undefined)[]>();

function baseParts(rig: RigDef, lod: Lod): BaseParts {
  let list = baseCache.get(rig);
  if (!list) baseCache.set(rig, (list = []));
  let base = list[lod];
  if (!base) {
    const res = RES[lod];
    const builder = new GeoBuilder();
    buildBody(builder, rig, res);
    const head = buildHead(builder, rig, res);
    buildLegs(builder, rig, res);
    const wings = buildWings(builder, rig, res);
    base = list[lod] = { builder, head, wings };
  }
  return base;
}

export function buildWyvernGeometry(rig: RigDef, look: WyvernLook, lod: Lod = 0): WyvernMeshInfo {
  const res = RES[lod];
  const base = baseParts(rig, lod);
  const b = base.builder.snapshot();
  const head = base.head;
  const wings = base.wings;
  if (rig.props.shape.plates) buildPlates(b, rig, look, res);
  buildHorns(b, rig, head, look.horns, res);
  buildFrill(b, rig, head, look.frill, look.saddle, res);
  buildTailTip(b, rig, look.tail, res);
  const saddle = buildSaddle(b, rig, look.saddle, res);
  return {
    geometry: b.build(),
    lod,
    triangles: b.triangleCount,
    vertices: b.vertexCount,
    eyeCenter: head.eyeCenter,
    eyeAxis: head.eyeAxis,
    eyeRadius: head.eyeRadius,
    membraneArea: wings.membraneArea,
    saddle,
  };
}
