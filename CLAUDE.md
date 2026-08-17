# Block Snake

Third-person 3D snake game. You play as the snake; a chase camera rides behind the
head and the body follows the path the head actually travelled.

Live: **https://zoodstock.github.io/snake/** (deployed from `main` by GitHub Actions)

Rendering is three.js, loaded from a CDN via an importmap. No build step, no
bundler — the browser loads the ES modules directly.

## Commands

```bash
npm test            # simulation tests + renderer smoke test (no browser, no network)
npm start           # python3 -m http.server 8000
npm run test:modules   # with a server running: every import resolves
```

**ES modules do not load over `file://`.** Opening `index.html` by double-click gives
a blank page (CORS). Always serve it. Do not "fix" this by inlining everything into
one HTML file — the user explicitly asked for real modules, and the old single-file
bundler was removed for that reason.

## Architecture

Dependencies run one way: `sim` knows nothing, `render` only reads the world, and
`game`/`hud` wire them to the page. Keep it that way — it is what makes the
simulation testable in node and the renderer replaceable.

```
index.html              markup, HUD, CSS, single <script type="module">
src/main.js             entry: boot + fatal-error display
src/game.js             frame loop, state machine (menu/playing/paused/dead), input → sim
src/hud.js              ALL DOM: stats, boost meter, minimap, flash, overlays
src/camera.js           third-person chase camera

src/sim/math.js         scalars, angles, stick → heading   (no DOM, no GL)
src/sim/snake.js        head movement, trail, body sampling
src/sim/world.js        arena, food, obstacles, rival AI, collisions, scoring

src/render/renderer.js  three.js scene: lights, ground, instanced box batches
src/render/palette.js   colours, as hex numbers

src/input/input.js      keyboard / mouse drag / touch / gamepad
src/input/joystick.js   on-screen thumbstick
src/audio/sfx.js        synthesised WebAudio effects
```

Rules that are easy to break by accident:

- Nothing under `src/sim/` may import from `render/`, `input/` or the DOM.
- The body is sampled from the head's trail **by arc length**, not stored per-frame.
  Trail points are pruned to the body length, so memory stays flat.
- Nearly everything is an instanced box in one of four batches (`scenery`, `bodies`,
  `glow`, `beacons`). New scene content should join a batch, not add a mesh.
  `scenery` is static and only rebuilt when `world.obstacles` is replaced.
- Colours in `palette.js` are hex numbers so `new THREE.Color(hex)` does the
  sRGB→linear conversion. Don't pass 0..1 triples to three.js.
- `InstancedMesh.frustumCulled` must stay false: instances move every frame, so the
  mesh's bounding sphere is meaningless and three would cull the whole batch.
- Rival spawn logic (`_freeSpot` clearance, `_openHeading`) exists because rivals
  used to spawn on top of each other or nose-first into a block and die in a loop.
  Don't simplify it away; `npm test` covers it.
- Steering has two shapes: keyboard/drag give a **turn rate**, sticks give a
  **camera-relative direction** (`stickToHeading`). Keep both.

Tuning constants live in `CFG` in `src/sim/world.js` and `DEFAULTS` in `src/sim/snake.js`.

## Verifying changes

`npm test` runs two suites, neither needing a browser or network:

- `tests/logic.test.mjs` — 35 simulation tests, deterministic (`World` takes a seed).
- `tests/renderer.smoke.mjs` — drives the real renderer over a real simulation with
  three.js swapped for `tests/three-stub.mjs` (resolved by a loader hook). It proves
  the renderer runs and produces finite transforms inside its instance budgets. It
  proves nothing about how the scene looks, and it is not a test of three.js: if the
  renderer starts using a three.js API the stub lacks, add it to the stub.

**How the scene actually looks can only be verified in a browser:**

```bash
python3 -m http.server 8123 &
/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  --headless=new --no-sandbox --disable-dev-shm-usage \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --no-proxy-server --hide-scrollbars --window-size=1280,800 \
  --virtual-time-budget=40000 \
  --screenshot=/tmp/shot.png --dump-dom http://127.0.0.1:8123/index.html
```

