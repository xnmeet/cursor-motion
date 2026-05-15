export interface CursorMotionBrowserOptions {
  styleId?: string;
  layerId?: string;
  cursorId?: string;
  layerClassName?: string;
  cursorClassName?: string;
  visibleClassName?: string;
  bloomClassName?: string;
  moveGlobal?: string;
  clickGlobal?: string;
  readyGlobal?: string;
  zIndex?: number;
}

const DEFAULT_BROWSER_OPTIONS = {
  styleId: '__cursor-motion-styles',
  layerId: '__cursor-motion-layer',
  cursorId: '__cursor-motion-cursor',
  layerClassName: '__cursor-motion-layer',
  cursorClassName: '__cursor-motion-cursor',
  visibleClassName: '--visible',
  bloomClassName: '__cursor-motion-click-bloom',
  moveGlobal: '__cursorMotionMoveCursor',
  clickGlobal: '__cursorMotionClickCursor',
  readyGlobal: '__cursorMotionReady',
  zIndex: 2147483647,
};

type ResolvedCursorMotionBrowserOptions = Required<CursorMotionBrowserOptions>;

function resolveOptions(options: CursorMotionBrowserOptions = {}): ResolvedCursorMotionBrowserOptions {
  return { ...DEFAULT_BROWSER_OPTIONS, ...options };
}

const POINTER_PATH =
  'M486 501 L498 497.2 L508 489.6 L562.6 418 L585 398.7 L617 388.7 L720 386.4 L739.4 372 L745.3 359 L746.4 348 L742.3 332 L732.6 320 L506 132.7 L488 120.6 L467 117.5 L452 121.7 L439 131.2 L430.7 143 L426.6 158 L440.7 458 L443.9 477 L453.5 491 L467 499.2 L486 501 Z';
const POINTER_TRACE_TRANSFORM = 'matrix(0.0625 0 0 0.0625 -15.06875 -0.3415625)';

const CURSOR_GLYPH_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" style="overflow:visible">
  <defs>
    <radialGradient id="cm-browser-fog">
      <stop offset="0%" stop-color="rgba(97,92,89,0.40)"/>
      <stop offset="50%" stop-color="rgba(110,105,102,0.28)"/>
      <stop offset="82%" stop-color="rgba(117,112,110,0.11)"/>
      <stop offset="100%" stop-color="rgba(153,153,153,0)"/>
    </radialGradient>
  </defs>
  <circle class="cm-fog-circle" cx="24" cy="24" r="33" fill="url(#cm-browser-fog)"/>
  <path class="cm-pointer" d="${POINTER_PATH}"
        transform="${POINTER_TRACE_TRANSFORM}"
        vector-effect="non-scaling-stroke"
        fill="rgba(56,53,51,0.98)"
        stroke="rgba(230,230,230,0.92)"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"/>
</svg>
`.trim();

export function createCursorMotionBrowserStyle(options: CursorMotionBrowserOptions = {}): string {
  const o = resolveOptions(options);

  return `
