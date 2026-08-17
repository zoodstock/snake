/*
 * Entry point. Boots the game and, if the browser cannot run it, says so on the
 * page instead of failing silently in the console.
 */

import { Game } from './game.js';

function boot() {
  try {
    const game = new Game(document);
    game.run();
    window.game = game;          // handy in the console and for headless checks
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
