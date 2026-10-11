import { Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type { GameView } from '../game/contracts';
import { LAYOUT } from '../world/layout';
import { LanternCoach, LANTERN_LIFT_ID } from '../race/lanternCoach';
import { LiveStyle, LiveText, div, h } from './dom';

/** Optional annotation of existing warm thermal strokes; never replaces the finish arrow. */
export class LanternCoachHud {
  readonly line: HTMLElement;
  readonly marker: HTMLElement;
  private coach = new LanternCoach();
  private thermal = LAYOUT.thermals.find(t => t.id === LANTERN_LIFT_ID)!;
  private title: LiveText;
  private body: LiveText;
  private label: LiveText;
  private markerPos: LiveStyle;
  private point = new Vector3();
  private wind = new Vector3();
  private missed = false;

  constructor(events: GameEventBus) {
    const title = h('b'); const body = h('span');
    this.line = div('dw-lantern-coach', title, body);
    this.line.hidden = true;
    this.title = new LiveText(title); this.body = new LiveText(body);
    const label = h('span');
    this.marker = div('dw-lantern-lift', h('b', { text: '↑' }), label);
    this.marker.hidden = true;
    this.label = new LiveText(label);
    this.markerPos = new LiveStyle(this.marker, 'transform');
    const reset = () => { this.coach.reset(); this.missed = false; };
    events.on('raceArmed', reset);
    events.on('raceAbort', reset);
    events.on('raceStart', reset);
    events.on('ringMissed', e => { if (e.raceId === 'lantern-dash') this.missed = true; });
  }

  update(view: GameView, hudVisible: boolean): void {
    const r = view.races;
    const active = r.activeId === 'lantern-dash' && r.state === 'running' && view.player.mode === 'flying';
    if (!active) this.coach.reset();
    const show = active && hudVisible && view.screen === 'play' && view.save.data.settings.showControlHints;
    this.line.hidden = !show;
    this.marker.hidden = true;
    if (!show) return;
    const f = view.player.flight;
    const finishY = r.defs.find(d => d.id === r.activeId)!.rings[0].position[1];
    view.weather.windAt(f.position, this.wind);
    const advice = this.coach.update({ x: f.position.x, y: f.position.y, z: f.position.z, lift: this.wind.y, vy: f.velocity.y, stall: f.stall, missedFinish: this.missed, finishY }, this.thermal);
    this.line.dataset.phase = advice.phase;
    this.title.set(advice.title); this.body.set(advice.body);
    if (!advice.suggestLift) return;
    const distance = Math.hypot(f.position.x - this.thermal.x, f.position.z - this.thermal.z);
    // Label the actual air column at the player's height, rather than a fictitious gate or
    // waypoint floating above it. Nearby the strokes/motes and lift gauge take over.
    if (distance < this.thermal.radius * 1.2) return;
    this.point.set(this.thermal.x, Math.max(80, Math.min(f.position.y, this.thermal.topY - 160)), this.thermal.z).project(view.camera.camera);
    if (this.point.z > 1 || this.point.z < -1 || Math.abs(this.point.x) > 0.82 || Math.abs(this.point.y) > 0.55) return;
    const x = Math.round((this.point.x + 1) * innerWidth / 2);
    const y = Math.round((1 - this.point.y) * innerHeight / 2);
    // At short viewport heights the world label can project into the timer/coaching strip.
    // Let the written direction carry that moment rather than overlaying either readout.
    if (y < this.line.getBoundingClientRect().bottom + 18) return;
    this.marker.hidden = false;
    this.label.set(`Suggested lift · ${Math.round(distance / 10) * 10} m`);
    this.markerPos.set(`translate(${x}px,${y}px) translate(-50%,-50%)`);
  }
}
