import { BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, Vector3 } from 'three';
import type { Collider, VentariSiteAnchor } from '../../../core/types';
import { toonMaterial } from '../../../render/painterly';
import { FIRST_LEAD_GREEK } from '../../../research/firstLeadText';
import { GeoBuilder, xf } from '../geom';
import { colBox, colCyl } from '../colliderKit';
import { roostPlan } from '../structures/roostPlan';
import type { Terrain } from '../../terrain';
import { carvedText } from './glyphs';

/** Static first encounter and two bounded construction states; all solids share the collider index. */
export class FirstLead {
  readonly group = new Group();
  private colliderList: Collider[] = [];
  get colliders(): readonly Collider[] { return this.colliderList; }
  private ship = new Group();
  private shipColliders: Collider[][] = [[], []];
  private shrineColliderCount = 0;
  private stage = -1;

  constructor(readonly shrine: VentariSiteAnchor, terrain: Terrain) {
    this.group.name = 'first-lead';
    const b = new GeoBuilder();
    const unit = new BoxGeometry(1, 1, 1);
    const frame = xf(shrine.x, shrine.y, shrine.z, 0, shrine.yaw, 0);
    // Columns flank the inland end, keeping the approach from the Roost open.
    // Leave clearance beyond even the Galewing span; flared wingtips remain solid probes.
    const column = new CylinderGeometry(1, 1.2, 1, 12);
    let highestBase = shrine.y;
    for (const x of [-11, 11]) {
      const p = new Vector3(x, 0, -2).applyMatrix4(frame);
      const baseY = terrain.groundAt(p.x, p.z, shrine.y + 20)!.y;
      highestBase = Math.max(highestBase, baseY);
      const f = xf(p.x, baseY, p.z);
      b.add(column, new Matrix4().multiplyMatrices(f, xf(0, 9, 0, 0, 0, 0, 1, 18, 1)), { color: '#d3c4a3' });
      colCyl(this.colliderList, f, 0, 0, 0, 1.2, 18, { surface: 'stone' });
      for (const y of [.3, 18]) {
        b.add(unit, new Matrix4().multiplyMatrices(f, xf(0, y, 0, 0, 0, 0, 2.8, .6, 2.8)), { color: '#b3a184' });
        colBox(this.colliderList, f, 0, y, 0, 2.8, .6, 2.8, 0, { surface: 'stone' });
      }
    }
    // A single pale lintel reads above the rim and trees; it is solid like the columns.
    // Use the higher column base so the beam never intersects a capital on uneven ground.
    const lintelY = highestBase - shrine.y + 18.9;
    b.add(unit, new Matrix4().multiplyMatrices(frame, xf(0, lintelY, -2, 0, 0, 0, 25, 1.2, 2.5)), { color: '#d3c4a3' });
    colBox(this.colliderList, frame, 0, lintelY, -2, 25, 1.2, 2.5, 0, { surface: 'stone' });
    const p = shrine.inscription;
    const plaque = xf(p.x, p.y, p.z, 0, shrine.yaw, 0);
    b.add(unit, new Matrix4().multiplyMatrices(plaque, xf(0, 1.15, 0, 0, 0, 0, 5, 2.3, .6)), { color: '#b3a184' });
    colBox(this.colliderList, plaque, 0, 1.15, 0, 5, 2.3, .6, 0, { surface: 'stone' });
    carvedText(b, plaque, FIRST_LEAD_GREEK);
    this.group.add(this.mesh(b, 'shrine'));
    this.shrineColliderCount = this.colliders.length;
    column.dispose();

    const plan = roostPlan(terrain.layout, terrain);
    if (!plan) throw new Error('First Lead requires the Roost dock');
    const dk = plan.dock;
    const dock = xf(dk.x, dk.y, dk.z, 0, dk.yaw, 0);
    for (const stage of [0, 1]) {
      const ship = new GeoBuilder();
      const add = (x: number, y: number, z: number, w: number, h: number, d: number) => {
        ship.add(unit, new Matrix4().multiplyMatrices(dock, xf(x, y, z, 0, 0, 0, w, h, d)), { color: '#7a5a3e' });
        colBox(this.shipColliders[stage], dock, x, y, z, w, h, d, 0, { surface: 'wood' });
      };
      // Keel on low blocks, then upright ribs. Leave a walkway on both sides.
      for (const z of [5, 11, 17]) add(0, .35, z, 3, .7, .6);
      add(0, .9, 11, .6, .6, 15);
      if (stage === 1) for (const z of [5, 8, 11, 14, 17]) {
        add(0, 1.4, z, 4, .45, .4);
        for (const x of [-2, 2]) add(x, 2.6, z, .4, 2.8, .4);
      }
      this.ship.add(this.mesh(ship, `airship-stage-${stage}`));
    }
    unit.dispose();
    this.group.add(this.ship);
    this.setStage(0);
  }

  setStage(stage: 0 | 1): void {
    if (this.stage === stage) return;
    this.stage = stage;
    this.ship.children.forEach((mesh, i) => { mesh.visible = i === stage; });
    // Replacing the source array makes ColliderIndex discard old stage entries.
    this.colliderList = [...this.colliderList.slice(0, this.shrineColliderCount), ...this.shipColliders[stage]];
  }

  private mesh(b: GeoBuilder, name: string): Mesh {
    const mesh = new Mesh(b.build(), toonMaterial({ vertexColors: true }));
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
