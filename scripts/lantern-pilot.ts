// Browser QA sidecar only; never included in the shipped game. This translates the existing
// feasibility pilot into standard gamepad samples, then lets Input.poll and Game simulate.
import { Autopilot } from '../src/race/autopilot';
import { coursePath } from '../src/race/flyCourse';
import { courseVia } from '../src/race/courses';
import { SHAPING } from '../src/input/shaping';

export function create(g: any) {
  const def = g.races.defs.find((d: any) => d.id === 'lantern-dash');
  const { path, ringNode } = coursePath(def, courseVia(def.id), { breed: g.player.breed, terrain: g.world.terrain });
  const pilot = new Autopilot(path);
  pilot.holdAt(path.nodeS[ringNode[0]]);
  return { pilot, ringS: path.nodeS[ringNode[0]], input: { pitch: 0, roll: 0, yaw: 0, flap: 0, tuck: 0, flare: 0 } };
}

function inverseExpo(v: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const x = (lo + hi) / 2;
    if ((1 - SHAPING.flightExpo) * x + SHAPING.flightExpo * x ** 3 < Math.abs(v)) lo = x; else hi = x;
  }
  return Math.sign(v) * (lo + hi) / 2;
}

export function setFlight(pad: any, input: any): void {
  const x = inverseExpo(input.roll), y = inverseExpo(input.pitch);
  const norm = Math.hypot(x, y), mag = Math.max(Math.abs(x), Math.abs(y));
  // stickOuter is an edge width: full raw travel = 1 - stickOuter.
  const travel = SHAPING.stickInner + mag * (1 - SHAPING.stickOuter - SHAPING.stickInner);
  pad.axes[0] = norm > 1e-6 ? x / norm * travel : 0;
  pad.axes[1] = norm > 1e-6 ? y / norm * travel : 0;
  const button = (i: number, value: number) => pad.buttons[i] = { pressed: value > 0.5, touched: value > 0, value };
  const trigger = (v: number) => v > 0 ? SHAPING.triggerInner + v * (1 - SHAPING.triggerOuter - SHAPING.triggerInner) : 0;
  button(6, trigger(input.flare)); button(7, trigger(input.flap));
  button(4, input.tuck > 0.5 || input.yaw < -0.5 ? 1 : 0);
  button(5, input.tuck > 0.5 || input.yaw > 0.5 ? 1 : 0);
}

export function steer(g: any, pad: any, runner: ReturnType<typeof create>): void {
  runner.pilot.steer(g.player.flight, g.player.model.derived, g.player.breed.maxRollRate, 1 / 120, runner.input);
  setFlight(pad, runner.input);
}
