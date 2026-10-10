import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { ColliderIndex } from '../../colliders';
import type { BoxCollider } from '../../../core/types';
import { Terrain } from '../../terrain';
import { LAYOUT } from '../../layout';
import { Dressing } from '../Dressing';
import { QUALITY } from '../../../render/quality';
import { FirstLead } from './FirstLead';
import { FIRST_LEAD_GREEK } from '../../../research/firstLeadText';
import { supportsGlyph } from './glyphs';
import { Player } from '../../../player/Player';
import { BREED_ORDER } from '../../../flight/breeds';
import { EventBus } from '../../../core/events';
import type { GameEvents } from '../../../core/types';
import { DEFAULT_SETTINGS } from '../../../game/settings';
import { emptyFrame } from '../../../input/Input';
import { deckCollider } from '../../colliders';

const terrain = new Terrain(LAYOUT);
const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.low, asyncStreaming: false });
const shrine = dressing.ventariSites.find((s) => s.id === 'gullrest-shrine')!;
const encounter = new FirstLead(shrine, terrain);
terrain.colliders.addSource('structures', () => dressing.colliders);
terrain.colliders.addSource('forest', () => dressing.forest.colliders);
const decks = dressing.decks.map(deckCollider);
terrain.colliders.addSource('decks', () => decks);
terrain.colliders.addSource('first-lead', () => encounter.colliders);
terrain.colliders.sync();

describe('first lead geometry', () => {
  it('covers every authored Greek character procedurally', () => {
    for (const line of FIRST_LEAD_GREEK) for (const char of line) expect(supportsGlyph(char), char).toBe(true);
  });
  it('switches both construction visuals and collision back to stage zero', () => {
    const index = new ColliderIndex();
    index.addSource('encounter', () => encounter.colliders);
    const before = encounter.colliders.length;
    encounter.setStage(1);
    index.sync();
    const rib = encounter.colliders.at(-1) as BoxCollider;
    const point = new Vector3(rib.x, rib.y, rib.z);
    expect(index.distance(point, 5)).toBeLessThan(0);
    expect(encounter.colliders.length).toBeGreaterThan(before);
    encounter.setStage(0);
    expect(encounter.colliders.length).toBe(before);
    index.sync();
    expect(index.distance(point, 5)).toBeGreaterThan(0);
  });
  for (const breed of BREED_ORDER) it(`${breed} can flare onto the clear Roost-facing approach`, () => {
    const events = new EventBus<GameEvents>();
    const player = new Player({ terrain, env: { terrain, windAt: (_p, out) => out.set(0, 0, 0) },
      events, breed, settings: () => DEFAULT_SETTINGS });
    // Ordinary low-speed final approach; this does not establish routefinding or human usability.
    const x = shrine.x + Math.sin(shrine.yaw) * 21;
    const z = shrine.z + Math.cos(shrine.yaw) * 21;
    const ground = terrain.groundAt(x, z, shrine.y + 50)!;
    player.teleport(new Vector3(x, ground.y + 7, z), shrine.yaw + Math.PI, 'flying', 17);
    let touchdowns = 0;
    events.on('touchdown', () => touchdowns++);
    const input = emptyFrame();
    input.flight.flare = 1;
    for (let i = 0; i < 720; i++) { player.latchPresses(input); player.fixedUpdate(1 / 120, input, 0); }
    expect(player.mode).toBe('landed');
    expect(touchdowns).toBe(1);
  });
});
