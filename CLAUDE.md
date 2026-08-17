# Block Snake

Third-person 3D snake game. You play as the snake; a chase camera rides behind the
head and the body follows the path the head actually travelled.

Live: **https://zoodstock.github.io/snake/** (deployed from `main` by GitHub Actions)

Rendering is three.js, vendored in the repo and wired up with an importmap. No build
step, no bundler — the browser loads the ES modules directly.

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

vendor/three-0.160.0/   three.js r160 + its licence. Not ours; don't edit.
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
- To inject a driver you need a page of your own: copy `index.html`, append a
  `<script type="module" src="_driver.js">` before `</body>`, and serve both from the
  repo root so the same-origin `src/` imports still resolve. Delete them afterwards.
- **`--window-size=1280,800` gives a 713px viewport**, and the PNG is padded to 800
  with the page background. A band of `body` colour along the bottom of a shot is that
  padding — *not* a canvas failing to fill the viewport. Compare `window.innerHeight`
  with `canvas.clientHeight` before believing a sizing bug; they matched exactly here.
  The same applies sideways: a 430-wide window reports `innerWidth` 500 and the capture
  clips the right edge, which is why the minimap looks cut off in portrait shots.
- No PIL in the sandbox, but node decodes a screenshot with `zlib.inflateSync` in about
  40 lines (PNG, 8-bit, un-interlaced) when you want pixel statistics — clipping
  percentages, mean brightness — instead of an eyeball.

## Environment (Claude Code on the web, environment "기본값")

Network egress is an **allowlist, and it is fixed when the container starts** — a
running session keeps the policy it booted with, so a settings change only takes
effect in a *new* session.

- Allowed: `github.com`, `api.github.com`.
- Blocked: `registry.npmjs.org`, `pypi.org`, `cdn.jsdelivr.net`, `esm.sh`
  (403 `Host not in allowlist` at the gateway). So `npm install` cannot work.
- `unpkg.com` was requested for the allowlist on 2026-08-17 and is **still 403 in a
  fresh session** — a new session was not enough, so assume it is simply not allowed.
  It no longer matters: three.js is vendored into the repo (see **three.js** below).
- **HTTP is not the only way out.** `curl` gets 403 at the gateway for
  `raw.githubusercontent.com`, `codeload.github.com`, `registry.npmjs.org`, and even
  `api.github.com` for a repo outside this session's scope — but the **git proxy serves
  anonymous git reads of any public GitHub repo**. That is how three.js got here:
  ```bash
  git clone --depth 1 --branch r160 --filter=blob:none --sparse \
    https://github.com/mrdoob/three.js /workspace/three.js
  git -C /workspace/three.js sparse-checkout set build   # ~1.3 MB, not the whole repo
  ```
  So when a dependency is needed and `curl`/`npm install` is blocked: if it is on
  GitHub, a partial `git clone` will get it. Use `--filter=blob:none --sparse` — a full
  clone of a big repo can blow the session's disk allowance.
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

three.js r160 is **vendored** at `vendor/three-0.160.0/three.module.js`, and
`index.html`'s importmap points `three` at that path. There is no CDN at runtime: the
library is served from the same origin as the game, so no outage or version drift at
unpkg can blank the page.

The copy is `build/three.module.js` from `mrdoob/three.js` at tag `r160`
(commit `d04539a`) — the same file `three@0.160.0` ships — with three.js's MIT licence
beside it. To refresh or re-pin it, use the `git clone` recipe in **Environment**;
`curl` cannot reach unpkg or npm from the sandbox, but the git proxy can reach GitHub.

`npm run test:modules` fetches every importmap target that is a local path, so a moved
or renamed vendor file fails CI instead of blanking the page.

### Verified in a browser, 2026-08-17

The scene has now been rendered in headless Chromium (swiftshader) over a real
simulation and looked at, at 1280×713, 2560×613 and 500×813. The four open questions
are settled — don't re-litigate them without a new screenshot:

- **Light intensities are correct as written** (`DirectionalLight` 2.1,
  `HemisphereLight` 1.15, `NoToneMapping`, sRGB output). Decoding the screenshot gave
  0.001% fully-white pixels, 0.6% with any channel at 254+, 0% crushed blacks, mean RGB
  ≈ (85, 129, 106). Nothing clips, so r155+ physically-correct lighting needs no
  rescaling here.
- **Shadows are correct.** No acne and no peter-panning at `shadow.bias = -0.0006`;
  shadows sit against the base of the snake, pillars and walls. The 46-unit frustum
  following the player covers everything close enough to read as contact shadow.
- **The sky gradient survives any aspect ratio.** A plain-texture `scene.background`
  maps straight to the viewport, so the 4×256 gradient always spans the screen
  vertically — ultrawide and portrait both looked right.
- **Ground checker scale is fine**: one cell per `TILE` (4) world units at every arena
  size, because the repeat is derived from the plane size.

Two real defects turned up and are fixed:

- **The arena edge ended in a hard horizon line.** The ground was `(arena + 30) * 2`
  across, putting its edge ~120 units from the player — less than half fogged, so
  bright green met blue sky at a crisp seam. The ground now reaches `FOG_FAR` past the
  arena on every side, so wherever the player stands the nearest edge is at least
  `FOG_FAR` away and fades into the sky. The camera's `far` went 320 → 460 to clear the
  bigger ground's far corner: left at 320 the far plane sliced the fogged ground and put
  the seam straight back.
- **The boost meter's two labels touched** at narrow widths, reading as `BOOSTSHIFT`.
  The keyboard hint is hidden below 620px now, which is what that media query already
  does to `.keys`.

Not a defect, checked and dismissed: the band of page background along the bottom of a
1280×800 screenshot is capture padding, not a canvas sizing bug — see **Verifying
changes**.
