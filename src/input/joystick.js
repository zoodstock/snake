/*
 * On-screen thumbstick. Drag the knob (touch or mouse) and read `vector`:
 * { x: -1..1 right, y: -1..1 up }. The knob follows the pointer, clamped to
 * the base radius, and springs back on release.
 */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Joystick {
  constructor(base, knob) {
    this.base = base;
    this.knob = knob;
    this.vector = { x: 0, y: 0 };
    this.active = false;
    this.pointerId = null;
    this.visible = false;
    if (base) this._bind();
  }

  get magnitude() { return Math.hypot(this.vector.x, this.vector.y); }

  setVisible(on) {
    this.visible = !!on;
    if (this.base) this.base.classList.toggle('visible', this.visible);
    document.body.classList.toggle('stick-on', this.visible);
    if (!this.visible) this._release();
  }

  _radius() {
    const rect = this.base.getBoundingClientRect();
    return Math.max(1, rect.width / 2);
  }

  _bind() {
    const base = this.base;

    const move = (e) => {
      if (!this.active || (this.pointerId !== null && e.pointerId !== this.pointerId)) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = this._radius();
      let dx = (e.clientX - cx) / radius;
      let dy = (e.clientY - cy) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.vector.x = clamp(dx, -1, 1);
      this.vector.y = clamp(-dy, -1, 1);          // screen y grows downward
      this._drawKnob();
      e.preventDefault();
    };

    base.addEventListener('pointerdown', (e) => {
      this.active = true;
      this.pointerId = e.pointerId;
      base.classList.add('grabbed');
      // Capture keeps tracking when the thumb slides off the pad. Synthetic
      // events in tests carry ids the browser will not capture, so guard it.
      try { base.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      move(e);
    });
    base.addEventListener('pointermove', move);
    window.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      base.addEventListener(type, () => this._release());
      window.addEventListener(type, () => this._release());
    }
    window.addEventListener('blur', () => this._release());
    // The pad sits over the canvas; never let it scroll or zoom the page.
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      base.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
  }

  _release() {
    if (!this.active && this.vector.x === 0 && this.vector.y === 0) return;
    this.active = false;
    this.pointerId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    if (this.base) this.base.classList.remove('grabbed');
    this._drawKnob();
  }

  _drawKnob() {
    if (!this.knob) return;
    const travel = this._radius() * 0.62;
    this.knob.style.transform =
      'translate(-50%, -50%) translate(' + (this.vector.x * travel).toFixed(1) + 'px, ' +
      (-this.vector.y * travel).toFixed(1) + 'px)';
  }
}

/** Touch-first devices get the pad by default. */
export function prefersTouch() {
  if (typeof window === 'undefined') return false;
  if (navigator.maxTouchPoints > 0) return true;
  return 'ontouchstart' in window && !window.matchMedia('(pointer: fine)').matches;
}
