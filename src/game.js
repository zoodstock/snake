/*
 * The game shell: owns the world, renderer, camera, input and sound, runs the
 * frame loop and moves between menu / playing / paused / dead. All screen
 * furniture lives in Hud; all rules live in the simulation.
 */

import { World } from './sim/world.js';
import { stickToHeading } from './sim/math.js';
import { Renderer } from './render/renderer.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input/input.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './hud.js';

const BEST_KEY = 'blocksnake.best';
const MAX_DPR = 2;

/** Speed creeps up with score, so long runs stay tense. */
function speedForScore(score) {
  return 11.5 + Math.min(4, score / 500);
}

export class Game {
  constructor(doc) {
    this.doc = doc;
    this.canvas = doc.getElementById('scene');
    this.hud = new Hud(doc);

    this.renderer = new Renderer(this.canvas);
    this.world = new World({ seed: (Math.random() * 1e9) | 0 });
    this.camera = new ChaseCamera();
    this.camera.snapTo(this.world.player);
    this.sfx = new Sfx();

    this.best = this._loadBest();
    this.state = 'menu';
    this.deadFor = 0;
    this.lastTime = 0;
    this._running = false;

    this.input = new Input(this.canvas, {
      confirm: () => this.onConfirm(),
      pause: () => this.togglePause(),
      mute: () => this.toggleMute(),
      stick: () => this.toggleStick(),
      zoom: (d) => this.camera.addZoom(d),
      padConnected: () => this.hud.flash('gamepad ready', true),
      anyInput: () => {
        this.sfx.unlock();
        if (this.state === 'menu') this.start();
      },
    }, {
      stickBase: doc.getElementById('stickBase'),
      stickKnob: doc.getElementById('stickKnob'),
      boostButton: doc.getElementById('boostBtn'),
    });

    this._bindShell();
    this.resize();
    this.hud.setStick(this.input.stickVisible);
    this.hud.showOverlay('menu');
    this.hud.update(this.world, this.best, true);
  }

  /** Kick off the frame loop. */
  run() {
    if (this._running) return;
    this._running = true;
    this.lastTime = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      this.frame(now);
    };
    requestAnimationFrame(frame);
  }

  _bindShell() {
    this.canvas.addEventListener('pointerdown', () => {
      // Claim keyboard focus — the page may be running inside an iframe.
      this.canvas.focus();
      try { window.focus(); } catch (err) { /* cross-origin parent */ }
      this.sfx.unlock();
      if (this.state === 'menu') this.start();
      else if (this.state === 'dead' && this.deadFor > 0.8) this.start();
    });

    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.hidden && this.state === 'playing') this.togglePause();
    });
    window.addEventListener('resize', () => this.resize());

    for (const btn of this.doc.querySelectorAll('[data-action]')) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.getAttribute('data-action');
        if (action === 'start') { this.sfx.unlock(); this.start(); }
        else if (action === 'mute') this.toggleMute();
        else if (action === 'pause') this.togglePause();
        else if (action === 'stick') this.toggleStick();
      });
    }
  }

  // -------------------------------------------------------------------- states

  start() {
    this.world.seed = (Math.random() * 1e9) | 0;
    this.world.reset();
    this.camera.snapTo(this.world.player);
    this.state = 'playing';
    this.deadFor = 0;
    this.hud.hideOverlay();
    this.hud.update(this.world, this.best, true);
    this.sfx.start();
  }

  onConfirm() {
    if (this.state === 'menu' || this.state === 'dead') this.start();
    else if (this.state === 'paused') this.togglePause();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.hud.showOverlay('paused');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.hideOverlay();
      this.lastTime = performance.now();
    }
  }

  toggleMute() {
    this.sfx.unlock();
    this.hud.setMuted(this.sfx.toggleMute());
  }

  toggleStick() {
    this.hud.setStick(this.input.toggleStick());
    this.resize();
  }

  // --------------------------------------------------------------------- frame

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight, dpr);
  }

  /**
   * Keyboard and drag give a turn rate directly. A stick gives a direction, read
   * relative to the camera, which the snake then turns toward — so "push left"
   * means left on screen no matter which way the snake happens to face.
   */
  readSteer() {
    const keyed = this.input.steer;
    if (keyed !== 0) return keyed;
    const stick = this.input.stick;
    if (!stick) return 0;
    const heading = stickToHeading(stick.x, stick.y, this.camera.yaw);
    if (!heading) return 0;
    const player = this.world.player;
    return player.steerToward(player.x + heading.x * 8, player.z + heading.z * 8);
  }

  frame(now) {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (this.canvas.clientWidth &&
        this.renderer.width !== Math.round(this.canvas.clientWidth * dpr)) {
      this.resize();
    }

    this.input.update();
    const world = this.world;

    if (this.state === 'playing') {
      world.player.speed = speedForScore(world.score);
      this.handleEvents(world.update(dt, { steer: this.readSteer(), boost: this.input.boost }));
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

    this.hud.tick(dt);
    this.renderer.render(world, this.camera);
    this.hud.drawMinimap(world);
    this.hud.update(world, this.best, false);
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'eat') {
        if (e.golden) this.sfx.golden(); else this.sfx.eat(e.combo);
        const gained = (e.golden ? 30 : 10) * e.combo;
        this.hud.flash('+' + gained + (e.combo > 1 ? ' ×' + e.combo : ''), e.golden);
        this.camera.kick(0.08);
      } else if (e.type === 'kill') {
        this.sfx.kill();
        this.hud.flash('rival crushed +60', true);
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
        this.hud.showOverlay('dead', { world: this.world, best: this.best });
      }
    }
  }

  // ------------------------------------------------------------------ best score

  _loadBest() {
    try {
      return parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    } catch (err) {
      return 0;   // private mode, or storage blocked in an embed
    }
  }

  _saveBest(value) {
    try { window.localStorage.setItem(BEST_KEY, String(value)); } catch (err) { /* ignore */ }
  }
}