.${o.layerClassName} {
  position: fixed;
  inset: 0;
  z-index: ${o.zIndex};
  pointer-events: none;
  overflow: visible;
}
.${o.cursorClassName} {
  position: fixed;
  width: 48px;
  height: 48px;
  opacity: 0;
  pointer-events: none;
  box-sizing: border-box;
  transform-origin: 30% 14%;
  will-change: transform, opacity;
  transition: opacity 0.18s ease;
}
.${o.cursorClassName}.${o.visibleClassName} {
  opacity: 1;
}
.${o.cursorClassName} svg {
  display: block;
  width: 48px;
  height: 48px;
  overflow: visible;
}
.${o.bloomClassName} {
  position: fixed;
  width: 54px;
  height: 54px;
  margin-left: -27px;
  margin-top: -27px;
  border-radius: 999px;
  border: 1.5px solid rgba(230, 230, 230, 0.52);
  background: radial-gradient(circle, rgba(97, 92, 89, 0.22) 0%, rgba(97, 92, 89, 0.12) 44%, rgba(97, 92, 89, 0) 72%);
  pointer-events: none;
  animation: __cursor-motion-click-bloom 0.46s ease-out forwards;
  box-sizing: border-box;
}
@keyframes __cursor-motion-click-bloom {
  0% {
    transform: scale(0.44);
    opacity: 0.72;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}
`;
}

export const CURSOR_MOTION_BROWSER_STYLE = createCursorMotionBrowserStyle();

export function createCursorMotionBrowserScript(options: CursorMotionBrowserOptions = {}): string {
  const resolved = resolveOptions(options);
  const style = createCursorMotionBrowserStyle(resolved);

  return `
(function() {
  var win = window;
  var OPTIONS = ${JSON.stringify(resolved)};
  var STYLE_TEXT = ${JSON.stringify(style)};
  var GLYPH_HTML = ${JSON.stringify(CURSOR_GLYPH_SVG)};
  if (win[OPTIONS.readyGlobal]) return;

  var TWO_PI = Math.PI * 2;
  var EPS = 0.000001;
  var BASE_HEADING = -(3 * Math.PI / 4);
  var SPRING = { stiffness: Math.pow(TWO_PI / 1.4, 2), drag: 2 * 0.9 * (TWO_PI / 1.4), dt: 1 / 240 };
  var SPRING_DURATION = 1.43;
  var TIP_STIFF = Math.pow(TWO_PI / 0.18, 2);
  var TIP_DRAG = -2 * 0.76 * Math.sqrt(TIP_STIFF);
  var ANGLE_STIFF = Math.pow(TWO_PI / 0.24, 2);
  var ANGLE_DRAG = -2 * 0.82 * Math.sqrt(ANGLE_STIFF);

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function normalizeAngle(a) {
    var v = a % TWO_PI;
    if (v > Math.PI) return v - TWO_PI;
    if (v <= -Math.PI) return v + TWO_PI;
    return v;
  }
  function len(a) { return Math.hypot(a.x, a.y); }
  function norm(a, fallback) {
    var l = len(a);
    return l < EPS ? (fallback || { x: 1, y: 0 }) : { x: a.x / l, y: a.y / l };
  }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s }; }
  function perp(a) { return { x: -a.y, y: a.x }; }
  function sampleCubic(p0, c1, c2, p1, t) {
    var o = 1 - t;
    var o2 = o * o;
    var t2 = t * t;
    return {
      x: o2 * o * p0.x + 3 * o2 * t * c1.x + 3 * o * t2 * c2.x + t2 * t * p1.x,
      y: o2 * o * p0.y + 3 * o2 * t * c1.y + 3 * o * t2 * c2.y + t2 * t * p1.y,
    };
  }
  function sampleCubicTangent(p0, c1, c2, p1, t) {
    var o = 1 - t;
    return norm({
      x: 3 * o * o * (c1.x - p0.x) + 6 * o * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x),
      y: 3 * o * o * (c1.y - p0.y) + 6 * o * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y),
    });
  }
  function makePath(start, end, heading) {
    var delta = sub(end, start);
    var dist = Math.max(len(delta), 1);
    var dir = norm(delta);
    var normal = perp(dir);
    var cross = heading.x * dir.y - heading.y * dir.x;
    var side = cross > 0.05 ? 1 : (cross < -0.05 ? -1 : (end.y >= start.y ? 1 : -1));
    var arc = clamp(dist * 0.13, 18, 128) * side;
    var c1 = add(add(start, scale(dir, clamp(dist * 0.34, 16, 220))), scale(normal, arc));
    var c2 = add(sub(end, scale(dir, clamp(dist * 0.18, 14, 180))), scale(normal, arc * 0.42));
    return { start: start, end: end, control1: c1, control2: c2 };
  }
  function samplePath(path, progress) {
    var t = clamp(progress, 0, 1);
    return {
      point: sampleCubic(path.start, path.control1, path.control2, path.end, t),
      tangent: sampleCubicTangent(path.start, path.control1, path.control2, path.end, t),
    };
  }

  var state = {
    layer: null,
    cursor: null,
    fog: null,
    hasPosition: false,
    position: { x: 0, y: 0 },
    heading: { x: 1, y: 0 },
    tipX: 0,
    tipY: 0,
    tipVX: 0,
    tipVY: 0,
    tipFX: 0,
    tipFY: 0,
    angle: 0,
    angleVelocity: 0,
    angleForce: 0,
    dynamicsTime: 0,
    clickProgress: 0,
    moveToken: null,
    clickToken: null,
  };

  function ensureStyle() {
    if (document.getElementById(OPTIONS.styleId)) return;
    var style = document.createElement('style');
    style.id = OPTIONS.styleId;
    style.textContent = STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureCursor() {
    ensureStyle();
    var container = document.body || document.documentElement;
    if (!state.layer || !state.layer.isConnected) {
      state.layer = document.getElementById(OPTIONS.layerId);
      if (!state.layer) {
        state.layer = document.createElement('div');
        state.layer.id = OPTIONS.layerId;
        state.layer.className = OPTIONS.layerClassName;
        container.appendChild(state.layer);
      }
    }
    if (!state.cursor || !state.cursor.isConnected) {
      state.cursor = document.getElementById(OPTIONS.cursorId);
      if (!state.cursor) {
        state.cursor = document.createElement('div');
        state.cursor.id = OPTIONS.cursorId;
        state.cursor.className = OPTIONS.cursorClassName;
        state.cursor.innerHTML = GLYPH_HTML;
      }
      state.layer.appendChild(state.cursor);
      state.fog = state.cursor.querySelector('.cm-fog-circle');
    }
  }

  function resetDynamics(x, y) {
    state.tipX = x;
    state.tipY = y;
    state.tipVX = 0;
    state.tipVY = 0;
    state.tipFX = 0;
    state.tipFY = 0;
    state.angle = 0;
    state.angleVelocity = 0;
    state.angleForce = 0;
    state.dynamicsTime = performance.now() / 1000;
  }

  function advanceDynamics(targetX, targetY, now) {
    if (!state.hasPosition) resetDynamics(targetX, targetY);
    if ((now - state.dynamicsTime) > 1) state.dynamicsTime = now - 1 / 60;
    var dt = 1 / 240;
    var half = dt * 0.5;
    while (state.dynamicsTime < now) {
      var vxh = state.tipVX + state.tipFX * half;
      var vyh = state.tipVY + state.tipFY * half;
      var nx = state.tipX + vxh * dt;
      var ny = state.tipY + vyh * dt;
      var fx = (targetX - nx) * TIP_STIFF + TIP_DRAG * vxh;
      var fy = (targetY - ny) * TIP_STIFF + TIP_DRAG * vyh;
      state.tipVX = vxh + fx * half;
      state.tipVY = vyh + fy * half;
      state.tipFX = fx;
      state.tipFY = fy;
      state.tipX = nx;
      state.tipY = ny;

      var speedSq = state.tipVX * state.tipVX + state.tipVY * state.tipVY;
      var targetAngle = speedSq > 196 ? normalizeAngle(Math.atan2(state.tipVY, state.tipVX) - BASE_HEADING) : 0;
      var avh = state.angleVelocity + state.angleForce * half;
      var nextAngle = normalizeAngle(state.angle + avh * dt);
      var angleError = normalizeAngle(targetAngle - nextAngle);
      var af = angleError * ANGLE_STIFF + ANGLE_DRAG * avh;
      state.angleVelocity = avh + af * half;
      state.angleForce = af;
      state.angle = nextAngle;
      state.dynamicsTime += dt;
    }
  }

  function render() {
    ensureCursor();
    var speed = Math.hypot(state.tipVX, state.tipVY);
    var dir = speed > EPS ? { x: state.tipVX / speed, y: state.tipVY / speed } : state.heading;
    var bodyBack = -Math.min(speed * 0.0012, 2.4);
    var lateral = clamp(state.angleVelocity * 0.06, -1.4, 1.4);
    var bodyOffsetX = dir.x * bodyBack - dir.y * lateral;
    var bodyOffsetY = dir.y * bodyBack + dir.x * lateral;
    var fogOffsetX = dir.x * -Math.min(speed * 0.0045, 9) - dir.y * lateral * 0.6;
    var fogOffsetY = dir.y * -Math.min(speed * 0.0045, 9) + dir.x * lateral * 0.6;
    var motionComp = Math.min(Math.hypot(bodyOffsetX, bodyOffsetY) * 0.008, 0.018);
    var pulseComp = state.clickProgress * 0.03;
    var scaleX = 1 - motionComp - pulseComp;
    var scaleY = 1 + pulseComp * 0.4;
    var x = state.tipX + bodyOffsetX;
    var y = state.tipY + bodyOffsetY;
    state.cursor.style.transform =
      'translate(' + x + 'px,' + y + 'px) translate(-30%,-14%) rotate(' + state.angle + 'rad) scale(' + scaleX + ',' + scaleY + ')';
    state.cursor.classList.add(OPTIONS.visibleClassName);
    if (state.fog) {
      state.fog.style.opacity = String(clamp((0.12 + speed * 0.00006) / 0.12, 0.28, 1));
      state.fog.setAttribute('transform', 'translate(' + (fogOffsetX * 0.7) + ' ' + (fogOffsetY * 0.7) + ') scale(' + (1 + Math.min(speed * 0.00012, 0.22)) + ')');
      state.fog.setAttribute('transform-origin', '24 24');
    }
  }

  function snapTo(x, y) {
    ensureCursor();
    state.hasPosition = true;
    state.position = { x: x, y: y };
    resetDynamics(x, y);
    render();
  }

  win[OPTIONS.moveGlobal] = function(x, y, animate) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ensureCursor();
    if (!state.hasPosition || animate === false) {
      snapTo(x, y);
      return;
    }

    var token = {};
    state.moveToken = token;
    var start = { x: state.tipX, y: state.tipY };
    var end = { x: x, y: y };
    var path = makePath(start, end, state.heading);
    var dist = len(sub(end, start));
    var duration = clamp(0.46 + dist * 0.00042, 0.52, 0.82);
    var startedAt = performance.now() / 1000;
    var progress = 0;
    var springVelocity = 0;
    var springForce = 0;
    var springTime = 0;

    function tick(nowMs) {
      if (state.moveToken !== token) return;
      var now = nowMs / 1000;
      var elapsed = now - startedAt;
      var normalized = clamp(elapsed / duration, 0, 1);
      var targetSpringTime = normalized * SPRING_DURATION;
      if ((targetSpringTime - springTime) > 1) springTime = targetSpringTime - 1 / 60;
      while (springTime < targetSpringTime) {
        var half = SPRING.dt * 0.5;
        var vHalf = springVelocity + springForce * half;
        var next = progress + vHalf * SPRING.dt;
        var f = SPRING.stiffness * (1 - next) + (-SPRING.drag) * vHalf;
        springVelocity = vHalf + f * half;
        springForce = f;
        progress = next;
        springTime += SPRING.dt;
      }

      var sample = samplePath(path, progress);
      state.position = sample.point;
      state.heading = sample.tangent;
      advanceDynamics(sample.point.x, sample.point.y, now);
      render();

      if (normalized >= 1 || progress >= 0.985) {
        state.position = end;
        state.heading = samplePath(path, 1).tangent;
        state.moveToken = null;
        advanceDynamics(end.x, end.y, now);
        render();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  win[OPTIONS.clickGlobal] = function(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ensureCursor();
    var bloom = document.createElement('div');
    bloom.className = OPTIONS.bloomClassName;
    bloom.style.left = x + 'px';
    bloom.style.top = y + 'px';
    state.layer.appendChild(bloom);
    setTimeout(function() { if (bloom.parentNode) bloom.remove(); }, 700);

    var token = {};
    state.clickToken = token;
    var start = performance.now();
    function pulse(now) {
      if (state.clickToken !== token) return;
      var t = clamp((now - start) / 170, 0, 1);
      state.clickProgress = Math.sin(t * Math.PI);
      render();
      if (t < 1) {
        requestAnimationFrame(pulse);
      } else {
        state.clickProgress = 0;
        render();
      }
    }
    requestAnimationFrame(pulse);
  };

  ensureCursor();
  win[OPTIONS.readyGlobal] = true;
})();
`;
}

export const CURSOR_MOTION_BROWSER_SCRIPT = createCursorMotionBrowserScript();
