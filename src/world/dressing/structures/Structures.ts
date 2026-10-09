// All built things: the Roost, the Old Observatory, the Lantern Spire pavilion and the scattered
// ruins, shrines and cairns. Each site is merged into a handful of meshes by material (solid,
// glowing, cloth, chimes, light pools) so a whole site costs ~5 draw calls.

import { Box3, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material, type PerspectiveCamera } from 'three';
import { makeShadowOnly, shadowOnlyMaterial } from '../../../render/shadowOnly';
import type { QualityProfile } from '../../../render/quality';
import { ExclusionSet } from '../exclusions';
import type { Terrain } from '../../terrain';
import { dressMaterial, swayDepthMaterial } from '../materials';
import { buildRoost, type SiteOutputs } from './Roost';
import { setCoarse } from './kit';
import { roostPlan } from './roostPlan';
import { siteBuilders, type SiteBuilders } from './kit';
import { lightPoolMesh } from './lightPools';
import { beaconSprite, buildObservatory, buildPavilion, observatoryKeepOut } from './Landmarks';
import { buildRuins, planRuins, type RuinSite } from './Ruins';

export interface StructureStats {
  sites: number;
  meshes: number;
  /** Near-detail triangles of every site. */
  triangles: number;
  /** Far-detail triangles of the sites that have one. */
  farTriangles: number;
}

/** A site switches to its far version beyond this distance (m from its bounds) at each quality. */
const FAR_DIST: Record<QualityProfile['level'], number> = { low: 90, medium: 140, high: 200, ultra: 280 };

interface Site {
  near: Group;
  far: Group | null;
  bounds: Sphere;
}

/** Outputs nobody reads: the far version of a site registers no keep-outs, colliders or decks. */
const discard = (): SiteOutputs => ({ exclusions: new ExclusionSet(), colliders: [], decks: [] });

/** Run a site builder in coarse mode. */
function coarseBuild(build: (s: SiteBuilders) => void): SiteBuilders {
  const s = siteBuilders();
  setCoarse(true);
  try {
    build(s);
  } finally {
    setCoarse(false);
  }
  return s;
}

export class Structures {
  readonly group = new Group();
  readonly stats: StructureStats = { sites: 0, meshes: 0, triangles: 0, farTriangles: 0 };
  readonly ruins: RuinSite[];
  private sites: Site[] = [];
  private farDist: number;
  /** Per-island shadow casters for the merged ruins (see buildRuinShadows). */
  private ruinShadows: Mesh[] = [];
  private shadows: boolean;

  /**
   * The Roost is built immediately (it's where the game starts). Distant sites register their
   * keep-outs now but build their geometry through `defer`, a little per frame. The Roost, the
   * Observatory and the pavilion also get a far version (whole shingle courses, plain blocks,
   * coarse cloth, no flagstones or chimes) built later, shown beyond a quality-scaled distance.
   */
  constructor(terrain: Terrain, out: SiteOutputs, defer: (task: () => void) => void = (t) => t(), quality?: QualityProfile) {
    this.group.name = 'dressing:structures';
    this.farDist = FAR_DIST[quality?.level ?? 'high'];
    this.shadows = quality?.shadows ?? true;
    const plan = roostPlan(terrain.layout, terrain);
    if (plan) {
      const s = siteBuilders();
      buildRoost(s, plan, terrain, out);
      const site = this.addSite('roost', s);
      defer(() => this.addFar(site, 'roost', coarseBuild((c) => buildRoost(c, plan, terrain, discard()))));
    }
    const obs = terrain.islands.find((sh) => sh.def.landmark === 'observatory');
    if (obs) {
      observatoryKeepOut(obs, out);
      defer(() => {
        const s = siteBuilders();
        buildObservatory(s, obs, terrain, out);
        const site = this.addSite('observatory', s);
        defer(() => this.addFar(site, 'observatory', coarseBuild((c) => buildObservatory(c, obs, terrain, discard()))));
      });
    }
    const spire = terrain.layout.spires.find((sp) => sp.lantern);
    if (spire) {
      defer(() => {
        const s = siteBuilders();
        const beacon = buildPavilion(s, spire, out);
        const site = this.addSite('pavilion', s);
        this.group.add(beaconSprite(beacon));
        this.stats.meshes++;
        defer(() => this.addFar(site, 'pavilion', coarseBuild((c) => buildPavilion(c, spire, discard()))));
      });
    }
    // Ruins last, so they keep clear of everything above.
    this.ruins = planRuins(terrain, out);
    defer(() => {
      const rs = siteBuilders();
      const ends: number[] = [];
      buildRuins(rs, this.ruins, out, ends);
      const site = this.addSite('ruins', rs);
      this.buildRuinShadows(site, ends);
    });
  }

  /** Near or far version per site, by the camera's distance from it. */
  update(camera: PerspectiveCamera): void {
    const c = camera.position;
    for (const site of this.sites) {
      if (!site.far) continue;
      const far = c.distanceTo(site.bounds.center) - site.bounds.radius > this.farDist;
      site.near.visible = !far;
      site.far.visible = far;
    }
  }