Then `Read` the PNG to actually look at it. Notes learned the hard way:

- `requestAnimationFrame` barely ticks in this headless mode. To advance the game,
  override `window.requestAnimationFrame = () => 0` and call `game.frame(t)` in a
  loop with your own increasing timestamps (`game.lastTime = t - 16.7`).
- `console.log` is not forwarded. Report results by writing to `document.title` and
  reading it back from `--dump-dom`.
- For a realistic mid-game screenshot, autopilot the player with the rivals' own
  planner: `world._planSteer({snake: world.player, steer: 0, caution: 0, ...}, goal)`
  (`caution: 0` stops it treating the player's own body as an obstacle).
- Joysticks can be driven with synthetic `PointerEvent`s; gamepads by stubbing
  `navigator.getGamepads()`.
- The playwright npm package is not installed — drive Chromium via its CLI flags.

## Environment (Claude Code on the web, environment "기본값")

Network egress is an **allowlist, and it is fixed when the container starts** — a
running session keeps the policy it booted with, so a settings change only takes
effect in a *new* session.

- Allowed: `github.com`, `api.github.com`.
- Blocked: `registry.npmjs.org`, `pypi.org`, `cdn.jsdelivr.net`, `esm.sh`
  (403 `Host not in allowlist` at the gateway). So `npm install` cannot work.
- `unpkg.com` hosts three.js for this project and was added to the allowlist on
  2026-08-17. It was still 403 in the session that requested it, because the policy
  is fixed at boot — a *new session* is needed. **Check it at session start:**
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' https://unpkg.com/three@0.160.0/package.json
  ```
- **`zoodstock.github.io` is blocked**, so the deployed site cannot be opened from the
  sandbox. After deploying, report the workflow `conclusion` from the Actions API and
  **ask the user to confirm the page actually loads** — never claim the live site works.

## Deployment

- `.github/workflows/pages.yml` — on push to `main`: run tests, then upload the repo
  as a static site. Pages source is GitHub Actions (turned on by `configure-pages`
  with `enablement: true`).
- `.github/workflows/ci.yml` — on pull requests: tests, plus a walk of the module
  graph over HTTP so a bad `import` path fails CI instead of blanking the page.

## Git

- Develop on `claude/third-person-snake-game-dqfp1b`, PR into `main`.
- A merged PR is finished: for follow-up work, restart that branch from the latest
  `main` rather than stacking onto merged history.
- Don't put model identifiers in commits, PR text, or code comments.

## three.js

`index.html` declares an importmap pointing `three` at
`https://unpkg.com/three@0.160.0/build/three.module.js`, the same pattern (and pin) as
the user's `zoodstock/minecraft` project, which has been serving it from GitHub Pages
successfully. The *player's browser* fetches three.js, so the site does not depend on
the sandbox being able to reach unpkg.

Vendoring the file into the repo instead would remove the runtime CDN dependency and
is worth doing once a session can actually download it.

### Not yet verified in a browser

The three.js port was written in a session that could not reach unpkg, so the scene has
never been rendered. The smoke test and module check pass, but these are unconfirmed:

- Light intensities (`DirectionalLight` 2.1, `HemisphereLight` 1.15). three.js r155+
  uses physically-correct lighting, so these may need scaling.
- Real shadow maps replaced the old fake shadow quads: check `shadow.bias` for acne
  or peter-panning, and that the 46-unit shadow frustum following the player is big
  enough.
- `scene.background` is a plain `CanvasTexture` gradient, drawn as a full-screen quad;
  confirm it is not stretched oddly at wide aspect ratios.
- Ground checker scale (`groundTexture.repeat`) and whether the fog range
  (55 → 200) still hides the arena edge.

Run the browser check in **CLAUDE.md → Verifying changes**, look at the screenshot,
then fix and re-verify.
