// CursorMotionEngine — the public façade that ties everything together.
//
// Usage:
//   const engine = new CursorMotionEngine({ onUpdate: (state) => { ... } });
//   await engine.moveTo({ x: 600, y: 320 });
//   engine.click();
//
// The engine is rendering-agnostic: it only emits per-frame state via the
// `onUpdate` callback. A DOM-based renderer lives in renderer-dom.js.

import { makeCandidates, chooseCandidate, DEFAULT_PARAMS } from './candidates.js';
import { samplePath } from './path.js';
import {
  OFFICIAL_SPRING,
  buildSpringConfig,
  makeSpringState,
  advanceTo,
  isCloseEnough,
  computeCloseEnoughTime,
} from './spring.js';

// Visual dynamics: the visible cursor lags slightly behind the path sample
// to give the head a sense of velocity and inertia. This is a minimal port
// of the official FogCursorViewModel/CursorView behavior (rotation +
// soft tip follow + idle wiggle).
class VisualDynamics {
  constructor() {
    this.tip = null;
    this.velocity = { x: 0, y: 0 };
    this.angle = 0;
    this.idlePhase = 0;
    this.lastTime = null;
  }

  reset(point) {
    this.tip = { x: point.x, y: point.y };
    this.velocity = { x: 0, y: 0 };
    this.angle = 0;
    this.idlePhase = 0;
    this.lastTime = null;
  }

  advance(target, time, { idleAngleOffset = 0 } = {}) {
    if (!this.tip) {
      this.tip = { x: target.x, y: target.y };
      this.lastTime = time;
      return { tip: this.tip, angle: this.angle, velocity: this.velocity };
    }
    const dt = this.lastTime == null ? 1 / 60 : Math.max(Math.min(time - this.lastTime, 1 / 30), 1 / 240);
    this.lastTime = time;

    // Critically-damped follow with a fast response time. The official
    // implementation uses a Velocity-Verlet sim per visual axis; for a
    // web port we use a stable exponential approach that looks identical
    // at 60–120 fps.
    const responseTime = 0.06; // seconds
    const k = 1 - Math.exp(-dt / responseTime);
    const nextX = this.tip.x + (target.x - this.tip.x) * k;
    const nextY = this.tip.y + (target.y - this.tip.y) * k;
    this.velocity = { x: (nextX - this.tip.x) / dt, y: (nextY - this.tip.y) / dt };
    this.tip = { x: nextX, y: nextY };

    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > 4) {
      const targetAngle = Math.atan2(this.velocity.y, this.velocity.x);
      const angleK = 1 - Math.exp(-dt / 0.08);
      let delta = targetAngle - this.angle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      this.angle += delta * angleK;
    } else {
      // Settle back toward zero rotation when stopped.
      const angleK = 1 - Math.exp(-dt / 0.16);
      this.angle += (0 - this.angle) * angleK;
    }

    return {
      tip: this.tip,
      angle: this.angle + idleAngleOffset,
      velocity: this.velocity,
    };
  }
}

const noop = () => {};

export class CursorMotionEngine {
  constructor({
    initial = { x: 0, y: 0 },
    bounds = null,
    spring = OFFICIAL_SPRING,
    params = {},
    onUpdate = noop,
    onStateChange = noop,
    duration = null, // null → use computed close-enough time for `spring`
    idle = true,
  } = {}) {
    this.bounds = bounds;
    this.spring = spring;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.onUpdate = onUpdate;
    this.onStateChange = onStateChange;
    this.duration = duration ?? computeCloseEnoughTime(spring);
    this.idleEnabled = idle;

    this.position = { x: initial.x, y: initial.y };
    this.target = { x: initial.x, y: initial.y };
    this.heading = { x: 1, y: 0 };
    this.restingHeading = { x: 1, y: 0 };
    this.phase = 'idle'; // 'idle' | 'moving' | 'clicking'
    this.idlePhase = 0;
    this.clickProgress = 0;

    this.dynamics = new VisualDynamics();
    this.dynamics.reset(this.position);

    this._rafId = null;
    this._currentMove = null; // { resolve, reject, startTime, path, springState, progress, ... }
    this._idleStartedAt = null;

    this._emit({ kind: 'init' });
    if (this.idleEnabled) this._startIdle();
  }

  // Public knobs ---------------------------------------------------------

  setBounds(bounds) { this.bounds = bounds; }
  setParams(partial) { this.params = { ...this.params, ...partial }; }
  setSpring(config) {
    this.spring = config;
    this.duration = computeCloseEnoughTime(config);
  }
  setDuration(seconds) { this.duration = seconds; }

  getState() {
    return {
      phase: this.phase,
      position: this.position,
      tip: this.dynamics.tip ?? this.position,
      angle: this.dynamics.angle,
      heading: this.heading,
      clickProgress: this.clickProgress,
    };
  }

