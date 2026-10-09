// The race layer of the HUD: "fly through the gate", the countdown, the timer with ring count,
// a split delta that flashes green (ahead of your best) or red (behind) at each ring, an arrow
// at the screen edge toward the next ring, and the alarm when a ring is missed.
//
// The centre of the screen shows one thing at a time: the RACE READY card while a race is armed,
// then the 3-2-1 (the card steps aside), then GO. Arming another race, standing down or aborting
// clears a stale count at once. Missing the start gate says so (and how to try again).

import { Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type { GameEvents } from '../core/types';
import type { GameView, RaceDef } from '../game/contracts';
import { LiveClass, LiveStyle, LiveText, div, fromHtml, h } from './dom';
import { formatDelta, formatTime, titleCase } from './format';
import { ICONS, RULE } from './icons';
import type { NoticeSpec } from './notices';

export interface RaceHudCtx {
  events: GameEventBus;
  reducedMotion(): boolean;
  /** Announce something through the HUD's notice queue. */
  notify(spec: NoticeSpec): void;
  /** The restart control's name on the active device ("R", "View"), for plain-text notices. */
  restartLabel?(): string;
}

const tmp = new Vector3();
/** Within this distance of the gate, standing down past its plane means the gate was missed (m). */
const MISSED_GATE_RANGE = 160;

/** Why a race ended early, as the notice says it (unknown reasons say nothing). */
const ABORT_LINES: Record<string, string> = {
  'left-course': 'You strayed too far from the course',
  respawn: 'You fell into the clouds',
  dismount: 'You dismounted',
  'breed-change': 'A record keeps the breed it was flown on',
};

export class RaceHud {
  readonly root: HTMLElement;
  private ctx: RaceHudCtx;

  private cluster: HTMLElement;
  private clusterOn: LiveClass;
  private rings: LiveText;
  private ringsTotal: LiveText;
  private time: LiveText;
  private best: LiveText;
  private delta: HTMLElement;
  private deltaLeft = 0;

  private gate: HTMLElement;
  private gateName: HTMLElement;
  private gateOn: LiveClass;
  /** A race stood down this frame (raceDisarmed): judged against the player's position in update. */
  private disarmedId: string | null = null;

  private count: HTMLElement;
  private countLeft = 0;
  /** Between the first count of a countdown and GO (or a stand-down). */
  private counting = false;

  private edge: HTMLElement;
  private edgeOn: LiveClass;
  private edgeMissed: LiveClass;
  private edgePos: LiveStyle;
  private missed: HTMLElement;
  private missedOn: LiveClass;
  private missedLeft = 0;

  /** The race the HUD is showing (from events; the race system may be idle again by now). */
  private raceId: string | null = null;
  private armed = false;
  /** The clock is running (raceStart seen): only then is an abort worth a notice. */
  private started = false;
  private finishedLeft = 0;
  private ringIndex = 0;
  private ringTotal = 0;
  private finalMs = 0;
  private shownTotal = -1;
  private shownCs = -1;
  private shownBest: number | null = -1;

  constructor(ctx: RaceHudCtx) {
    this.ctx = ctx;
    const ringsV = h('b', { text: '0' });
    const ringsT = h('span', { text: '/0' });
    const timeV = h('div', { class: 'dw-race-time', text: '0:00.00' });
    const bestV = h('span', { text: '—' });
    this.delta = div('dw-race-delta');
    this.cluster = div(
      'dw-race',
      div('dw-race-row', div('dw-race-rings', fromHtml(ICONS.race), ringsV, ringsT), timeV, div('dw-race-best', h('small', { text: 'BEST' }), bestV)),
      this.delta,
    );
    this.rings = new LiveText(ringsV);
    this.ringsTotal = new LiveText(ringsT);
    this.time = new LiveText(timeV);
    this.best = new LiveText(bestV);
    this.clusterOn = new LiveClass(this.cluster, 'is-on');

    this.gateName = h('div', { class: 'dw-banner-name' });
    this.gate = div(
      'dw-banner dw-gate',
      h('div', { class: 'dw-banner-kicker', text: 'RACE READY' }),
      this.gateName,
      fromHtml(RULE),
      h('div', { class: 'dw-banner-sub', text: 'Fly through the gate to start' }),
    );
    this.gateOn = new LiveClass(this.gate, 'is-on');

    this.count = div('dw-countdown');

    this.edge = div('dw-edge', div('dw-edge-arrow', fromHtml(ICONS.arrow)));
    this.edgeOn = new LiveClass(this.edge, 'is-on');
    this.edgeMissed = new LiveClass(this.edge, 'is-missed');
    this.edgePos = new LiveStyle(this.edge, 'transform');
    this.missed = div('dw-missed', fromHtml(ICONS.race), h('span', { text: 'MISSED A RING — TURN BACK' }));
    this.missedOn = new LiveClass(this.missed, 'is-on');

    this.root = div('dw-layer dw-racehud', this.cluster, this.gate, this.count, this.missed, this.edge);
    this.subscribe(ctx.events);
  }

  private subscribe(ev: GameEventBus): void {
    ev.on('raceArmed', (e: GameEvents['raceArmed']) => {
      this.raceId = e.raceId;
      this.armed = true;
      this.started = false;
      this.finishedLeft = 0;
      this.ringIndex = 0;
      this.ringTotal = 0;
      this.disarmedId = null;
      this.clearCount();
    });
    ev.on('raceDisarmed', (e: GameEvents['raceDisarmed']) => {
      if (this.raceId !== e.raceId) return;
      this.armed = false;
      this.clearCount();
      // Races that say why they stood down are believed ('missed-gate' is the one worth a word);
      // otherwise the HUD judges from where the player is (see update).
      const reason = (e as { reason?: string }).reason;
      if (reason === undefined) this.disarmedId = e.raceId;
      else if (reason === 'missed-gate') this.missedGate(e.raceId, true);
    });
    ev.on('raceCountdown', (e: GameEvents['raceCountdown']) => {
      this.raceId = e.raceId;
      this.counting = true;
      this.showCount(String(e.count), false);
    });
    ev.on('raceStart', (e: GameEvents['raceStart']) => {
      this.raceId = e.raceId;
      this.armed = false;
      this.started = true;
      this.counting = false;
      this.finishedLeft = 0;
      this.ringIndex = 0;
      this.showCount('Go!', true);
    });
    ev.on('ringPassed', (e: GameEvents['ringPassed']) => {
      this.ringIndex = e.index + 1;
      this.ringTotal = e.total;
      this.missedLeft = 0;
      if (e.deltaMs !== null) this.flashDelta(e.deltaMs);
    });
    ev.on('ringMissed', () => {
      this.missedLeft = 4;
    });
    ev.on('raceFinish', (e: GameEvents['raceFinish']) => {
      this.finalMs = e.timeMs;
      this.started = false;
      this.finishedLeft = 2;
      this.missedLeft = 0;
      this.showCount('Finish', true);
    });
    ev.on('raceAbort', (e: GameEvents['raceAbort']) => {
      const wasRunning = this.started;
      this.started = false;
      this.armed = false;
      this.finishedLeft = 0;
      this.missedLeft = 0;
      this.clearCount();
      if (e.reason !== 'restart') this.raceId = null;
      const reason: string = e.reason;
      if (reason === 'missed-gate') {
        this.missedGate(e.raceId);
        return;
      }
      const line = ABORT_LINES[reason];
      if (wasRunning && line) this.ctx.notify({ key: `race-abort:${e.raceId}`, text: 'Race abandoned', sub: line, icon: 'race', priority: 2 });
    });
  }

  /** Hide the 3-2-1 / GO at once (another race armed, stood down or aborted). */
  private clearCount(): void {
    this.counting = false;
    this.countLeft = 0;
    this.count.classList.remove('is-tick', 'is-go');
    this.count.style.opacity = '';
  }

  /** `retry`: the race system offers a restart from the gate (the restart button). */
  private missedGate(raceId: string, retry = false): void {
    const key = this.ctx.restartLabel?.();
    const sub = retry && key ? `Turn back and fly through it, or press ${key} to try again` : 'Turn back and fly through it to start';
    this.ctx.notify({ key: `missed-gate:${raceId}`, text: 'Missed the start gate', sub, icon: 'race', priority: 2, life: 5 });
  }

  private showCount(text: string, go: boolean): void {
    const c = this.count;
    c.textContent = text;
    c.classList.remove('is-tick', 'is-go');
    void c.offsetWidth; // restart the animation
    c.classList.add(go ? 'is-go' : 'is-tick');
    c.style.opacity = this.ctx.reducedMotion() ? '1' : '';
    this.countLeft = go ? 1.1 : 0.95;
  }

  private flashDelta(ms: number): void {
    const d = this.delta;
    d.textContent = formatDelta(ms);
    d.classList.remove('is-flash', 'is-ahead', 'is-behind');
    void d.offsetWidth;
    d.classList.add('is-flash', ms <= 0 ? 'is-ahead' : 'is-behind');
    d.style.opacity = this.ctx.reducedMotion() ? '1' : '';
    this.deltaLeft = 2.4;
  }

  update(dt: number, view: GameView, hudVisible: boolean): void {
    const races = view.races;
    const def: RaceDef | undefined = this.raceId ? races.defs.find((d) => d.id === this.raceId) : undefined;

    // Timers for the one-shot pieces (CSS animates them; with reduced motion we hide them here).
    if (this.countLeft > 0) {
      this.countLeft -= dt;
      if (this.countLeft <= 0) {
        this.count.classList.remove('is-tick', 'is-go');
        this.count.style.opacity = '';
      }
    }
    if (this.deltaLeft > 0) {
      this.deltaLeft -= dt;
      if (this.deltaLeft <= 0) {
        this.delta.classList.remove('is-flash');
        this.delta.style.opacity = '';
      }
    }
    if (this.finishedLeft > 0) this.finishedLeft -= dt;
    if (this.missedLeft > 0) this.missedLeft -= dt;

    const running = races.activeId !== null && (races.state === 'countdown' || races.state === 'running');
    const showCluster = hudVisible && (running || this.finishedLeft > 0);
    this.clusterOn.set(showCluster);
    if (showCluster) {
      const total = def ? def.rings.length : this.ringTotal;
      const passed = running ? Math.min(races.nextRingIndex, total) : total;
      this.rings.set(Math.max(passed, running ? 0 : this.ringIndex));
      if (total !== this.shownTotal) {
        this.shownTotal = total;
        this.ringsTotal.set(`/${total}`);
      }
      // The clock shows hundredths, so it changes every frame; only rebuild when it does.
      const ms = Math.floor((running ? races.elapsedMs : this.finalMs) / 10);
      if (ms !== this.shownCs) {
        this.shownCs = ms;
        this.time.set(formatTime(ms * 10));
      }
      if (races.bestMs !== this.shownBest) {
        this.shownBest = races.bestMs;
        this.best.set(races.bestMs !== null ? formatTime(races.bestMs) : '—');
      }
    }

    // Stood down: past the gate's plane and close to it means it was missed (rather than left).
    if (this.disarmedId) {
      const d = races.defs.find((r) => r.id === this.disarmedId);
      this.disarmedId = null;
      if (d && passedGate(d, view.player.position)) this.missedGate(d.id);
      if (this.raceId === d?.id && races.state === 'idle') this.raceId = null;
    }
    // A race system that stands down silently (no raceDisarmed) goes idle: same judgement.
    if (this.armed && races.state === 'idle' && this.raceId) {
      this.armed = false;
      this.clearCount();
      const d = races.defs.find((r) => r.id === this.raceId);
      if (d && passedGate(d, view.player.position)) this.missedGate(d.id);
      this.raceId = null;
    }
    // Once the 3-2-1 starts, the card steps aside: one thing in the middle of the screen.
    this.gateOn.set(hudVisible && this.armed && races.state === 'countdown' && !this.counting);
    if (this.armed) this.gateName.textContent = def?.name ?? titleCase(this.raceId ?? '');

    this.missedOn.set(hudVisible && running && this.missedLeft > 0);
    this.updateEdge(view, hudVisible && running);
  }

  /** Arrow on an ellipse near the screen edge, pointing at the next ring when it is off-screen. */
  private updateEdge(view: GameView, active: boolean): void {
    const wp = active ? view.races.waypoint(tmp) : null;
    if (!wp) {
      this.edgeOn.set(false);
      return;
    }
    const cam = view.camera.camera;
    wp.project(cam);
    let x = wp.x;
    let y = wp.y;
    const behind = wp.z > 1;
    if (behind) {
      x = -x;
      y = -y;
    }
    const onScreen = !behind && Math.abs(x) < 0.82 && Math.abs(y) < 0.78;
    const missed = this.missedLeft > 0;
    this.edgeOn.set(!onScreen || missed);
    this.edgeMissed.set(missed);
    if (onScreen && !missed) return;
    const W = typeof innerWidth === 'number' ? innerWidth : 1280;
    const H = typeof innerHeight === 'number' ? innerHeight : 720;
    // Angle in screen pixels (so the ellipse is not squashed by the aspect ratio).
    const a = Math.atan2(y * H, x * W);
    const rx = W * 0.4;
    const ry = H * 0.36;
    const px = Math.round(Math.cos(a) * rx);
    const py = Math.round(-Math.sin(a) * ry);
    const rot = Math.round(90 - (a * 180) / Math.PI);
    this.edgePos.set(`translate(${px}px,${py}px) rotate(${rot}deg)`);
  }
}

/** True when `p` is past the start gate's plane, near enough that it flew by the gate. */
export function passedGate(def: Pick<RaceDef, 'start'>, p: { x: number; y: number; z: number }): boolean {
  const [gx, gy, gz] = def.start.position;
  const nx = Math.sin(def.start.yaw);
  const nz = Math.cos(def.start.yaw);
  const side = (p.x - gx) * nx + (p.z - gz) * nz;
  return side > 0 && Math.hypot(p.x - gx, p.y - gy, p.z - gz) < MISSED_GATE_RANGE;
}
