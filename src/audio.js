/*
 * Procedural sound effects (no asset files): short synthesised blips built
 * with WebAudio oscillators and a noise burst for the crash.
 */
(function (root) {
  'use strict';

  class Sfx {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.master = null;
    }

    /** Browsers require a user gesture before audio may start. */
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
      } catch (err) {
        this.ctx = null;
      }
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.32;
      return this.muted;
    }

    _tone(freq, endFreq, duration, type, gain, delay) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(env).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }

    _noise(duration, gain, filterFreq) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const frames = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq || 900, t0);
      const env = ctx.createGain();
      env.gain.setValueAtTime(gain || 0.4, t0);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter).connect(env).connect(this.master);
      src.start(t0);
    }

    eat(combo) {
      const step = Math.min(4, (combo || 1) - 1);
      this._tone(440 + step * 90, 880 + step * 120, 0.11, 'square', 0.26);
    }

    golden() {
      [0, 1, 2].forEach((i) => this._tone(660 + i * 220, 990 + i * 220, 0.1, 'triangle', 0.24, i * 0.06));
    }

    kill() {
      this._tone(300, 90, 0.22, 'sawtooth', 0.3);
      this._noise(0.25, 0.3, 1400);
    }

    die() {
      this._tone(420, 60, 0.5, 'square', 0.3);
      this._noise(0.55, 0.45, 700);
    }

    start() {
      [0, 1, 2].forEach((i) => this._tone(330 + i * 165, 440 + i * 165, 0.12, 'triangle', 0.22, i * 0.08));
    }
  }

  root.SnakeAudio = { Sfx };
})(typeof globalThis !== 'undefined' ? globalThis : this);