  // Issue a new move. Returns a promise that resolves once the spring
  // is "close enough" to the target (matching the official
  // CursorNextInteractionTiming.closeEnough gate).
  moveTo(target) {
    if (this._currentMove) {
      // Cancel the previous move; the new one starts from the current
      // position and current heading.
      this._currentMove.cancelled = true;
      this._currentMove.reject?.(new Error('superseded'));
      this._currentMove = null;
    }

    const start = { x: this.position.x, y: this.position.y };
    const startForward = { ...this.heading };
    const endForward = { ...this.restingHeading };
    const candidates = makeCandidates({
      start, end: target, bounds: this.bounds,
      startForward, endForward, params: this.params,
    });
    const chosen = chooseCandidate(candidates);
    if (!chosen) {
      this.position = { ...target };
      this._emit({ kind: 'move-skip' });
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this._setPhase('moving');
      this._stopIdle();
      this._currentMove = {
        resolve, reject,
        cancelled: false,
        startTime: null,
        path: chosen.path,
        candidate: chosen,
        candidates,
        progress: 0,
        spring: makeSpringState(),
        target: { ...target },
      };
      this.target = { ...target };
      this._ensureLoop();
    });
  }

  click({ count = 1, holdMs = 110, gapMs = 50 } = {}) {
    return new Promise((resolve) => {
      this._setPhase('clicking');
      this._stopIdle();
      let pulse = 0;
      const total = count;
      const startNext = () => {
        if (pulse >= total) {
          this.clickProgress = 0;
          this._setPhase('idle');
          if (this.idleEnabled) this._startIdle();
          resolve();
          return;
        }
        const start = performance.now();
        const tick = () => {
          const elapsed = performance.now() - start;
          const t = Math.min(elapsed / holdMs, 1);
          this.clickProgress = Math.sin(t * Math.PI);
          this._emitFrame(performance.now() / 1000);
          if (t < 1) {
            requestAnimationFrame(tick);
          } else {
            this.clickProgress = 0;
            pulse += 1;
            if (pulse < total) {
              setTimeout(startNext, gapMs);
            } else {
              startNext();
            }
          }
        };
        requestAnimationFrame(tick);
      };
      startNext();
    });
  }

  // Hard stop. Cancel any in-flight move, snap to target, go idle.
  stop({ snapToTarget = false } = {}) {
    if (this._currentMove) {
      if (snapToTarget) this.position = { ...this._currentMove.target };
      this._currentMove.reject?.(new Error('stopped'));
      this._currentMove = null;
    }
    this._setPhase('idle');
    if (this.idleEnabled) this._startIdle();
  }

  destroy() {
    this.stop();
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._stopIdle();
  }

  // Internals ------------------------------------------------------------

  _setPhase(next) {
    if (this.phase !== next) {
      this.phase = next;
      this.onStateChange(next);
    }
  }

  _ensureLoop() {
    if (this._rafId != null) return;
    const tick = (nowMs) => {
      this._rafId = null;
      this._step(nowMs / 1000);
      if (this._currentMove || this.phase !== 'idle' || this.idleEnabled) {
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _step(now) {
    if (this._currentMove) {
      const move = this._currentMove;
      if (move.startTime == null) move.startTime = now;
      const elapsed = now - move.startTime;
      const normalized = Math.max(0, Math.min(elapsed / this.duration, 1));
      const targetSpringTime = normalized * this.duration;
      const [progress, springState] = advanceTo(move.progress, 1, move.spring, targetSpringTime, this.spring);
      move.progress = progress;
      move.spring = springState;

      const sample = samplePath(move.path, progress);
      this.position = sample.point;
      this.heading = sample.tangent;

      this._emitFrame(now);

      if (normalized >= 1 || isCloseEnough(progress, 1, this.spring)) {
        // Snap to exact target so caller sees a clean end position.
        this.position = { ...move.target };
        const resolve = move.resolve;
        this._currentMove = null;
        this._setPhase('idle');
        if (this.idleEnabled) this._startIdle();
        this._emitFrame(now);
        resolve?.();
      }
    } else if (this.phase === 'idle' && this.idleEnabled) {
      this.idlePhase += 0.05;
      const idleAngleOffset = Math.sin(this.idlePhase * 0.8) * 0.09;
      this._emitFrame(now, { idleAngleOffset });
    }
  }

  _emitFrame(now, { idleAngleOffset = 0 } = {}) {
    const visual = this.dynamics.advance(this.position, now, { idleAngleOffset });
    this.onUpdate({
      phase: this.phase,
      sample: this.position,
      tip: visual.tip,
      angle: visual.angle,
      heading: this.heading,
      velocity: visual.velocity,
      clickProgress: this.clickProgress,
      candidate: this._currentMove?.candidate ?? null,
      candidates: this._currentMove?.candidates ?? null,
    });
  }

  _emit(event) { /* reserved hook for future event stream */ void event; }

  _startIdle() {
    this._idleStartedAt = performance.now();
    this._ensureLoop();
  }

  _stopIdle() {
    this._idleStartedAt = null;
  }
}

// Convenience: run a one-shot move with default settings, no idle wiggle,
// resolving when close-enough is reached. Useful for quick scripts.
export async function moveCursor({ from, to, bounds, params, spring, onUpdate }) {
  const engine = new CursorMotionEngine({ initial: from, bounds, params, spring, onUpdate, idle: false });
  try {
    await engine.moveTo(to);
  } finally {
    engine.destroy();
  }
}

export { OFFICIAL_SPRING, buildSpringConfig };
