// The onboarding tips on screen (the logic is in tutor.ts). First-flight tips sit in a small
// card on the left, out of the way of the wyvern, the prompt and the readouts; stamina tips appear
// as a callout beside the stamina emblem they talk about. Glyphs follow the active device.

import { Vector3 } from 'three';
import type { GameView } from '../game/contracts';
import type { ControlAction } from '../input/scheme';
import { LAYOUT } from '../world/layout';
import { LiveClass, div, fromHtml, h } from './dom';
import { ICONS } from './icons';
import { TIPS, Tutor, type TipDef, type TutorFrame } from './tutor';

export interface TipsCtx {
  fillGlyphs(root: Element): void;
}

const CORE_COUNT = TIPS.filter((t) => t.core).length;
const tmp = new Vector3();

/** Inside a thermal column (a little beyond its core), between its base and top. */
function inThermal(p: Vector3): boolean {
  for (const t of LAYOUT.thermals) {
    if (p.y < t.baseY || p.y > t.topY + 40) continue;
    if (Math.hypot(p.x - t.x, p.z - t.z) < t.radius * 1.4) return true;
  }
  return false;
}

export class Tips {
  readonly root: HTMLElement;
  readonly tutor: Tutor;
  private card: HTMLElement;
  private cardKicker: HTMLElement;
  private cardTitle: HTMLElement;
  private cardBody: HTMLElement;
  private cardOn: LiveClass;
  private cardDone: LiveClass;
  private callout: HTMLElement;
  private calloutTitle: HTMLElement;
  private calloutBody: HTMLElement;
  private calloutOn: LiveClass;
  private shownTip: TipDef | null = null;
  /** A stamina tip is showing beside the emblem (the HUD hides its own stamina note). */
  gaugeOn = false;
  private view: GameView | null = null;
  private saveData: object | null = null;
  private tipCount = 0;
  private lastDone = false;
  private frame: TutorFrame = {
    dt: 0, enabled: false, mode: 'onFoot', flapping: false, pitch: 0, stamina: 1, winded: false, stall: 0,
    airspeed: 0, vy: 0, height: null, rested: 0, inThermal: false, racing: false, nearGate: false, prompt: null,
  };

  constructor(private ctx: TipsCtx) {
    this.tutor = new Tutor(() => this.view!.save.data);

    this.cardKicker = h('div', { class: 'dw-tip-kicker' });
    this.cardTitle = h('div', { class: 'dw-tip-title' });
    this.cardBody = h('div', { class: 'dw-tip-body' });
    this.card = div('dw-tip', div('dw-tip-check', fromHtml(ICONS.check)), this.cardKicker, this.cardTitle, this.cardBody);
    this.cardOn = new LiveClass(this.card, 'is-on');
    this.cardDone = new LiveClass(this.card, 'is-done');

    this.calloutTitle = h('div', { class: 'dw-tip-title' });
    this.calloutBody = h('div', { class: 'dw-tip-body' });
    this.callout = div('dw-tip dw-tip--gauge', this.calloutTitle, this.calloutBody);
    this.calloutOn = new LiveClass(this.callout, 'is-on');

    this.root = div('dw-layer dw-tips', this.card, this.callout);
  }

  /** Re-render glyphs after a device change. */
  refreshGlyphs(): void {
    this.ctx.fillGlyphs(this.root);
  }

  update(dt: number, view: GameView, hudVisible: boolean): void {
    this.view = view;
    const save = view.save.data;
    // A new game (progress erased) or "Replay tips": the session's lessons start over too.
    const count = save.tips?.length ?? 0;
    if (save !== this.saveData || count < this.tipCount || (this.lastDone && !save.tutorialDone)) {
      if (this.saveData) this.tutor.restartSession();
      this.saveData = save;
    }
    this.tipCount = count;
    this.lastDone = save.tutorialDone;

    const f = this.frame;
    const p = view.player;
    const fl = p.flight;
    const races = view.races;
    const input = view.input.frame;
    const racing = races.activeId !== null && (races.state === 'countdown' || races.state === 'running');
    f.dt = dt;
    f.enabled = hudVisible && view.screen === 'play' && save.settings.showControlHints;
    f.mode = p.mode;
    f.flapping = input.flight.flap > 0.2 || fl.flapStrength > 0.35;
    f.pitch = input.flight.pitch;
    f.stamina = fl.stamina;
    f.winded = fl.winded;
    f.stall = fl.stall;
    f.airspeed = fl.airspeed;
    f.vy = fl.velocity.y;
    const gy = p.wyvernPose.groundY;
    f.height = gy === null ? null : p.wyvernPose.position.y - gy;
    f.rested = p.rested ?? 0;
    f.inThermal = p.mode === 'flying' && inThermal(p.position);
    f.racing = racing;
    const wp = !racing && races.state === 'idle' ? races.waypoint(tmp) : null;
    f.nearGate = !!wp && wp.distanceTo(p.riderPosition) < 450;
    f.prompt = view.prompt?.action ?? null;

    this.tutor.update(f);
    if (this.tutor.dirty) {
      this.tutor.dirty = false;
      view.save.save();
    }
    this.render(f.enabled);
  }

  private render(enabled: boolean): void {
    const tip = this.tutor.current;
    if (tip !== this.shownTip && tip) this.fill(tip);
    this.shownTip = tip;
    const on = enabled && !!tip;
    this.cardOn.set(on && tip!.anchor === 'card');
    this.gaugeOn = on && tip!.anchor === 'gauge';
    this.calloutOn.set(this.gaugeOn);
    this.cardDone.set(on && this.tutor.doneLeft > 0);
  }

  private fill(tip: TipDef): void {
    const gauge = tip.anchor === 'gauge';
    if (!gauge) {
      const i = TIPS.filter((t) => t.core).indexOf(tip);
      this.cardKicker.textContent = tip.core ? `FIRST FLIGHT · ${i + 1} OF ${CORE_COUNT}` : 'TIP';
    }
    (gauge ? this.calloutTitle : this.cardTitle).textContent = tip.title;
    const body = gauge ? this.calloutBody : this.cardBody;
    body.replaceChildren(...bodyNodes(tip.body));
    this.ctx.fillGlyphs(body);
  }
}

/** "Hold {flap} to climb" → text and glyph spans the Ui fills for the active device. */
function bodyNodes(body: string): Node[] {
  const out: Node[] = [];
  for (const part of body.split(/(\{\w+\})/)) {
    if (!part) continue;
    const m = /^\{(\w+)\}$/.exec(part);
    if (m) out.push(h('span', { class: 'dw-hint-g dw-tip-g', attrs: { 'data-glyph': m[1] as ControlAction } }));
    else out.push(document.createTextNode(part));
  }
  return out;
}