  setQuality(q: QualityProfile): void {
    this.farDist = FAR_DIST[q.level];
    this.shadows = q.shadows;
    for (const m of this.ruinShadows) m.castShadow = q.shadows;
  }

  /**
   * The ruins are one merged mesh spread over the whole archipelago, so its bounds always reach
   * the shadow box and the shadow pass drew every ruin (21k triangles) wherever the player was.
   * Cast them instead from one shadow-only mesh per island that shares the merged buffers (each
   * draws its island's contiguous index range), so the shadow camera culls the far ones.
   */
  private buildRuinShadows(site: Site, solidEnds: number[]): void {
    const solid = site.near.children.find((c) => c.name === 'ruins-solid') as Mesh | undefined;
    if (!solid) return;
    const src = solid.geometry;
    const index = src.getIndex();
    const pos = src.getAttribute('position');
    if (!index || !pos) return;
    solid.castShadow = false;
    const box = new Box3();
    const v = new Vector3();
    let start = 0;
    for (let i = 0; i < this.ruins.length; i++) {
      const end = solidEnds[i];
      // An island's sites are consecutive: close the range at its last site.
      if (i + 1 < this.ruins.length && this.ruins[i + 1].islandId === this.ruins[i].islandId) continue;
      if (end > start) {
        const geo = new BufferGeometry();
        geo.setAttribute('position', pos);
        geo.setIndex(index);
        geo.setDrawRange(start, end - start);
        box.makeEmpty();
        for (let k = start; k < end; k++) box.expandByPoint(v.fromBufferAttribute(pos, index.getX(k)));
        geo.boundingBox = box.clone();
        geo.boundingSphere = box.getBoundingSphere(new Sphere());
        const m = makeShadowOnly(new Mesh(geo, shadowOnlyMaterial()));
        m.name = `ruins-shadow-${this.ruins[i].islandId}`;
        m.castShadow = this.shadows;
        m.receiveShadow = false;
        m.matrixAutoUpdate = false;
        this.group.add(m);
        this.ruinShadows.push(m);
      }
      start = end;
    }
  }

  private addFar(site: Site, name: string, s: SiteBuilders): void {
    const far = new Group();
    far.name = `${name}-far`;
    this.addMeshes(far, `${name}-far`, s, true);
    far.visible = false;
    site.far = far;
    this.group.add(far);
  }

  private addSite(name: string, s: SiteBuilders): Site {
    this.stats.sites++;
    const near = new Group();
    near.name = name;
    this.addMeshes(near, name, s, false);
    this.group.add(near);
    // Light pools stay at every distance (they show from far away at night).
    const pools = lightPoolMesh(s.pools);
    if (pools) {
      this.group.add(pools);
      this.stats.meshes++;
    }
    const bounds = new Sphere();
    const tmp = new Sphere();
    let first = true;
    for (const m of near.children as Mesh[]) {
      const bs = m.geometry.boundingSphere;
      if (!bs) continue;
      if (first) bounds.copy(bs);
      else bounds.union(tmp.copy(bs));
      first = false;
    }
    if (first) bounds.set(new Vector3(), 1);
    const site: Site = { near, far: null, bounds };
    this.sites.push(site);
    return site;
  }

  private addMeshes(into: Group, name: string, s: SiteBuilders, far: boolean): void {
    const add = (b: { isEmpty(): boolean; build(force?: boolean): BufferGeometry }, mat: Material, opts: { shadow: boolean; depth?: Material; suffix: string }) => {
      if (b.isEmpty()) return;
      const geo = b.build(true);
      const m = new Mesh(geo, mat);
      m.name = `${name}-${opts.suffix}`;
      m.castShadow = opts.shadow;
      m.receiveShadow = true;
      if (opts.depth) m.customDepthMaterial = opts.depth;
      m.matrixAutoUpdate = false;
      into.add(m);
      this.stats.meshes++;
      const tris = (geo.getIndex()?.count ?? 0) / 3;
      if (far) this.stats.farTriangles += tris;
      else this.stats.triangles += tris;
    };
    add(s.solid, dressMaterial({}), { shadow: true, suffix: 'solid' });
    add(s.glow, dressMaterial({ glow: true, glowDay: 0.3, glowNight: 3.2, rim: 0 }), { shadow: false, suffix: 'glow' });
    add(s.windows, dressMaterial({ glow: true, glowDay: 0, glowNight: 2.6, rim: 0.3, color: '#3b3a44' }), { shadow: false, suffix: 'windows' });
    add(s.cloth, dressMaterial({ sway: 'cloth', doubleSide: true, keepNormals: true }), { shadow: true, depth: swayDepthMaterial('cloth'), suffix: 'cloth' });
    add(s.chime, dressMaterial({ sway: 'chime' }), { shadow: false, suffix: 'chime' });
  }
}
