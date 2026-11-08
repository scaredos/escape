// Keyboard + mouse state (spec 04 §1). Key-down events queue actions; held keys are polled each frame.
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'Quote', 'Slash', 'KeyF', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Tab', 'KeyE', 'KeyR', 'KeyC']);

export class Input {
  held = new Set<string>();
  pressed: string[] = [];        // key-down events since last poll
  mouseDx = 0; mouseDy = 0; wheel = 0;
  lmb = false; rmb = false; lmbPressed = false;
  enabled = true;
  /** synthetic holds from EscKey / EscDrive */
  synth = new Map<string, number>();
  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code) && document.activeElement?.tagName !== 'INPUT') e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.held.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => { this.held.clear(); this.lmb = this.rmb = false; });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === this.el) { this.mouseDx += e.movementX; this.mouseDy += e.movementY; } });
    el.addEventListener('mousedown', (e) => { if (e.button === 0) { this.lmb = true; this.lmbPressed = true; } if (e.button === 2) this.rmb = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }
  isDown(code: string) { return this.held.has(code) || (this.synth.get(code) ?? 0) > performance.now(); }
  /** EscKey: synthesise a press through the real path, held for `sec`. */
  key(code: string, sec = 0.15) { if (code === 'Mouse0') this.lmbPressed = true; this.pressed.push(code); this.synth.set(code, performance.now() + sec * 1000); }
  take(): string[] { const p = this.pressed; this.pressed = []; return p; }
  takeMouse() { const r = [this.mouseDx, this.mouseDy]; this.mouseDx = this.mouseDy = 0; return r; }
}
export const KEY_NAMES: Record<string, string> = { LMB: 'Mouse0', RMB: 'Mouse2', E: 'KeyE', F: 'KeyF', M: 'KeyM', W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', LEFTSHIFT: 'ShiftLeft', UP: 'ArrowUp', DOWN: 'ArrowDown', SPACEBAR: 'Space', R: 'KeyR', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3' };
