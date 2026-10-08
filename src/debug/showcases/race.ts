import { Vector3 } from 'three';
import type { Showcase } from '../showcase';
import type { Game } from '../../game/Game';
import { COURSES, courseVia } from '../../race/courses';
import { BREEDS } from '../../flight/breeds';
import { flyCourse, thermalAir } from '../../race/flyCourse';
import { GhostRecorder } from '../../race/ghost';
import { gateRing } from '../../race/courseMath';

/**
 * ?view=race&race=<id>&spot=<gate|rings|beacon|ghost|fly>[&ring=n][&t=seconds] — race staging.
 *   gate   the course's start gate from its approach side
 *   rings  the course as if racing toward ring n (default 0), seen from behind the player line
 *   beacon a sprint's finish beacon from far off
 *   ghost  flies the course with the autopilot once to record a ghost, then stages the race at
 *          t seconds with the ghost alongside (camera beside the ghost)
 *   fly    as ghost, but also puts the player on the autopilot's line at t (camera chases)
 * Add &freeze=1 to hold the frame; &cam=x,y,z&look=x,y,z to override the camera.
 */
const showcase: Showcase = {
  name: 'race',
  description: 'Race gates, rings, beacons and ghosts: &race=<id>&spot=gate|rings|beacon|ghost',
  setup(game: Game, params: URLSearchParams) {
    const id = params.get('race') ?? 'roost-loop';
    const def = COURSES.find((c) => c.id === id) ?? COURSES[0];
    const spot = params.get('spot') ?? 'gate';
    const ringIdx = Number(params.get('ring') ?? 0);
    const t = Number(params.get('t') ?? 8);
    const g = gateRing(def);
    const gate = new Vector3(g.cx, g.cy, g.cz);
    const n = new Vector3(g.nx, 0, g.nz).normalize();
    const side = new Vector3(n.z, 0, -n.x);
    const cam = (p: Vector3, look: Vector3) => {
      if (!params.has('cam')) game.cameraRig.setOverride({ position: p, target: look });
    };
    // Park the player out of the way (behind the camera) unless flying the line.
    const park = () => game.player.teleport(gate.clone().addScaledVector(n, -400).setY(gate.y + 300), 0, 'flying', 0);

    if (spot === 'gate') {
      park();
      cam(gate.clone().addScaledVector(n, -95).addScaledVector(side, 38).setY(gate.y + 6), gate.clone().addScaledVector(n, 10).setY(gate.y - 2));
      game.races.debugStage(def.id, 0, 0, 'countdown');
      return;
    }
    if (spot === 'beacon') {
      park();
      const fin = new Vector3(...def.rings[def.rings.length - 1].position);
      const from = fin.clone().addScaledVector(n, -1100).setY(fin.y + 120);
      cam(from, fin.clone().setY(fin.y + 200));
      game.races.debugStage(def.id, def.rings.length - 1, 30000);
      return;
    }
    if (spot === 'rings') {
      park();
      const r = def.rings[Math.min(ringIdx, def.rings.length - 1)];
      const p = new Vector3(...r.position);
      const nn = new Vector3(...r.normal).normalize();
      const s2 = new Vector3(nn.z, 0, -nn.x).normalize();
      cam(p.clone().addScaledVector(nn, -70).addScaledVector(s2, 14).add(new Vector3(0, 9, 0)), p.clone().addScaledVector(nn, 40));
      game.races.debugStage(def.id, ringIdx, 10000);
      return;
    }
    // ghost / fly: record a ghost with the autopilot, then stage the race at time t.
    const rec = new GhostRecorder();
    const breed = BREEDS[game.save.data.wyvern.breed];
    const at = { pos: new Vector3(), vel: new Vector3(), yaw: 0, found: false, next: 0 };
    let steps = 0;
    const res = flyCourse(def, {
      breed,
      env: thermalAir(game.world.layout.thermals, game.world.terrain),
      via: courseVia(def.id),
      onRing: (i, kind) => {
        if (kind === 'pass' && !at.found) at.next = i + 1;
      },
      onStep: (m, raceTime) => {
        if (raceTime === null) return;
        if (steps++ % 4 === 0) {
          const s = m.state;
          rec.push(s.position, s.orientation, s.flapPhase, s.flapStrength, s.wingSpread, s.flare);
        }
        if (!at.found && raceTime >= t) {
          at.found = true;
          at.pos.copy(m.state.position);
          at.vel.copy(m.state.velocity);
        }
      },
    });
    const ghost = rec.finish({ raceId: def.id, breed: breed.id, look: game.save.data.wyvern, rider: game.save.data.rider, timeMs: res.timeMs, splits: res.splits });
    game.races.setGhost(ghost);
    (window as unknown as { __raceShowcase: unknown }).__raceShowcase = { finished: res.finished, timeMs: res.timeMs, splits: res.splits };
    const lag = Number(params.get('lag') ?? 1.2);
    if (spot === 'fly') {
      // The player a little behind the ghost on the same line.
      const v = at.vel.clone();
      game.player.teleport(at.pos.clone().addScaledVector(v, -lag), Math.atan2(v.x, v.z), 'flying', v.length());
      game.cameraRig.snap(game.player);
    } else {
      park();
      const v = at.vel.clone().normalize();
      const s2 = new Vector3(v.z, 0, -v.x).normalize();
      cam(at.pos.clone().addScaledVector(v, -22).addScaledVector(s2, 10).add(new Vector3(0, 4, 0)), at.pos.clone().addScaledVector(v, 6));
    }
    game.races.debugStage(def.id, at.next, t * 1000);
  },
};

export default showcase;
