/*
 * Input: keyboard steering, drag-to-steer with the mouse, touch halves for
 * phones, wheel zoom. Exposes a steady {steer, boost} read each frame plus
 * one-shot actions (start / restart / pause / mute).
 */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
  const RIGHT_KEYS = ['ArrowRight', 'KeyD'];
  const BOOST_KEYS = ['ShiftLeft', 'ShiftRight', 'Space', 'KeyW', 'ArrowUp'];

  class Input {
    constructor(target, handlers) {
      this.keys = Object.create(null);
      this.pointerSteer = 0;
      this.pointerActive = false;
      this.touchBoost = false;
      this.touchSteer = 0;
      this.handlers = handlers || {};
      this.enabled = true;
      this._bind(target);
    }

    get steer() {
      let steer = 0;
      for (const k of LEFT_KEYS) if (this.keys[k]) steer -= 1;
      for (const k of RIGHT_KEYS) if (this.keys[k]) steer += 1;
      if (steer === 0 && this.pointerActive) steer = this.pointerSteer;
      if (steer === 0) steer = this.touchSteer;
      return clamp(steer, -1, 1);
    }

    get boost() {
      for (const k of BOOST_KEYS) if (this.keys[k]) return true;
      return this.touchBoost;
    }

    _fire(name, arg) {
      const fn = this.handlers[name];
      if (fn) fn(arg);
    }

    _bind(target) {
      const canvas = target;

      window.addEventListener('keydown', (e) => {
        if (e.repeat) {
          if (LEFT_KEYS.includes(e.code) || RIGHT_KEYS.includes(e.code) || BOOST_KEYS.includes(e.code)) {
            e.preventDefault();
          }
          return;
        }
        this.keys[e.code] = true;
        switch (e.code) {
          case 'Enter': case 'KeyR': this._fire('confirm'); break;
          case 'KeyP': case 'Escape': this._fire('pause'); break;
          case 'KeyM': this._fire('mute'); break;
          case 'KeyC': this._fire('cycleView'); break;
          default: break;
        }
        if (LEFT_KEYS.includes(e.code) || RIGHT_KEYS.includes(e.code) || BOOST_KEYS.includes(e.code)) {
          e.preventDefault();
          this._fire('anyInput');
        }
      });

      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = Object.create(null); this.pointerActive = false; });

      // Drag anywhere on the canvas to steer; horizontal offset is the amount.
      const updatePointer = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / Math.max(1, rect.width);
        this.pointerSteer = clamp((x - 0.5) * 2.8, -1, 1);
      };
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;   // touch uses the halves below
        this.pointerActive = true;
        updatePointer(e);
        this._fire('anyInput');
      });
      window.addEventListener('pointermove', (e) => {
        if (this.pointerActive) updatePointer(e);
      });
      window.addEventListener('pointerup', () => { this.pointerActive = false; });

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._fire('zoom', Math.sign(e.deltaY) * 1.2);
      }, { passive: false });

      // Touch: left half steers left, right half steers right, two fingers boost.
      const readTouches = (e) => {
        const rect = canvas.getBoundingClientRect();
        let steer = 0;
        for (const t of e.touches) {
          const x = (t.clientX - rect.left) / Math.max(1, rect.width);
          steer += x < 0.5 ? -1 : 1;
        }
        this.touchSteer = clamp(steer, -1, 1);
        this.touchBoost = e.touches.length >= 2;
        if (e.touches.length > 0) this._fire('anyInput');
      };
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        canvas.addEventListener(type, (e) => {
          e.preventDefault();
          readTouches(e);
        }, { passive: false });
      }
    }
  }

  root.SnakeInput = { Input };
})(typeof globalThis !== 'undefined' ? globalThis : this);
