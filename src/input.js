/*
 * Input: keyboard steering, drag-to-steer with the mouse, an on-screen
 * thumbstick, and hardware gamepads. Exposes a steady read each frame —
 * `steer` (-1..1 turn), `stick` (a direction to aim at, or null) and `boost` —
 * plus one-shot actions (start / restart / pause / mute).
 */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const Joystick = root.SnakeJoystick ? root.SnakeJoystick.Joystick : null;
  const prefersTouch = root.SnakeJoystick ? root.SnakeJoystick.prefersTouch : () => false;

  const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
  const RIGHT_KEYS = ['ArrowRight', 'KeyD'];
  const BOOST_KEYS = ['ShiftLeft', 'ShiftRight', 'Space', 'KeyW', 'ArrowUp'];

  // Standard gamepad mapping.
  const PAD = {
    leftX: 0,
    leftY: 1,
    boostButtons: [0, 1, 5, 7],      // A / B / RB / RT
    pauseButtons: [9],               // Start
    dpadLeft: 14,
    dpadRight: 15,
    axisDead: 0.18,
  };

  class Input {
    constructor(target, handlers, elements) {
      this.keys = Object.create(null);
      this.pointerSteer = 0;
      this.pointerActive = false;
      this.buttonBoost = false;      // on-screen boost button
      this.handlers = handlers || {};
      this.pad = { x: 0, y: 0, active: false, boost: false };
      this.padConnected = false;
      this._padPause = false;
      const els = elements || {};
      this.joystick = Joystick ? new Joystick(els.stickBase, els.stickKnob) : null;
      if (this.joystick) this.joystick.setVisible(prefersTouch());
      this._bind(target, els);
    }

    /** Sample the gamepad once per frame. */
    update() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let live = null;
      for (const pad of pads) {
        if (pad && pad.connected) { live = pad; break; }
      }
      this.padConnected = !!live;
      if (!live) {
        this.pad.active = false;
        this.pad.boost = false;
        return;
      }
      const axes = live.axes || [];
      const buttons = live.buttons || [];
      const pressed = (i) => !!(buttons[i] && (buttons[i].pressed || buttons[i].value > 0.5));

      let x = axes[PAD.leftX] || 0;
      let y = -(axes[PAD.leftY] || 0);              // sticks report up as negative
      if (pressed(PAD.dpadLeft)) x = -1;
      if (pressed(PAD.dpadRight)) x = 1;
      if (Math.abs(x) < PAD.axisDead) x = 0;
      if (Math.abs(y) < PAD.axisDead) y = 0;
      this.pad.x = x;
      this.pad.y = y;
      this.pad.active = x !== 0 || y !== 0;
      this.pad.boost = PAD.boostButtons.some(pressed);

      const wantsPause = PAD.pauseButtons.some(pressed);
      if (wantsPause && !this._padPause) this._fire('pause');
      this._padPause = wantsPause;
      if (this.pad.active || this.pad.boost) this._fire('anyInput');
    }

    /** Direction to aim at as {x, y} in stick space, or null if nothing is pushed. */
    get stick() {
      if (this.joystick && this.joystick.magnitude > 0) {
        return { x: this.joystick.vector.x, y: this.joystick.vector.y };
      }
      // A gamepad pushed sideways only still reads as a direction, so hold the
      // forward component at zero and let the heading maths sort it out.
      if (this.pad.active) return { x: this.pad.x, y: this.pad.y };
      return null;
    }

    /** Turn rate from the sources that steer directly rather than by direction. */
    get steer() {
      let steer = 0;
      for (const k of LEFT_KEYS) if (this.keys[k]) steer -= 1;
      for (const k of RIGHT_KEYS) if (this.keys[k]) steer += 1;
      if (steer === 0 && this.pointerActive) steer = this.pointerSteer;
      return clamp(steer, -1, 1);
    }

    get boost() {
      for (const k of BOOST_KEYS) if (this.keys[k]) return true;
      return this.buttonBoost || this.pad.boost;
    }

    /** True when the on-screen pad is showing (the canvas then stops steering). */
    get stickVisible() { return !!(this.joystick && this.joystick.visible); }

    toggleStick() {
      if (!this.joystick) return false;
      this.joystick.setVisible(!this.joystick.visible);
      return this.joystick.visible;
    }

    _fire(name, arg) {
      const fn = this.handlers[name];
      if (fn) fn(arg);
    }

    _bind(target, els) {
      const canvas = target;

      window.addEventListener('keydown', (e) => {
        const steering = LEFT_KEYS.includes(e.code) || RIGHT_KEYS.includes(e.code) ||
          BOOST_KEYS.includes(e.code);
        if (e.repeat) {
          if (steering) e.preventDefault();
          return;
        }
        this.keys[e.code] = true;
        switch (e.code) {
          case 'Enter': case 'KeyR': this._fire('confirm'); break;
          case 'KeyP': case 'Escape': this._fire('pause'); break;
          case 'KeyM': this._fire('mute'); break;
          case 'KeyJ': this._fire('stick'); break;
          default: break;
        }
        if (steering) {
          e.preventDefault();
          this._fire('anyInput');
        }
      });

      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = Object.create(null); this.pointerActive = false; });

      window.addEventListener('gamepadconnected', () => { this.padConnected = true; this._fire('padConnected'); });
      window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; });

      // Drag anywhere on the canvas to steer — but not when the pad is showing,
      // or a thumb resting on the canvas would fight the stick.
      const updatePointer = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / Math.max(1, rect.width);
        this.pointerSteer = clamp((x - 0.5) * 2.8, -1, 1);
      };
      canvas.addEventListener('pointerdown', (e) => {
        if (this.stickVisible) return;
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

      canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this._fire('anyInput');
      }, { passive: false });

      const boostBtn = els.boostButton;
      if (boostBtn) {
        const set = (on) => (e) => {
          e.preventDefault();
          this.buttonBoost = on;
          if (on) this._fire('anyInput');
        };
        boostBtn.addEventListener('pointerdown', set(true));
        boostBtn.addEventListener('pointerup', set(false));
        boostBtn.addEventListener('pointercancel', set(false));
        boostBtn.addEventListener('pointerleave', set(false));
      }
    }
  }

  root.SnakeInput = { Input, PAD };
})(typeof globalThis !== 'undefined' ? globalThis : this);
