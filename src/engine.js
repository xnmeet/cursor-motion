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

// Visual dynamics — a proper Velocity-Verlet spring simulation for both
// the tip position (2D) and the angle (1D), matching the reference
// CursorVisualDynamicsAnimator from the official implementation.
//
// Key parameters from reverse engineering:
//   tipSpring:   response=0.18, dampingFraction=0.76
//   angleSpring: response=0.24, dampingFraction=0.82
//   baseHeading: -(3π/4) = -2.356 rad (cursor arrow faces upper-left at rest)
//   headingVelocityFloor: 14 (below this → target angle = 0)
//   wobbleAmplitude: π/12

function makeVisualSpring(response, dampingFraction, dt = 1/240) {
  const rawStiffness = response > 0 ? Math.pow(2 * Math.PI / response, 2) : Infinity;
  const stiffness = Math.min(rawStiffness, 28800);
  const drag = 2 * dampingFraction * Math.sqrt(stiffness);
  return { stiffness, drag, dt };
}

const TIP_SPRING = makeVisualSpring(0.18, 0.76);
const ANGLE_SPRING = makeVisualSpring(0.24, 0.82);
const BASE_HEADING = -(3 * Math.PI / 4); // -135° — standard cursor resting direction
const HEADING_VELOCITY_FLOOR = 14;
const WOBBLE_AMPLITUDE = Math.PI / 12;
const BODY_OFFSET_SCALE = 0.0012;
const BODY_OFFSET_MAX = 2.4;
const FOG_OFFSET_SCALE = 0.0045;
const FOG_OFFSET_MAX = 9;
const FOG_OPACITY_BASE = 0.12;
const FOG_OPACITY_VEL_SCALE = 0.00006;
const FOG_SCALE_VEL_SCALE = 0.00012;
const FOG_SCALE_MAX_DELTA = 0.22;

function normalizeAngle(a) {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

class VisualDynamics {
  constructor() {
    this.tip = null;
    this.tipVelocity = { x: 0, y: 0 };
    this.tipForce = { x: 0, y: 0 };
    this.angle = 0;
    this.angleVelocity = 0;
    this.angleForce = 0;
    this.time = 0;
  }

  reset(point) {
    this.tip = { x: point.x, y: point.y };
    this.tipVelocity = { x: 0, y: 0 };
    this.tipForce = { x: 0, y: 0 };
    this.angle = 0;
    this.angleVelocity = 0;
    this.angleForce = 0;
    this.time = 0;
  }

  advance(target, targetTime, { idleAngleOffset = 0 } = {}) {
    if (!this.tip) {
      this.tip = { x: target.x, y: target.y };
      this.time = targetTime;
      return this._renderState(idleAngleOffset);
    }

    // Stale-time clamp (matching reference implementation)
    if ((targetTime - this.time) > 1) {
      this.time = targetTime - 1 / 60;
    }

    // Step the Velocity-Verlet simulation at dt=1/240
    while (this.time < targetTime) {
      this._step(target, idleAngleOffset);
    }

    return this._renderState(idleAngleOffset);
  }

  _step(targetPos, idleAngleOffset) {
    const dt = TIP_SPRING.dt;
    const halfDT = dt * 0.5;

    // --- Tip position (2D Velocity-Verlet) ---
    const tvHalfX = this.tipVelocity.x + this.tipForce.x * halfDT;
    const tvHalfY = this.tipVelocity.y + this.tipForce.y * halfDT;
    const nextTipX = this.tip.x + tvHalfX * dt;
    const nextTipY = this.tip.y + tvHalfY * dt;
    const dispX = targetPos.x - nextTipX;
    const dispY = targetPos.y - nextTipY;
    const tipForceX = dispX * TIP_SPRING.stiffness + (-TIP_SPRING.drag) * tvHalfX;
    const tipForceY = dispY * TIP_SPRING.stiffness + (-TIP_SPRING.drag) * tvHalfY;
    this.tipVelocity = { x: tvHalfX + tipForceX * halfDT, y: tvHalfY + tipForceY * halfDT };
    this.tipForce = { x: tipForceX, y: tipForceY };
    this.tip = { x: nextTipX, y: nextTipY };

    // --- Angle (1D Velocity-Verlet) ---
    const speed = Math.hypot(this.tipVelocity.x, this.tipVelocity.y);
    let targetAngle;
    if (speed > HEADING_VELOCITY_FLOOR) {
      const heading = Math.atan2(this.tipVelocity.y, this.tipVelocity.x);
      targetAngle = normalizeAngle(heading - BASE_HEADING);
    } else {
      targetAngle = 0;
    }

    const avHalf = this.angleVelocity + this.angleForce * halfDT;
    const nextAngle = normalizeAngle(this.angle + avHalf * dt);
    const angleError = normalizeAngle(targetAngle - nextAngle);
    const angleForce = angleError * ANGLE_SPRING.stiffness + (-ANGLE_SPRING.drag) * avHalf;
    this.angleVelocity = avHalf + angleForce * halfDT;
    this.angleForce = angleForce;
    this.angle = normalizeAngle(nextAngle);

    this.time += dt;
  }

  _renderState(idleAngleOffset) {
    const speed = Math.hypot(this.tipVelocity.x, this.tipVelocity.y);
    const clampedIdle = Math.max(-0.28, Math.min(0.28, idleAngleOffset));
    const rotation = normalizeAngle(this.angle + clampedIdle);

    // Body offset: lag behind velocity direction
    let bodyOffset = { x: 0, y: 0 };
    let fogOffset = { x: 0, y: 0 };
    let fogOpacity = FOG_OPACITY_BASE;
    let fogScale = 1;
    if (speed > 0.001) {
      const dirX = this.tipVelocity.x / speed;
      const dirY = this.tipVelocity.y / speed;
      const bodyMag = -Math.min(speed * BODY_OFFSET_SCALE, BODY_OFFSET_MAX);
      bodyOffset = { x: dirX * bodyMag, y: dirY * bodyMag };
      const fogMag = -Math.min(speed * FOG_OFFSET_SCALE, FOG_OFFSET_MAX);
      fogOffset = { x: dirX * fogMag, y: dirY * fogMag };
      fogOpacity = Math.min(FOG_OPACITY_BASE + speed * FOG_OPACITY_VEL_SCALE, 0.34);
      fogScale = 1 + Math.min(speed * FOG_SCALE_VEL_SCALE, FOG_SCALE_MAX_DELTA);
    }

    return {
      tip: this.tip,
      angle: rotation,
      velocity: this.tipVelocity,
      bodyOffset,
      fogOffset,
      fogOpacity,
      fogScale,
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
      // Reference: idlePhase += clampedDelta * 3; wobble = sin(phase * 0.8) * π/12
      this.idlePhase += (1/60) * 3; // approximate per-frame at 60fps
      const idleAngleOffset = Math.sin(this.idlePhase * 0.8) * WOBBLE_AMPLITUDE;
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
      bodyOffset: visual.bodyOffset,
      fogOffset: visual.fogOffset,
      fogOpacity: visual.fogOpacity,
      fogScale: visual.fogScale,
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
