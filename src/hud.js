/*
 * Everything on top of the canvas: the stat readouts, the boost meter, the
 * minimap, the score flash and the menu / pause / game-over overlay.
 *
 * The Hud owns all of the DOM so the Game can stay about gameplay. It reads the
 * world, it never changes it.
 */

import { PALETTE } from './render/palette.js';

const DEATH_TEXT = {
  wall: 'You slithered straight into the wall.',
  block: 'You headbutted a block.',
  self: 'You bit your own tail.',
  rival: 'A rival snake ended your run.',
};

const FLASH_SECONDS = 1.1;

export class Hud {
  constructor(doc) {
    const $ = (id) => doc.getElementById(id);
    this.stats = {
      score: $('score'),
      length: $('length'),
      best: $('best'),
      combo: $('combo'),
      rivals: $('rivals'),
      boost: $('boostFill'),
    };
    this.flashEl = $('flash');
    this.overlay = {
      root: $('overlay'),
      title: $('overlayTitle'),
      body: $('overlayBody'),
      hint: $('overlayHint'),
    };
    this.muteBadge = $('muteBadge');
    this.stickBadge = $('stickBadge');
    this.minimap = $('minimap');
    this.minimapCtx = this.minimap ? this.minimap.getContext('2d') : null;
    this.flashTimer = 0;
    this._cache = {};
  }

  // ------------------------------------------------------------------ readouts

  /** Push world state into the stat panel. `force` rewrites even unchanged values. */
  update(world, best, force) {
    const cache = this._cache;
    const set = (key, el, value) => {
      if (!el) return;
      if (force || cache[key] !== value) {
        el.textContent = value;
        cache[key] = value;
      }
    };
    set('score', this.stats.score, world.score);
    set('length', this.stats.length, world.player.segments);
    set('best', this.stats.best, Math.max(best, world.score));
    set('rivals', this.stats.rivals, world.rivals.reduce((n, r) => n + (r.snake.alive ? 1 : 0), 0));
    set('combo', this.stats.combo, world.combo > 1 ? '×' + world.combo : '');

    if (this.stats.boost) {
      const pct = Math.round(world.stamina * 100);
      if (force || cache.boost !== pct) {
        this.stats.boost.style.width = pct + '%';
        this.stats.boost.classList.toggle('low', world.stamina < 0.2);
        cache.boost = pct;
      }
    }
  }

  setMuted(muted) {
    if (this.muteBadge) this.muteBadge.textContent = muted ? 'muted' : 'sound on';
  }

  setStick(on) {
    if (this.stickBadge) this.stickBadge.textContent = on ? 'stick on' : 'stick off';
  }

  flash(text, strong) {
    const el = this.flashEl;
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('gold', !!strong);
    el.classList.add('visible');
    this.flashTimer = FLASH_SECONDS;
  }

  /** Let the transient score flash fade out. */
  tick(dt) {
    if (this.flashTimer <= 0) return;
    this.flashTimer -= dt;
    if (this.flashTimer <= 0 && this.flashEl) this.flashEl.classList.remove('visible');
  }

  // ------------------------------------------------------------------- overlay

  showOverlay(kind, ctx) {
    const o = this.overlay;
    if (!o.root) return;
    if (kind === 'menu') {
      o.title.textContent = 'BLOCK SNAKE';
      o.body.innerHTML = 'You <strong>are</strong> the snake. Grow, dodge blocks, outlive the rivals.';
      o.hint.innerHTML = 'Click <strong>Slither</strong> to start, then <kbd>A</kbd><kbd>D</kbd> or ' +
        '<kbd>←</kbd><kbd>→</kbd> to steer &nbsp;·&nbsp; <kbd>Shift</kbd> to boost &nbsp;·&nbsp; ' +
        '<kbd>J</kbd> for the stick';
    } else if (kind === 'paused') {
      o.title.textContent = 'PAUSED';
      o.body.textContent = 'Take a breath.';
      o.hint.innerHTML = '<kbd>P</kbd> or <kbd>Enter</kbd> to resume';
    } else if (kind === 'dead') {
      const world = ctx.world;
      o.title.textContent = 'CHOMPED';
      o.body.innerHTML =
        (DEATH_TEXT[world.deathCause] || 'Your run is over.') +
        '<span class="stats">score <strong>' + world.score + '</strong>' +
        ' · length <strong>' + world.player.segments + '</strong>' +
        ' · food <strong>' + world.eaten + '</strong>' +
        ' · rivals crushed <strong>' + world.kills + '</strong>' +
        ' · best <strong>' + ctx.best + '</strong></span>';
      o.hint.innerHTML = '<kbd>Enter</kbd> / <kbd>R</kbd> or click to slither again';
    }
    o.root.dataset.kind = kind;
    o.root.classList.add('visible');
  }

  hideOverlay() {
    if (this.overlay.root) this.overlay.root.classList.remove('visible');
  }

  // ------------------------------------------------------------------- minimap

  drawMinimap(world) {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const size = this.minimap.width;
    const arena = world.cfg.arena;
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
    for (const o of world.obstacles) {
      const s = Math.max(2, o.size * scale);
      ctx.fillRect(toX(o.x) - s / 2, toY(o.z) - s / 2, s, s);
    }

    for (const f of world.foods) {
      ctx.fillStyle = f.golden ? '#ffc63c' : '#e8434f';
      ctx.beginPath();
      ctx.arc(toX(f.x), toY(f.z), f.golden ? 3 : 2.2, 0, 6.283);
      ctx.fill();
    }

    const trace = (snake, stroke, width) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(toX(snake.x), toY(snake.z));
      for (const seg of snake.body) ctx.lineTo(toX(seg.x), toY(seg.z));
      ctx.stroke();
    };

    for (const r of world.rivals) {
      if (!r.snake.alive) continue;
      const tint = PALETTE.rivals[r.tint % PALETTE.rivals.length][0];
      trace(r.snake, 'rgba(' + tint.map((c) => Math.round(c * 255)).join(',') + ',0.9)', 2);
    }
    if (world.player.body.length) trace(world.player, 'rgba(120, 235, 100, 0.95)', 2.4);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(toX(world.player.x), toY(world.player.z), 2.8, 0, 6.283);
    ctx.fill();
  }
}
