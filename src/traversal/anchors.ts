import type { Collider } from '../core/types';
/** Static collider identities and geometry are locked; optional general-solid mode registers on contact. */
export interface LanceAnchor { readonly id: string; readonly collider: Collider }
export class AnchorRegistry {
  private readonly byShape = new Map<Collider, string>();
  private readonly byId = new Map<string, { collider: Collider; snapshot: Readonly<Collider>; keys: readonly (keyof Collider)[] }>();
  constructor(readonly fixtures: readonly LanceAnchor[], readonly allSolids = false) {
    for (const a of fixtures) {
      if (!a.id || a.collider.soft || this.byShape.has(a.collider) || this.byId.has(a.id) || !validShape(a.collider))
        throw new Error('Invalid or duplicate Sky Lance anchor');
      this.byShape.set(a.collider, a.id);
      this.byId.set(a.id, { collider: a.collider, snapshot: Object.freeze({ ...a.collider }), keys: Object.keys(a.collider) as (keyof Collider)[] });
    }
  }
  resolve(id: string): Collider | null {
    const a = this.byId.get(id);
    if (!a || a.collider.kind !== a.snapshot.kind || a.collider.soft || !validShape(a.collider)) return null;
    for (const key of a.keys) {
      if (a.collider[key] !== a.snapshot[key]) return null;
    }
    return a.collider;
  }
  id(shape: Collider, stableId?: string): string | null {
    let id = this.byShape.get(shape);
    if (!id && this.allSolids && stableId && !this.byId.has(stableId) && !shape.soft && validShape(shape)) {
      id = stableId;
      this.byShape.set(shape,id);
      this.byId.set(id,{collider:shape,snapshot:Object.freeze({...shape}),keys:Object.keys(shape) as (keyof Collider)[]});
    }
    return id && this.resolve(id) === shape ? id : null;
  }
}
function validShape(c: Collider): boolean {
  for (const value of Object.values(c)) if (typeof value === 'number' && !Number.isFinite(value)) return false;
  if (c.kind === 'box') return c.hx > 0 && c.hy > 0 && c.hz > 0;
  return c.radius > 0 && (c.kind === 'sphere' || c.y1 > c.y0);
}
