# cursor-motion

Natural, spring-based cursor motion for the web. A direct JavaScript port of the cursor motion model used in [`iFurySt/open-codex-computer-use`](https://github.com/iFurySt/open-codex-computer-use), itself reverse-engineered from OpenAI Codex Computer Use.

- Multi-segment cubic Bezier path generation with heading-driven candidate scoring.
- Velocity-Verlet spring progress with the binary-confirmed `response = 1.4 / dampingFraction = 0.9 / dt = 1/240` constants.
- `closeEnough` interaction gate (≈ 1.43s) so sequences feel continuous rather than rigidly waiting for full settle.
- Zero dependencies, ESM, ~12 KB unminified, framework-agnostic. Ships with a drop-in DOM renderer.

## Quick start

```html
<script type="module">
  import { CursorMotionEngine, DomCursorRenderer } from './src/index.js';

  const stage = document.getElementById('stage');
  const renderer = new DomCursorRenderer({ container: stage });
  const engine = new CursorMotionEngine({
    initial: { x: 80, y: 80 },
    onUpdate: renderer.onUpdate,
  });

  stage.addEventListener('click', async (e) => {
    const r = stage.getBoundingClientRect();
    await engine.moveTo({ x: e.clientX - r.left, y: e.clientY - r.top });
    await engine.click();
  });
</script>
```

Run the bundled demo:

```bash
cd cursor-motion
npm run demo
# open http://localhost:8765/demo/
```

## Architecture

Four layers, mirroring the original Swift implementation:

| Layer | File | Role |
|---|---|---|
| Vec2 helpers | `src/vec2.js` | Pure `{x,y}` math. No state. |
| Path geometry | `src/path.js` | `CursorMotionPath` + `Segment`, cubic sampling, fixed-step measurement (length / angle energy / total turn / staysInBounds). |
| Candidate generator | `src/candidates.js` | Heading-driven `direct / turn / brake / orbit` candidate family + scoring + chooser. |
| Spring | `src/spring.js` | Velocity-Verlet integrator with binary-confirmed `response 1.4 / damping 0.9 / dt 1/240`. Computes the official ≈ 1.43s close-enough wall-clock time. |
| Engine | `src/engine.js` | `CursorMotionEngine` ties it together with a `requestAnimationFrame` loop and emits per-frame state. |
| DOM renderer | `src/renderer-dom.js` | Optional. Soft glyph + glow + click pulse + debug overlays. |

You can use any subset:

```js
import { makeCandidates, chooseCandidate, samplePath } from 'cursor-motion';

const cands = makeCandidates({ start, end, bounds, startForward, endForward });
const best = chooseCandidate(cands);
const { point } = samplePath(best.path, 0.5);
```

## API

### `new CursorMotionEngine(options)`

| Option | Default | Description |
|---|---|---|
| `initial` | `{x:0,y:0}` | Where the cursor starts. |
| `bounds` | `null` | `{minX, minY, maxX, maxY}` used when scoring candidates. Fall back to `null` for unconstrained moves. |
| `params` | `{ startHandle:0.29, endHandle:0.08, arcSize:0.06, arcFlow:0.64 }` | Path-shape knobs. Match the slider semantics from the original lab. |
| `spring` | `OFFICIAL_SPRING` | Spring config. Use `buildSpringConfig({response, dampingFraction})` to customize. |
| `duration` | computed close-enough time | Wall-clock time per move. Default ≈ 1.4292s. |
| `idle` | `true` | Whether to play the gentle wiggle when at rest. |
| `onUpdate` | `noop` | `(state) => void`, called every frame. |
| `onStateChange` | `noop` | `(phase) => void`, fired on `'idle' / 'moving' / 'clicking'` transitions. |

#### Methods

- `engine.moveTo(target) → Promise<void>` — Move; resolves once the spring reaches close-enough. Calling moveTo again cancels the previous one (the new move starts from the current position and current heading).
- `engine.click({ count, holdMs, gapMs })` — Click pulse animation.
- `engine.stop({ snapToTarget })` — Cancel the current move.
- `engine.setBounds(b)` / `engine.setParams(p)` / `engine.setSpring(c)` / `engine.setDuration(s)` — Live updates.
- `engine.getState()` — Snapshot.
- `engine.destroy()` — Tear down listeners and the rAF loop.

#### `state` payload

```ts
{
  phase: 'idle' | 'moving' | 'clicking',
  sample: {x, y},        // raw path sample (target the visual is following)
  tip:    {x, y},        // visual cursor tip after dynamics smoothing
  angle:  number,        // visual rotation in radians
  heading:{x, y},        // tangent of the current path sample
  velocity:{x, y},       // visual tip velocity (px/s)
  clickProgress: number, // 0..1, peaks during a click pulse
  candidate, candidates,  // chosen candidate + full pool (when moving)
}
```

### `new DomCursorRenderer(options)`

| Option | Default | Description |
|---|---|---|
| `container` | `document.body` | Mount point. Will be made `position: relative` if it isn't already. |
| `zIndex` | `9999` | |
| `size` | `32` | Glyph size in pixels. |
| `showTrail` | `false` | Stroke the recent visual path. |
| `showCandidates` | `false` | Stroke all candidates (selected one solid; rest dashed). |
| `glyphHTML` | bundled SVG | Replace with your own glyph; tip should sit near the upper-left 25/25 anchor. |

### Lower-level pieces

- `samplePath(path, progress) → {point, tangent}` — Evaluate the multi-segment cubic.
- `measurePath(path, bounds?)` — Compute `{length, angleChangeEnergy, maxAngleChange, totalTurn, staysInBounds}`.
- `makeCandidates({start, end, bounds, startForward, endForward, params}) → CursorMotionCandidate[]`.
- `chooseCandidate(candidates) → CursorMotionCandidate | null`.
- `buildSpringConfig({response, dampingFraction})` — Make a custom spring; stiffness and drag are derived from response/damping the same way the binary does.
- `advanceTo(current, target, state, targetTime, config)` / `isCloseEnough(progress, target, config)` — Use the spring directly without the engine.

## Integrating into a real product

The engine is rendering-agnostic. Three common integrations:

1. **Overlay layer.** Mount `DomCursorRenderer` on the body or any container. Use `engine.moveTo` + `engine.click` driven by a recorded script, an LLM tool call, or interactive demos.
2. **Custom renderer.** Pass your own `onUpdate` and draw with Canvas, WebGL, React, or plain CSS transforms. The state payload is everything you need.
3. **Pure path generator.** Use `makeCandidates` + `chooseCandidate` to produce SVG paths for guided tour highlights, marketing animations, or onboarding flows that don't actually need a moving cursor.

## Differences from the Swift original

- No native AppKit overlay window or target-window hit testing. The web port assumes the renderer composites over your DOM tree.
- The visible-cursor "fog / wiggle" dynamics are a smaller, purely exponential follow filter rather than a per-axis Velocity-Verlet sim. At 60–120 fps on a typical browser you won't see the difference, and it's measurably cheaper.
- The 20-candidate `tableA × tableB` raw geometry from the binary is omitted in favor of the heading-driven model used in the Swift main runtime, which produces single-sided C-shapes more reliably across web layouts.

## License

MIT.
