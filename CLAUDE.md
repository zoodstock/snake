# Block Snake

Third-person 3D snake game. You play as the snake; a chase camera rides behind the
head and the body follows the path the head actually travelled.

Live: **https://zoodstock.github.io/snake/** (deployed from `main` by GitHub Actions)

No dependencies, no build step, no bundler. The browser loads ES modules directly.

## Commands

```bash
npm test        # node tests/logic.test.mjs — simulation tests, no browser needed
npm start       # python3 -m http.server 8000
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

src/render/renderer.js  scene assembly: sky → ground → shadows → solids → glows
src/render/gl.js        context, programs, meshes, instanced batches
src/render/shaders.js   GLSL ES 1.00 sources
src/render/palette.js   colours
src/render/mat4.js      4x4 matrices

src/input/input.js      keyboard / mouse drag / touch / gamepad
src/input/joystick.js   on-screen thumbstick
src/audio/sfx.js        synthesised WebAudio effects
```

Rules that are easy to break by accident:

- Nothing under `src/sim/` may import from `render/`, `input/` or the DOM.
- The body is sampled from the head's trail **by arc length**, not stored per-frame.
  Trail points are pruned to the body length, so memory stays flat.
- Everything solid is drawn from one instanced cube (4 draw calls/frame). New scene
  content should join a batch, not add a draw call.
- Ground shader tiling needs `highp` (guarded by `GL_FRAGMENT_PRECISION_HIGH`).
  With `mediump`, `fract()` quantises at the far end of the 150-unit floor and the
  grid breaks into wide bands.
- Rival spawn logic (`_freeSpot` clearance, `_openHeading`) exists because rivals
  used to spawn on top of each other or nose-first into a block and die in a loop.
  Don't simplify it away; `npm test` covers it.
- Steering has two shapes: keyboard/drag give a **turn rate**, sticks give a
  **camera-relative direction** (`stickToHeading`). Keep both.

Tuning constants live in `CFG` in `src/sim/world.js` and `DEFAULTS` in `src/sim/snake.js`.

## Verifying changes

Logic: `npm test` (37 tests, deterministic — `World` takes a seed).

**Rendering cannot be verified by tests.** Check it in a real browser:

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
- `unpkg.com` was added to the allowlist on 2026-08-17 at the user's request. It was
  still 403 in the session that requested it. **Check it at session start:**
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

## Pending work

**Port `src/render/` to three.js.** The user prefers three.js and it is the reason
`unpkg.com` was allowlisted. Their own `zoodstock/minecraft` repo (code lives on the
`claude/minecraft-game-prototype-KmKxV` branch, not `main`) does it like this:

```html
<script type="importmap">
{ "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
</script>
```

with `import * as THREE from 'three'` and no vendored copy — the *player's browser*
fetches three.js, which is why that project worked despite the blocked sandbox.

Prefer vendoring three.js into the repo once `unpkg.com` is reachable, so the site has
no runtime CDN dependency, and verify the port headlessly (see above) before pushing.
three.js would also replace the fake shadow blobs with real shadow maps. Only
`src/render/` and the small camera glue should need to change — that is what the
layering is for.
