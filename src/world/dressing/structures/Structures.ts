// All built things: the Roost, the Old Observatory, the Lantern Spire pavilion and the scattered
// ruins, shrines and cairns. Each site is merged into a handful of meshes by material (solid,
// glowing, cloth, chimes, light pools) so a whole site costs ~5 draw calls.

import { Group, Mesh, type BufferGeometry, type Material } from 'three';
import type { Terrain } from '../../terrain';
import { dressMaterial, swayDepthMaterial } from '../materials';
import { buildRoost, type SiteOutputs } from './Roost';
import { roostPlan } from './roostPlan';
import { siteBuilders, type SiteBuilders } from './kit';
import { lightPoolMesh } from './lightPools';

export interface StructureStats {
  sites: number;
  meshes: number;
  triangles: number;
}

export class Structures {
  readonly group = new Group();
  readonly stats: StructureStats = { sites: 0, meshes: 0, triangles: 0 };

  constructor(terrain: Terrain, out: SiteOutputs) {
    this.group.name = 'dressing:structures';
    const plan = roostPlan(terrain.layout, terrain);
    if (plan) {
      const s = siteBuilders();
      buildRoost(s, plan, terrain, out);
      this.addSite('roost', s);
    }
  }

  private addSite(name: string, s: SiteBuilders): void {
    this.stats.sites++;
    const add = (b: { isEmpty(): boolean; build(force?: boolean): BufferGeometry }, mat: Material, opts: { shadow: boolean; depth?: Material; suffix: string }) => {
      if (b.isEmpty()) return;
      const geo = b.build(true);
      const m = new Mesh(geo, mat);
      m.name = `${name}-${opts.suffix}`;
      m.castShadow = opts.shadow;
      m.receiveShadow = true;
      if (opts.depth) m.customDepthMaterial = opts.depth;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.stats.meshes++;
      this.stats.triangles += (geo.getIndex()?.count ?? 0) / 3;
    };
    add(s.solid, dressMaterial({}), { shadow: true, suffix: 'solid' });
    add(s.glow, dressMaterial({ glow: true, glowDay: 0.3, glowNight: 3.2, rim: 0 }), { shadow: false, suffix: 'glow' });
    add(s.windows, dressMaterial({ glow: true, glowDay: 0, glowNight: 2.6, rim: 0.3, color: '#3b3a44' }), { shadow: false, suffix: 'windows' });
    add(s.cloth, dressMaterial({ sway: 'cloth', doubleSide: true, keepNormals: true }), { shadow: true, depth: swayDepthMaterial('cloth'), suffix: 'cloth' });
    add(s.chime, dressMaterial({ sway: 'chime' }), { shadow: false, suffix: 'chime' });
    const pools = lightPoolMesh(s.pools);
    if (pools) {
      this.group.add(pools);
      this.stats.meshes++;
    }
  }
}
