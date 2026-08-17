/*
 * Game shell: boots the renderer, runs the frame loop, drives the HUD,
 * the minimap and the menu / pause / game-over states.
 */
(function (root) {
  'use strict';

  const M3 = root.M3;
  const { World } = root.WorldSim;
  const { Renderer, PALETTE } = root.SnakeRenderer;
  const { ChaseCamera } = root.SnakeCamera;
  const { Input } = root.SnakeInput;
  const { Sfx } = root.SnakeAudio;

  const DEATH_TEXT = {
    wall: 'You slithered straight into the wall.',
    block: 'You headbutted a block.',
    self: 'You bit your own tail.',
    rival: 'A rival snake ended your run.',
  };

  const BEST_KEY = 'blocksnake.best';

  class Game {
    constructor() {
      this.canvas = document.getElementById('scene');
      this.minimap = document.getElementById('minimap');
      this.minimapCtx = this.minimap ? this.minimap.getContext('2d') : null;
      this.hud = {
        score: document.getElementById('score'),
        length: document.getElementById('length'),
        best: document.getElementById('best'),
        combo: document.getElementById('combo'),
        boost: document.getElementById('boostFill'),
        rivals: document.getElementById('rivals'),
        flash: document.getElementById('flash'),
      };
      this.overlay = {
        root: document.getElementById('overlay'),
        title: document.getElementById('overlayTitle'),
        body: document.getElementById('overlayBody'),
        hint: document.getElementById('overlayHint'),
      };
      this.muteBadge = document.getElementById('muteBadge');

      this.renderer = new Renderer(this.canvas);
      this.world = new World({ seed: (Math.random() * 1e9) | 0 });
      this.camera = new ChaseCamera();
      this.camera.snapTo(this.world.player);
      this.sfx = new Sfx();
      this.best = this._loadBest();
      this.state = 'menu';
      this.flashTimer = 0;
      this.lastTime = 0;
      this._hudCache = {};

      this.input = new Input(this.canvas, {
        confirm: () => this.onConfirm(),
        pause: () => this.togglePause(),
        mute: () => this.toggleMute(),
        zoom: (d) => this.camera.addZoom(d),
        anyInput: () => {
          this.sfx.unlock();
          if (this.state === 'menu') this.start();
        },
      });

      this.canvas.addEventListener('pointerdown', () => {
        // Claim keyboard focus — the page may be running inside an iframe.
        this.canvas.focus();
        try { window.focus(); } catch (err) { /* cross-origin parent */ }
        this.sfx.unlock();
        if (this.state === 'menu') this.start();
        else if (this.state === 'dead' && this.deadFor > 0.8) this.start();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'playing') this.togglePause();
      });
      window.addEventListener('resize', () => this.resize());

      for (const btn of document.querySelectorAll('[data-action]')) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = btn.getAttribute('data-action');
          if (action === 'start') { this.sfx.unlock(); this.start(); }
          else if (action === 'mute') this.toggleMute();
          else if (action === 'pause') this.togglePause();
        });
      }

      this.resize();
      this.showOverlay('menu');
      this.updateHud(true);
      this.lastTime = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    // ------------------------------------------------------------------ states

    start() {
      this.world.seed = (Math.random() * 1e9) | 0;
      this.world.reset();
      this.camera.snapTo(this.world.player);
      this.state = 'playing';
      this.deadFor = 0;
      this.hideOverlay();
      this.sfx.start();
      this.updateHud(true);
    }

    onConfirm() {
      if (this.state === 'menu') this.start();
      else if (this.state === 'dead') this.start();
      else if (this.state === 'paused') this.togglePause();
    }

    togglePause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.showOverlay('paused');
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.hideOverlay();
        this.lastTime = performance.now();
      }
    }

    toggleMute() {
      this.sfx.unlock();
      const muted = this.sfx.toggleMute();
      if (this.muteBadge) this.muteBadge.textContent = muted ? 'muted' : 'sound on';
    }

    showOverlay(kind) {
      const o = this.overlay;
      if (!o.root) return;
      if (kind === 'menu') {
        o.title.textContent = 'BLOCK SNAKE';
        o.body.innerHTML = 'You <strong>are</strong> the snake. Grow, dodge blocks, outlive the rivals.';
        o.hint.innerHTML = 'Click <strong>Slither</strong> to start, then <kbd>A</kbd><kbd>D</kbd> or <kbd>←</kbd><kbd>→</kbd> to steer &nbsp;·&nbsp; <kbd>Shift</kbd> to boost';
      } else if (kind === 'paused') {
        o.title.textContent = 'PAUSED';
        o.body.textContent = 'Take a breath.';
        o.hint.innerHTML = '<kbd>P</kbd> or <kbd>Enter</kbd> to resume';
      } else if (kind === 'dead') {
        const w = this.world;
        o.title.textContent = 'CHOMPED';
        o.body.innerHTML =
          (DEATH_TEXT[w.deathCause] || 'Your run is over.') +
          '<span class="stats">score <strong>' + w.score + '</strong>' +
          ' · length <strong>' + w.player.segments + '</strong>' +
          ' · food <strong>' + w.eaten + '</strong>' +
          ' · rivals crushed <strong>' + w.kills + '</strong>' +
          ' · best <strong>' + this.best + '</strong></span>';
        o.hint.innerHTML = '<kbd>Enter</kbd> / <kbd>R</kbd> or click to slither again';
      }
      o.root.dataset.kind = kind;
      o.root.classList.add('visible');
    }

    hideOverlay() {
      if (this.overlay.root) this.overlay.root.classList.remove('visible');
    }

    // ------------------------------------------------------------------- frame

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight, dpr);
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (!isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 0.1);

      if (this.canvas.clientWidth && this.renderer.width !== Math.round(this.canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2))) {
        this.resize();
      }

      const world = this.world;
      if (this.state === 'playing') {
        // A little speed creep keeps long runs tense.
        world.player.speed = 11.5 + Math.min(4, world.score / 500);
        const events = world.update(dt, { steer: this.input.steer, boost: this.input.boost });
        this.handleEvents(events);
        this.camera.update(dt, world.player, true);
      } else if (this.state === 'dead') {
        this.deadFor += dt;
        world.update(dt, {});
        this.camera.update(dt, world.player, false);
      } else {
        // Menu and pause: keep the scene breathing without advancing the snake.
        this.camera.update(dt, world.player, this.state === 'menu');
        if (this.state === 'menu') {
          world.player.phase += dt * 4;
          for (const f of world.foods) f.phase += dt * 2.4;
        }
      }

      if (this.flashTimer > 0) {
        this.flashTimer -= dt;
        if (this.flashTimer <= 0 && this.hud.flash) this.hud.flash.classList.remove('visible');
      }

      this.renderer.render(world, this.camera);
      this.drawMinimap();
      this.updateHud(false);
    }

    handleEvents(events) {
      for (const e of events) {
        if (e.type === 'eat') {
          if (e.golden) this.sfx.golden(); else this.sfx.eat(e.combo);
          const gained = (e.golden ? 30 : 10) * e.combo;
          this.showFlash('+' + gained + (e.combo > 1 ? ' ×' + e.combo : ''), e.golden);
          this.camera.kick(0.08);
        } else if (e.type === 'kill') {
          this.sfx.kill();
          this.showFlash('rival crushed +60', true);
          this.camera.kick(0.25);
        } else if (e.type === 'die') {
          this.sfx.die();
          this.camera.kick(1.2);
          this.state = 'dead';
          this.deadFor = 0;
          if (this.world.score > this.best) {
            this.best = this.world.score;
            this._saveBest(this.best);
          }
          this.showOverlay('dead');
        }
      }
    }

    showFlash(text, strong) {
      const el = this.hud.flash;
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('gold', !!strong);
      el.classList.add('visible');
      this.flashTimer = 1.1;
    }

    updateHud(force) {
      const w = this.world;
      const cache = this._hudCache;
      const set = (key, el, value) => {
        if (!el) return;
        if (force || cache[key] !== value) {
          el.textContent = value;
          cache[key] = value;
        }
      };
      set('score', this.hud.score, w.score);
      set('length', this.hud.length, w.player.segments);
      set('best', this.hud.best, Math.max(this.best, w.score));
      const alive = w.rivals.reduce((n, r) => n + (r.snake.alive ? 1 : 0), 0);
      set('rivals', this.hud.rivals, alive);
      const combo = w.combo > 1 ? '×' + w.combo : '';
      set('combo', this.hud.combo, combo);
      if (this.hud.boost) {
        const pct = Math.round(w.stamina * 100);
        if (force || cache.boost !== pct) {
          this.hud.boost.style.width = pct + '%';
          this.hud.boost.classList.toggle('low', w.stamina < 0.2);
          cache.boost = pct;
        }
      }
    }

    drawMinimap() {
      const ctx = this.minimapCtx;
      if (!ctx) return;
      const w = this.world;
      const size = this.minimap.width;
      const arena = w.cfg.arena;
      const scale = size / (arena * 2 + 6);
      const toX = (x) => size / 2 + x * scale;
      const toY = (z) => size / 2 - z * scale;

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(10, 22, 16, 0.62)';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(toX(-arena), toY(arena), arena * 2 * scale, arena * 2 * scale);

      ctx.fillStyle = 'rgba(180, 190, 200, 0.55)';
      for (const o of w.obstacles) {
        const s = Math.max(2, o.size * scale);
        ctx.fillRect(toX(o.x) - s / 2, toY(o.z) - s / 2, s, s);
      }

      for (const f of w.foods) {
        ctx.fillStyle = f.golden ? '#ffc63c' : '#e8434f';
        ctx.beginPath();
        ctx.arc(toX(f.x), toY(f.z), f.golden ? 3 : 2.2, 0, 6.283);
        ctx.fill();
      }

      for (const r of w.rivals) {
        if (!r.snake.alive) continue;
        const tint = PALETTE.rivals[r.tint % PALETTE.rivals.length][0];
        ctx.strokeStyle = 'rgba(' + tint.map((c) => Math.round(c * 255)).join(',') + ',0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(r.snake.x), toY(r.snake.z));
        for (const seg of r.snake.body) ctx.lineTo(toX(seg.x), toY(seg.z));
        ctx.stroke();
      }

      if (w.player.body.length) {
        ctx.strokeStyle = 'rgba(120, 235, 100, 0.95)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(toX(w.player.x), toY(w.player.z));
        for (const seg of w.player.body) ctx.lineTo(toX(seg.x), toY(seg.z));
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(toX(w.player.x), toY(w.player.z), 2.8, 0, 6.283);
      ctx.fill();
    }

    _loadBest() {
      try {
        return parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10) || 0;
      } catch (err) { return 0; }
    }

    _saveBest(value) {
      try { window.localStorage.setItem(BEST_KEY, String(value)); } catch (err) { /* private mode */ }
    }
  }

  function boot() {
    try {
      root.game = new Game();
    } catch (err) {
      const fallback = document.getElementById('fatal');
      if (fallback) {
        fallback.textContent = String(err && err.message ? err.message : err);
        fallback.classList.add('visible');
      }
      throw err;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
