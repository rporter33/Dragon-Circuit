// The in-flight HUD: deliberately sparse. A stamina arc around the wing emblem (only while it
// is being spent or refilling), airspeed and altitude, a compass ribbon with the race waypoint
// and nearby landmarks, the one context prompt, toasts, a discovery banner and a stall warning.
// Readouts fade back when nothing is happening. Per frame it only writes to the DOM when a
// displayed value changes, and it allocates nothing in steady state.

import { Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type { GameEvents, PlayerMode } from '../core/types';
import type { GameView, PromptAction } from '../game/contracts';
import { LAYOUT } from '../world/layout';
import { CARDINALS, headingFromYaw, headingOf, relativeBearing, ribbonPosition } from './compass';
import { LiveClass, LiveStyle, LiveText, div, fromHtml, h } from './dom';
import { formatDistance, kmh } from './format';
import { ICONS, RULE } from './icons';

const DEG = Math.PI / 180;
/** Half the angle the compass ribbon shows, each side of center. */
const HALF_SPAN = 60 * DEG;
/** Compass ribbon width in --u units (must match .dw-compass width in ui.css). */
const RIBBON_U = 36;
/** Seconds of calm before the readouts fade back. */
const IDLE_AFTER = 5;
/** Stamina arc: 300° of a circle, gap at the bottom. */
const ARC_R = 42;
const ARC_C = 2 * Math.PI * ARC_R;
const ARC_LEN = (ARC_C * 300) / 360;
/** Prompts that are flying tips (hidden when control hints are off). Interactions always show. */
const TIP_ACTIONS: ReadonlySet<PromptAction> = new Set(['flap', 'flare', 'tuck']);
const FLIGHT_MODES: ReadonlySet<PlayerMode> = new Set(['flying', 'falling']);

export interface HudCtx {
  events: GameEventBus;
  fillGlyphs(root: Element): void;
  reducedMotion(): boolean;
}

interface Marker {
  id: string;
  x: number;
  z: number;
  name: string;
  realName: string;
  lastDist: number;
  lastName: string;
  el: HTMLElement;
  label: LiveText;
  pos: LiveStyle;
  labelPos: LiveStyle;
  shown: LiveClass;
  near: LiveClass;
  unknown: LiveClass;
  lastX: number;
}

interface Toast {
  el: HTMLElement;
  age: number;
  life: number;
}

interface BannerItem {
  kicker: string;
  name: string;
  sub: string;
}

/** Pixel size of one --u at the current viewport (mirrors the clamp() in ui.css). */
export function unitPx(): number {
  const vh = typeof innerHeight === 'number' ? innerHeight : 720;
  return Math.min(40, Math.max(14, vh * 0.01667));
}

export class Hud {
  readonly root: HTMLElement;
  /** Toasts sit outside the HUD layer so they still show over menus. */
  readonly toastLayer: HTMLElement;
  private ctx: HudCtx;

  // Flight info.
  private flightInfo: HTMLElement;
  private readouts: LiveClass;
  private readoutsIdle: LiveClass;
  private speed: LiveText;
  private alt: LiveText;
  private vario: HTMLElement;
  private varioState = '';
  private gauge: HTMLElement;
  private gaugeFill: SVGCircleElement;
  private gaugeDash: LiveStyle;
  private gaugeFull: LiveClass;
  private gaugeLow: LiveClass;
  private gaugeWinded: LiveClass;
  private fullTime = 0;
  private lastArc = -1;
  private lastStrip = NaN;

  // Compass.
  private compass: HTMLElement;
  private compassIdle: LiveClass;
  private compassLabels: HTMLElement;
  private strip: HTMLElement;
  private stripPos: LiveStyle;
  private markers: Marker[] = [];
  private home: Marker;
  private waypoint: Marker;
  private waypointOn: LiveClass;
  private startGate: Marker;
  private wp = new Vector3();
  private ribbon = { x: 0, edge: false };

  // Prompt, stall, pointer hint.
  private prompt: HTMLElement;
  private promptOn: LiveClass;
  private promptWarn: LiveClass;
  private promptGlyph: HTMLElement;
  private promptText: LiveText;
  private promptAction: string | null = null;
  private stall: HTMLElement;
  private stallOn: LiveClass;
  private pointerHint: HTMLElement;
  private pointerOn: LiveClass;

  // Toasts and banners.
  private toasts: Toast[] = [];
  private banner: HTMLElement;
  private bannerKicker: HTMLElement;
  private bannerName: HTMLElement;
  private bannerSub: HTMLElement;
  private bannerQueue: BannerItem[] = [];
  /** Seconds the current banner has left; 0 = none showing. */
  private bannerLeft = 0;

  private idleTime = 0;
  private lastSpeed = 0;
  private visible = true;
  private unit = unitPx();

  constructor(ctx: HudCtx) {
    this.ctx = ctx;
    this.root = div('dw-layer dw-hud');

    // --- Compass ---------------------------------------------------------------------------
    this.strip = div('dw-compass-strip');
    for (let d = -180; d <= 540; d += 5) {
      const card = CARDINALS.find((c) => ((c.deg - d) % 360 + 360) % 360 === 0);
      if (card) {
        const lab = h('span', {
          class: `dw-compass-card${card.major ? '' : ' is-minor'}${card.label === 'N' ? ' is-north' : ''}`,
          text: card.label,
        });
        // Labels change font-size, so position them in --u rather than their own em.
        lab.style.left = `calc(var(--u) * ${((d / 120) * RIBBON_U).toFixed(3)})`;
        this.strip.append(lab);
      } else {
        const t = div(`dw-compass-tick${d % 15 === 0 ? ' is-mid' : ''}`);
        t.style.left = `calc(var(--u) * ${((d / 120) * RIBBON_U).toFixed(3)})`;
        this.strip.append(t);
      }
    }
    this.stripPos = new LiveStyle(this.strip, 'transform');
    const marks = div('dw-compass-marks');
    // Labels hang below the ribbon in their own layer: the ribbon's edge mask would swallow them.
    const labels = div('dw-compass-labels');
    const mk = (id: string, x: number, z: number, name: string, icon: string, cls: string): Marker => {
      const label = h('span', { class: `dw-mark-label ${cls}` });
      const el = div(`dw-mark ${cls}`, fromHtml(icon));
      marks.append(el);
      labels.append(label);
      return {
        id, x, z, name, el,
        realName: name,
        lastDist: -1,
        lastName: '',
        label: new LiveText(label),
        pos: new LiveStyle(el, 'transform'),
        labelPos: new LiveStyle(label, 'transform'),
        shown: new LiveClass(el, 'dw-hidden'),
        near: new LiveClass(label, 'is-on'),
        unknown: new LiveClass(el, 'is-unknown'),
        lastX: NaN,
      };
    };
    for (const l of LAYOUT.landmarks) {
      if (l.id === 'roost') continue;
      this.markers.push(mk(l.id, l.position[0], l.position[2], l.name, ICONS.landmark, ''));
    }
    const roost = LAYOUT.landmarks.find((l) => l.id === 'roost');
    this.home = mk('roost', roost?.position[0] ?? 0, roost?.position[2] ?? 0, roost?.name ?? 'The Roost', ICONS.home, 'is-home');
    this.waypoint = mk('waypoint', 0, 0, '', ICONS.waypoint, 'is-waypoint');
    this.waypointOn = new LiveClass(this.waypoint.el, 'dw-hidden');
    // Outside a race the waypoint is just the nearest start gate: a quieter ring marker.
    this.startGate = mk('start', 0, 0, 'Race start', ICONS.race, 'is-start');
    this.compass = div('dw-compass dw-fadeable', div('dw-compass-band'), this.strip, div('dw-compass-center'), marks);
    this.compassLabels = labels;
    this.compassIdle = new LiveClass(this.compass, 'is-idle');

    // --- Stamina gauge + readouts ------------------------------------------------------------
    const ring = fromHtml(
      `<svg class="dw-gauge-ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="dw-stamina-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#c88f3a"/><stop offset=".55" stop-color="#ffd27e"/><stop offset="1" stop-color="#fff2cf"/>
        </linearGradient></defs>
        <circle class="dw-gauge-track" cx="50" cy="50" r="${ARC_R}" transform="rotate(120 50 50)" stroke-dasharray="${ARC_LEN.toFixed(2)} ${ARC_C.toFixed(2)}"/>
        <circle class="dw-gauge-fill" cx="50" cy="50" r="${ARC_R}" transform="rotate(120 50 50)" stroke-dasharray="${ARC_LEN.toFixed(2)} ${ARC_C.toFixed(2)}"/>
      </svg>`,
    );
    this.gaugeFill = ring.querySelector('.dw-gauge-fill') as SVGCircleElement;
    this.gaugeDash = new LiveStyle(this.gaugeFill, 'stroke-dasharray');
    this.gauge = div('dw-gauge is-full', ring, div('dw-gauge-face', fromHtml(ICONS.wing)));
    this.gaugeFull = new LiveClass(this.gauge, 'is-full');
    this.gaugeLow = new LiveClass(this.gauge, 'is-low');
    this.gaugeWinded = new LiveClass(this.gauge, 'is-winded');

    const speedV = h('span', { class: 'dw-readout-v', text: '0' });
    const altV = h('span', { class: 'dw-readout-v', text: '0' });
    this.vario = fromHtml(ICONS.arrow);
    this.vario.classList.add('dw-vario', 'is-level');
    const readouts = div(
      'dw-readouts dw-fadeable',
      div('dw-readout dw-readout--speed', speedV, h('span', { class: 'dw-readout-u', text: 'km/h' })),
      div('dw-readout dw-readout--alt', this.vario, altV, h('span', { class: 'dw-readout-u', text: 'm' })),
    );
    this.speed = new LiveText(speedV);
    this.alt = new LiveText(altV);
    this.readouts = new LiveClass(readouts, 'is-gone');
    this.readoutsIdle = new LiveClass(readouts, 'is-idle');
    this.flightInfo = div('dw-flightinfo', readouts, this.gauge);

    // --- Prompt, stall, pointer hint ---------------------------------------------------------
    this.promptGlyph = h('span', { class: 'dw-hint-g' });
    const promptText = h('span', { class: 'dw-prompt-t' });
    this.prompt = div('dw-prompt', this.promptGlyph, promptText);
    this.promptText = new LiveText(promptText);
    this.promptOn = new LiveClass(this.prompt, 'is-on');
    this.promptWarn = new LiveClass(this.prompt, 'is-warn');

    this.stall = div('dw-stall', fromHtml(ICONS.stall), h('span', { text: 'STALL' }));
    this.stallOn = new LiveClass(this.stall, 'is-on');

    this.pointerHint = div(
      'dw-pointer-hint',
      h('span', { class: 'dw-hint-g', attrs: { 'data-glyph-key': 'Mouse0' } }),
      h('span', { text: 'Click to look around' }),
    );
    this.pointerOn = new LiveClass(this.pointerHint, 'is-on');

    // --- Banner -------------------------------------------------------------------------------
    this.bannerKicker = h('div', { class: 'dw-banner-kicker' });
    this.bannerName = h('div', { class: 'dw-banner-name' });
    this.bannerSub = h('div', { class: 'dw-banner-sub' });
    this.banner = div('dw-banner', this.bannerKicker, this.bannerName, fromHtml(RULE), this.bannerSub);

    this.root.append(this.compass, this.compassLabels, this.stall, this.banner, this.prompt, this.pointerHint, this.flightInfo);
    this.toastLayer = div('dw-toasts');

    this.subscribe(ctx.events);
    if (typeof window !== 'undefined') window.addEventListener('resize', () => (this.unit = unitPx()));
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('is-off', !on);
  }

  /** Queue a toast (also used by the Ui for its own notices). */
  toast(text: string, sub = '', icon: keyof typeof ICONS = 'info', variant = ''): void {
    const el = div(
      `dw-toast${variant ? ` dw-toast--${variant}` : ''}`,
      div('dw-toast-icon', fromHtml(ICONS[icon])),
      div('dw-toast-text', h('span', { class: 'dw-toast-t', text }), sub ? h('span', { class: 'dw-toast-s', text: sub }) : null),
    );
    this.toastLayer.append(el);
    this.toasts.push({ el, age: 0, life: 4.2 });
    // Keep the stack short: retire the oldest early.
    const live = this.toasts.filter((t) => t.age < t.life);
    if (live.length > 4) live[0].life = Math.min(live[0].life, live[0].age + 0.01);
  }

  /** A centered title card: "Discovered — Cascade Isle". */
  showBanner(kicker: string, name: string, sub = ''): void {
    this.bannerQueue.push({ kicker, name, sub });
  }

  private subscribe(ev: GameEventBus): void {
    ev.on('flapRefused', () => this.pulseGauge());
    ev.on('toast', (e: GameEvents['toast']) => this.toast(e.text, e.sub ?? '', e.icon ?? 'info'));
    ev.on('collect', (e: GameEvents['collect']) => {
      if (e.kind === 'feather') this.toast(`Feather ${e.total} of ${e.ofTotal}`, e.name, 'feather');
      else this.toast(`Relic found: ${e.name}`, `${e.total} of ${e.ofTotal} relics`, 'relic', 'relic');
    });
    ev.on('unlock', (e: GameEvents['unlock']) => this.toast(`Unlocked: ${e.name}`, 'New look in the Stable', 'unlock', 'unlock'));
    ev.on('discover', (e: GameEvents['discover']) => {
      const l = LAYOUT.landmarks.find((m) => m.id === e.landmarkId);
      this.showBanner('DISCOVERED', e.name, l?.description ?? '');
    });
  }

  private pulseGauge(): void {
    const g = this.gauge;
    g.classList.remove('is-pulse');
    void g.offsetWidth; // restart the animation
    g.classList.add('is-pulse');
    this.gaugeFull.set(false);
    this.fullTime = 0;
  }

  update(dt: number, view: GameView): void {
    this.updateToasts(dt);
    this.updateBanner(dt);
    if (!this.visible) return;

    const player = view.player;
    const f = player.flight;
    const mode = player.mode;
    const flying = FLIGHT_MODES.has(mode);
    const input = view.input.frame;

    // --- Activity → idle fade ----------------------------------------------------------------
    const fi = input.flight;
    const steering = Math.abs(fi.pitch) + Math.abs(fi.roll) + Math.abs(fi.yaw) > 0.3 || fi.flap > 0 || fi.tuck > 0 || fi.flare > 0;
    const accel = Math.abs(f.airspeed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = f.airspeed;
    const racing = view.races.activeId !== null && view.races.state !== 'idle';
    const busy = steering || accel > 4 || f.stall > 0.1 || racing || input.lookActive || (!flying && (input.foot.moveX !== 0 || input.foot.moveY !== 0));
    this.idleTime = busy ? 0 : this.idleTime + dt;
    const idle = this.idleTime > IDLE_AFTER;
    this.readoutsIdle.set(idle);
    this.compassIdle.set(idle && !racing);

    // --- Readouts --------------------------------------------------------------------------
    this.readouts.set(!flying);
    if (flying) {
      this.speed.set(kmh(f.airspeed));
      this.alt.set(Math.max(0, Math.round(f.position.y)));
      const vy = f.velocity.y;
      const v = vy > 2.5 ? 'is-up' : vy < -2.5 ? 'is-down' : 'is-level';
      if (v !== this.varioState) {
        if (this.varioState) this.vario.classList.remove(this.varioState);
        this.vario.classList.add(v);
        this.varioState = v;
      }
    }

    // --- Stamina -----------------------------------------------------------------------------
    const st = Math.max(0, Math.min(1, f.stamina));
    const full = st >= 0.995 && !f.winded;
    this.fullTime = full ? this.fullTime + dt : 0;
    this.gaugeFull.set(this.fullTime > 1.2);
    // Quantized, and the dash string is only rebuilt when the arc actually moves.
    const len = Math.round(ARC_LEN * st * 10) / 10;
    if (len !== this.lastArc) {
      this.lastArc = len;
      this.gaugeDash.set(`${len} ${ARC_C}`);
    }
    this.gaugeLow.set(st < 0.3 && !f.winded);
    this.gaugeWinded.set(f.winded);

    // --- Stall -------------------------------------------------------------------------------
    this.stallOn.set(flying && f.stall > 0.35);

    // --- Compass -------------------------------------------------------------------------------
    this.updateCompass(view);

    // --- Prompt ------------------------------------------------------------------------------
    const pr = view.prompt;
    const showHints = view.save.data.settings.showControlHints;
    const promptVisible = pr !== null && (showHints || !TIP_ACTIONS.has(pr.action));
    this.promptOn.set(promptVisible);
    if (pr && promptVisible) {
      if (pr.action !== this.promptAction) {
        this.promptAction = pr.action;
        this.promptGlyph.setAttribute('data-glyph', pr.action);
        this.ctx.fillGlyphs(this.prompt);
      }
      this.promptText.set(pr.text);
      // Recovery advice (stalling, winded) gets the warm warning edge.
      this.promptWarn.set(flying && (f.stall > 0.5 || f.winded) && (pr.action === 'tuck' || pr.action === 'flap'));
    }

    // --- Pointer lock hint -------------------------------------------------------------------
    const inp = view.input;
    this.pointerOn.set(!!inp.pointerLockWanted && !inp.pointerLocked && inp.device === 'keyboard');
  }

  /** Re-render glyphs after a device change. */
  refreshGlyphs(): void {
    this.promptAction = null;
  }

  private updateCompass(view: GameView): void {
    const heading = headingFromYaw(view.camera.yaw);
    const halfW = (this.unit * RIBBON_U) / 2;
    // Strip: the current heading sits at the ribbon's center.
    const sx = Math.round((halfW - (heading / DEG / 120) * RIBBON_U * this.unit) * 2) / 2;
    if (sx !== this.lastStrip) {
      this.lastStrip = sx;
      this.stripPos.set(`translate3d(${sx}px,0,0)`);
    }

    const p = view.player.position;
    const discovered = view.save.data.discovered;
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const known = discovered.includes(m.id);
      m.unknown.set(!known);
      m.name = known ? m.realName : 'Unexplored';
      this.placeMarker(m, p, heading, halfW, false);
    }
    this.placeMarker(this.home, p, heading, halfW, false);

    const wp = view.races.waypoint(this.wp);
    const racing = view.races.activeId !== null && view.races.state !== 'idle';
    this.waypointOn.set(!wp || !racing);
    this.startGate.shown.set(!wp || racing);
    if (!wp || !racing) this.waypoint.near.set(false);
    if (!wp || racing) this.startGate.near.set(false);
    if (wp) {
      const m = racing ? this.waypoint : this.startGate;
      m.x = wp.x;
      m.z = wp.z;
      this.placeMarker(m, p, heading, halfW, racing);
    }
  }

  private placeMarker(m: Marker, p: Vector3, heading: number, halfW: number, isWaypoint: boolean): void {
    const dx = m.x - p.x;
    const dz = m.z - p.z;
    const rel = relativeBearing(headingOf(dx, dz), heading);
    ribbonPosition(rel, HALF_SPAN, this.ribbon);
    // The waypoint pins to the edge when behind you, so it always says which way to turn.
    const visible = isWaypoint || !this.ribbon.edge;
    m.shown.set(!visible);
    if (!visible) {
      m.near.set(false);
      return;
    }
    const x = Math.round(this.ribbon.x * halfW * 0.92 * 2) / 2;
    if (x !== m.lastX) {
      m.lastX = x;
      m.pos.set(`translate3d(${x}px,0,0)`);
      // Keep the label inside the readable middle of the ribbon.
      const lx = Math.max(-halfW * 0.74, Math.min(halfW * 0.74, x));
      m.labelPos.set(`translate3d(${lx}px,0,0) translateX(-50%)`);
    }
    const near = isWaypoint || Math.abs(rel) < 9 * DEG;
    m.near.set(near);
    if (!near) return;
    // Distance labels: quantized first, so the string is only rebuilt when it would change.
    const d = isWaypoint ? Math.hypot(dx, dz, this.wp.y - p.y) : Math.hypot(dx, dz);
    const q = d < 995 ? Math.round(d / 5) : 1000 + Math.round(d / 100);
    if (q === m.lastDist && m.name === m.lastName) return;
    m.lastDist = q;
    m.lastName = m.name;
    m.label.set(isWaypoint ? formatDistance(d) : `${m.name} · ${formatDistance(d)}`);
  }

  private updateToasts(dt: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      const was = t.age;
      t.age += dt;
      if (was < t.life && t.age >= t.life) t.el.classList.add('is-out');
      if (t.age >= t.life + 0.6) {
        t.el.remove();
        this.toasts.splice(i, 1);
      }
    }
  }

  private updateBanner(dt: number): void {
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt;
      if (this.bannerLeft <= 0.9 && this.banner.classList.contains('is-on')) this.banner.classList.remove('is-on');
      if (this.bannerLeft > 0) return;
    }
    const next = this.bannerQueue.shift();
    if (!next) return;
    this.bannerKicker.textContent = next.kicker;
    this.bannerName.textContent = next.name;
    this.bannerSub.textContent = next.sub;
    this.bannerSub.style.display = next.sub ? '' : 'none';
    this.banner.classList.add('is-on');
    this.bannerLeft = 5;
  }
}
