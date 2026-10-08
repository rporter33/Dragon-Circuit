// Keyboard/mouse + gamepad → InputFrame. (Baseline implementation; the input module owner
// replaces internals but keeps the InputSystem contract.)

import type { InputDevice, InputFrame, InputPresses, Settings } from '../core/types';
import type { InputSystem } from '../game/contracts';
import { clamp, deadzone } from '../core/math';

function emptyPresses(): InputPresses {
  return {
    confirm: false, back: false, interact: false, pause: false, restart: false, jump: false,
    navUp: false, navDown: false, navLeft: false, navRight: false, tabPrev: false, tabNext: false,
    recenter: false, toggleHud: false,
  };
}

export function emptyFrame(): InputFrame {
  return {
    device: 'keyboard',
    flight: { pitch: 0, roll: 0, yaw: 0, flap: 0, tuck: 0, flare: 0 },
    foot: { moveX: 0, moveY: 0, sprint: false },
    lookX: 0,
    lookY: 0,
    lookIsRate: false,
    lookActive: false,
    jumpHeld: false,
    pressed: emptyPresses(),
  };
}

export class Input implements InputSystem {
  frame: InputFrame = emptyFrame();
  device: InputDevice = 'keyboard';
  padStyle: 'xbox' | 'playstation' | 'generic' | null = null;
  private keys = new Set<string>();
  private keysDown = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private scripted: Partial<InputFrame> | null = null;
  private prevButtons: boolean[] = [];
  private target: HTMLElement;
  private settings: () => Settings;

  constructor(target: HTMLElement, settings: () => Settings) {
    this.target = target;
    this.settings = settings;
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.keysDown.add(e.code);
      this.keys.add(e.code);
      this.device = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.target) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.device = 'keyboard';
      }
    });
  }

  setPointerLock(on: boolean): void {
    if (on && document.pointerLockElement !== this.target) {
      this.target.requestPointerLock?.()?.catch?.(() => {});
    } else if (!on && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  setScripted(frame: Partial<InputFrame> | null): void {
    this.scripted = frame;
  }

  rumble(strong: number, weak: number, durationMs: number): void {
    if (!this.settings().rumble) return;
    const pad = this.activePad();
    const act = (pad as unknown as { vibrationActuator?: { playEffect?: Function } })?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: durationMs, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) });
  }

  private activePad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  poll(_dt: number): InputFrame {
    const f = emptyFrame();
    const k = (c: string) => this.keys.has(c);
    const kd = (c: string) => this.keysDown.has(c);
    const s = this.settings();

    // Keyboard
    const kbPitch = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
    const kbRoll = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    f.flight.pitch = kbPitch * (s.invertPitch ? -1 : 1);
    f.flight.roll = kbRoll;
    f.flight.yaw = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
    f.flight.flap = k('Space') ? 1 : 0;
    f.flight.tuck = k('ShiftLeft') || k('ShiftRight') ? 1 : 0;
    f.flight.flare = k('ControlLeft') || k('KeyC') ? 1 : 0;
    f.foot.moveX = kbRoll;
    f.foot.moveY = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    f.foot.sprint = k('ShiftLeft');
    f.jumpHeld = k('Space');
    f.lookX = this.mouseDX * 0.0025 * s.lookSensitivity;
    f.lookY = this.mouseDY * 0.0025 * s.lookSensitivity;
    f.lookActive = this.mouseDX !== 0 || this.mouseDY !== 0;
    this.mouseDX = this.mouseDY = 0;
    const p = f.pressed;
    p.confirm = kd('Enter') || kd('Space');
    p.jump = kd('Space');
    p.back = kd('Escape') || kd('Backspace');
    p.pause = kd('Escape');
    p.interact = kd('KeyF');
    p.restart = kd('KeyR');
    p.navUp = kd('ArrowUp') || kd('KeyW');
    p.navDown = kd('ArrowDown') || kd('KeyS');
    p.navLeft = kd('ArrowLeft') || kd('KeyA');
    p.navRight = kd('ArrowRight') || kd('KeyD');
    p.tabPrev = kd('KeyQ');
    p.tabNext = kd('KeyE');
    p.recenter = kd('KeyV');
    p.toggleHud = kd('KeyH');
    this.keysDown.clear();

    // Gamepad (standard mapping)
    const pad = this.activePad();
    if (pad) {
      const ax = (i: number) => pad.axes[i] ?? 0;
      const bt = (i: number) => pad.buttons[i]?.value ?? 0;
      const pressed = (i: number) => (pad.buttons[i]?.pressed ?? false) && !this.prevButtons[i];
      const lx = deadzone(ax(0), 0.15);
      const ly = deadzone(ax(1), 0.15);
      const rx = deadzone(ax(2), 0.15);
      const ry = deadzone(ax(3), 0.15);
      const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) + pad.buttons.reduce((a, b) => a + b.value, 0) > 0.2;
      if (any) this.device = 'gamepad';
      if (this.device === 'gamepad') {
        f.flight.pitch = ly * (s.invertPitch ? -1 : 1);
        f.flight.roll = lx;
        f.flight.yaw = bt(5) - bt(4);
        f.flight.flap = bt(7);
        f.flight.flare = bt(6);
        f.flight.tuck = bt(0);
        f.foot.moveX = lx;
        f.foot.moveY = -ly;
        f.foot.sprint = bt(10) > 0.5 || bt(1) > 0.5;
        f.jumpHeld = bt(0) > 0.5;
        f.lookX = rx * s.lookSensitivity;
        f.lookY = ry * s.lookSensitivity;
        f.lookIsRate = true;
        f.lookActive = Math.abs(rx) + Math.abs(ry) > 0;
        p.confirm ||= pressed(0);
        p.jump ||= pressed(0);
        p.back ||= pressed(1);
        p.interact ||= pressed(3);
        p.pause ||= pressed(9);
        p.restart ||= pressed(8);
        p.navUp ||= pressed(12);
        p.navDown ||= pressed(13);
        p.navLeft ||= pressed(14);
        p.navRight ||= pressed(15);
        p.tabPrev ||= pressed(4);
        p.tabNext ||= pressed(5);
        p.recenter ||= pressed(11);
      }
      this.prevButtons = pad.buttons.map((b) => b.pressed);
      const id = pad.id.toLowerCase();
      this.padStyle = /054c|playstation|dualsense|dualshock/.test(id) ? 'playstation' : /xbox|xinput|045e/.test(id) ? 'xbox' : 'generic';
    }
    f.device = this.device;

    if (this.scripted) {
      const sc = this.scripted;
      Object.assign(f, { ...sc, flight: { ...f.flight, ...sc.flight }, foot: { ...f.foot, ...sc.foot }, pressed: { ...f.pressed, ...sc.pressed } });
    }
    this.frame = f;
    return f;
  }
}
