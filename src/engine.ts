// CursorMotionEngine — the public facade that ties everything together.
//
// Usage:
//   const engine = new CursorMotionEngine({ onUpdate: (state) => { ... } });
//   await engine.moveTo({ x: 600, y: 320 });
//   engine.click();
//
// The engine is rendering-agnostic: it only emits per-frame state via the
// `onUpdate` callback. A DOM-based renderer lives in renderer-dom.ts.

import type {
  Vec2,
  Bounds,
  Path,
  SpringConfig,
  SpringState,
  PathParams,
  Candidate,
  VisualState,
  EnginePhase,
  EngineOptions,
  ClickOptions,
  MoveCursorOptions,
  VisualSpringConfig,
  DynamicsRenderState,
} from './types.js';
import { makeCandidates, chooseCandidate, DEFAULT_PARAMS } from './candidates.js';
import { samplePath } from './path.js';
import {
  OFFICIAL_SPRING,
  buildSpringConfig,
  makeSpringState,
  advanceToMut,
  isCloseEnough,
  computeCloseEnoughTime,
} from './spring.js';

// Visual dynamics constants from reverse engineering.
function makeVisualSpring(response: number, dampingFraction: number, dt: number = 1 / 240): VisualSpringConfig {
  const rawStiffness = response > 0 ? Math.pow(2 * Math.PI / response, 2) : Infinity;
  const stiffness = Math.min(rawStiffness, 28800);
  const drag = 2 * dampingFraction * Math.sqrt(stiffness);
  return { stiffness, drag, dt };
}

const TIP_SPRING = makeVisualSpring(0.18, 0.76);
const ANGLE_SPRING = makeVisualSpring(0.24, 0.82);
const BASE_HEADING = -(3 * Math.PI / 4); // -135°
const HEADING_VELOCITY_FLOOR = 14;
const HEADING_VELOCITY_FLOOR_SQ = HEADING_VELOCITY_FLOOR * HEADING_VELOCITY_FLOOR;
const WOBBLE_AMPLITUDE = Math.PI / 12;
const BODY_OFFSET_SCALE = 0.0012;
const BODY_OFFSET_MAX = 2.4;
const BODY_LATERAL_SCALE = 0.06;
const BODY_LATERAL_MAX = 1.4;
const FOG_OFFSET_SCALE = 0.0045;
const FOG_OFFSET_MAX = 9;
const FOG_OPACITY_BASE = 0.12;
const FOG_OPACITY_VEL_SCALE = 0.00006;
const FOG_SCALE_VEL_SCALE = 0.00012;
const FOG_SCALE_MAX_DELTA = 0.22;

// Branchless normalizeAngle via modulo — avoids while loops.
const TWO_PI = 2 * Math.PI;
function normalizeAngle(a: number): number {
  // Map to (-PI, PI] without loops
  const v = a % TWO_PI;
  if (v > Math.PI) return v - TWO_PI;
  if (v <= -Math.PI) return v + TWO_PI;
  return v;
}

// ---------- VisualDynamics (zero-allocation hot path) ----------

// Pre-allocated reusable output object to avoid per-frame GC pressure.
const _renderOut: DynamicsRenderState = {
  tip: { x: 0, y: 0 },
  angle: 0,
  velocity: { x: 0, y: 0 },
  angleVelocity: 0,
  bodyOffset: { x: 0, y: 0 },
  fogOffset: { x: 0, y: 0 },
  fogOpacity: 0,
  fogScale: 1,
};

class VisualDynamics {
  // All state stored as flat scalars — no object allocation in hot path.
  tipX: number = 0;
  tipY: number = 0;
  tipVX: number = 0;
  tipVY: number = 0;
  tipFX: number = 0;
  tipFY: number = 0;
  angle: number = 0;
  angleVelocity: number = 0;
  angleForce: number = 0;
  time: number = 0;
  initialized: boolean = false;

  reset(px: number, py: number): void {
    this.tipX = px;
    this.tipY = py;
    this.tipVX = 0;
    this.tipVY = 0;
    this.tipFX = 0;
    this.tipFY = 0;
    this.angle = 0;
    this.angleVelocity = 0;
    this.angleForce = 0;
    this.time = 0;
    this.initialized = true;
  }

  advance(targetX: number, targetY: number, targetTime: number, idleAngleOffset: number): DynamicsRenderState {
    if (!this.initialized) {
      this.tipX = targetX;
      this.tipY = targetY;
      this.time = targetTime;
      this.initialized = true;
      return this._renderState(idleAngleOffset);
    }

    // Stale-time clamp
    if ((targetTime - this.time) > 1) {
      this.time = targetTime - 1 / 60;
    }

    // Inline Velocity-Verlet loop — the hottest path in the entire library.
    const tipStiff = TIP_SPRING.stiffness;
    const tipDrag = -TIP_SPRING.drag;
    const angStiff = ANGLE_SPRING.stiffness;
    const angDrag = -ANGLE_SPRING.drag;
    const dt = TIP_SPRING.dt;
    const halfDT = dt * 0.5;

    while (this.time < targetTime) {
      // --- Tip position (2D) ---
      const tvHalfX = this.tipVX + this.tipFX * halfDT;
      const tvHalfY = this.tipVY + this.tipFY * halfDT;
      const nextTipX = this.tipX + tvHalfX * dt;
      const nextTipY = this.tipY + tvHalfY * dt;
      const tipFX = (targetX - nextTipX) * tipStiff + tipDrag * tvHalfX;
      const tipFY = (targetY - nextTipY) * tipStiff + tipDrag * tvHalfY;
      this.tipVX = tvHalfX + tipFX * halfDT;
      this.tipVY = tvHalfY + tipFY * halfDT;
      this.tipFX = tipFX;
      this.tipFY = tipFY;
      this.tipX = nextTipX;
      this.tipY = nextTipY;

      // --- Angle (1D) ---
      // Use squared comparison to avoid sqrt/hypot in the hot loop
      const speedSq = this.tipVX * this.tipVX + this.tipVY * this.tipVY;
      const targetAngle = speedSq > HEADING_VELOCITY_FLOOR_SQ
        ? normalizeAngle(Math.atan2(this.tipVY, this.tipVX) - BASE_HEADING)
        : 0;

      const avHalf = this.angleVelocity + this.angleForce * halfDT;
      const nextAngle = normalizeAngle(this.angle + avHalf * dt);
      const angleError = normalizeAngle(targetAngle - nextAngle);
      const angF = angleError * angStiff + angDrag * avHalf;
      this.angleVelocity = avHalf + angF * halfDT;
      this.angleForce = angF;
      this.angle = normalizeAngle(nextAngle);

      this.time += dt;
    }

    return this._renderState(idleAngleOffset);
  }

  private _renderState(idleAngleOffset: number): DynamicsRenderState {
    const vx = this.tipVX;
    const vy = this.tipVY;
    // Use squared speed for comparisons, only sqrt when needed for output
    const speedSq = vx * vx + vy * vy;
    const clampedIdle = idleAngleOffset > 0.28 ? 0.28 : (idleAngleOffset < -0.28 ? -0.28 : idleAngleOffset);
    const rotation = normalizeAngle(this.angle + clampedIdle);

    let dirX: number, dirY: number;
    let speed: number;
    if (speedSq > 0.000001) {
      speed = Math.sqrt(speedSq);
      const invSpeed = 1 / speed;
      dirX = vx * invSpeed;
      dirY = vy * invSpeed;
    } else {
      speed = 0;
      const fallbackAngle = BASE_HEADING + idleAngleOffset;
      dirX = Math.cos(fallbackAngle);
      dirY = Math.sin(fallbackAngle);
    }

    const bodyMag = -(speed * BODY_OFFSET_SCALE > BODY_OFFSET_MAX ? BODY_OFFSET_MAX : speed * BODY_OFFSET_SCALE);
    const bodyBackX = dirX * bodyMag;
    const bodyBackY = dirY * bodyMag;

    const rawLateral = this.angleVelocity * BODY_LATERAL_SCALE;
    const lateralAmount = rawLateral > BODY_LATERAL_MAX ? BODY_LATERAL_MAX
      : (rawLateral < -BODY_LATERAL_MAX ? -BODY_LATERAL_MAX : rawLateral);
    const lateralX = -dirY * lateralAmount;
    const lateralY = dirX * lateralAmount;

    const fogMag = -(speed * FOG_OFFSET_SCALE > FOG_OFFSET_MAX ? FOG_OFFSET_MAX : speed * FOG_OFFSET_SCALE);

    // Write into pre-allocated output object — zero allocation
    const out = _renderOut;
    out.tip.x = this.tipX;
    out.tip.y = this.tipY;
    out.angle = rotation;
    out.velocity.x = vx;
    out.velocity.y = vy;
    out.angleVelocity = this.angleVelocity;
    out.bodyOffset.x = bodyBackX + lateralX;
    out.bodyOffset.y = bodyBackY + lateralY;
    out.fogOffset.x = dirX * fogMag + lateralX * 0.6;
    out.fogOffset.y = dirY * fogMag + lateralY * 0.6;
    out.fogOpacity = FOG_OPACITY_BASE + speed * FOG_OPACITY_VEL_SCALE > 0.34 ? 0.34 : FOG_OPACITY_BASE + speed * FOG_OPACITY_VEL_SCALE;
    out.fogScale = 1 + (speed * FOG_SCALE_VEL_SCALE > FOG_SCALE_MAX_DELTA ? FOG_SCALE_MAX_DELTA : speed * FOG_SCALE_VEL_SCALE);
    return out;
  }
}

// ---------- CursorMotionEngine ----------

const noop = () => {};

interface MoveState {
  resolve: ((value?: unknown) => void) | null;
  reject: ((reason?: unknown) => void) | null;
  cancelled: boolean;
  startTime: number | null;
  path: Path;
  candidate: Candidate;
  candidates: Candidate[];
  progress: number;
  springVelocity: number;
  springForce: number;
  springTime: number;
  target: Vec2;
}

// Pre-allocated VisualState object — reused every frame to avoid GC.
const _frameState: VisualState = {
  phase: 'idle',
  sample: { x: 0, y: 0 },
  tip: { x: 0, y: 0 },
  angle: 0,
  heading: { x: 1, y: 0 },
  velocity: { x: 0, y: 0 },
  bodyOffset: { x: 0, y: 0 },
  fogOffset: { x: 0, y: 0 },
  fogOpacity: 0,
  fogScale: 1,
  clickProgress: 0,
  candidate: null,
  candidates: null,
};

export class CursorMotionEngine {
  bounds: Bounds | null;
  spring: SpringConfig;
  params: Required<PathParams>;
  onUpdate: (state: VisualState) => void;
  onStateChange: (phase: EnginePhase) => void;
  duration: number;
  idleEnabled: boolean;

  position: Vec2;
  target: Vec2;
  heading: Vec2;
  restingHeading: Vec2;
  phase: EnginePhase;
  idlePhase: number;
  clickProgress: number;

  private dynamics: VisualDynamics;
  private _rafId: number | null = null;
  private _lastStepTime: number | null = null;
  private _currentMove: MoveState | null = null;
  private _idleStartedAt: number | null = null;
  private _settleStartTime: number | null = null;

  constructor({
    initial = { x: 0, y: 0 },
    bounds = null,
    spring = OFFICIAL_SPRING,
    params = {},
    onUpdate = noop,
    onStateChange = noop,
    duration = null,
    idle = true,
  }: EngineOptions = {}) {
    this.bounds = bounds;
    this.spring = spring;
    this.params = { ...DEFAULT_PARAMS, ...params } as Required<PathParams>;
    this.onUpdate = onUpdate;
    this.onStateChange = onStateChange;
    this.duration = duration ?? computeCloseEnoughTime(spring);
    this.idleEnabled = idle;

    this.position = { x: initial.x, y: initial.y };
    this.target = { x: initial.x, y: initial.y };
    this.heading = { x: 1, y: 0 };
    this.restingHeading = { x: 1, y: 0 };
    this.phase = 'idle';
    this.idlePhase = 0;
    this.clickProgress = 0;

    this.dynamics = new VisualDynamics();
    this.dynamics.reset(this.position.x, this.position.y);

    this._emit({ kind: 'init' });
    if (this.idleEnabled) this._startIdle();
  }

  // Public knobs ---------------------------------------------------------

  setBounds(bounds: Bounds | null): void { this.bounds = bounds; }
  setParams(partial: PathParams): void { this.params = { ...this.params, ...partial } as Required<PathParams>; }
  setSpring(config: SpringConfig): void {
    this.spring = config;
    this.duration = computeCloseEnoughTime(config);
  }
  setDuration(seconds: number): void { this.duration = seconds; }

  getState() {
    return {
      phase: this.phase,
      position: this.position,
      tip: { x: this.dynamics.tipX, y: this.dynamics.tipY },
      angle: this.dynamics.angle,
      heading: this.heading,
      clickProgress: this.clickProgress,
    };
  }

  moveTo(target: Vec2): Promise<void> {
    if (this._currentMove) {
      this._currentMove.cancelled = true;
      this._currentMove.reject?.(new Error('superseded'));
      this._currentMove = null;
    }

    const start: Vec2 = { x: this.position.x, y: this.position.y };
    const startForward: Vec2 = { x: this.heading.x, y: this.heading.y };
    const endForward: Vec2 = { x: this.restingHeading.x, y: this.restingHeading.y };
    const candidates = makeCandidates({
      start, end: target, bounds: this.bounds,
      startForward, endForward, params: this.params,
    });
    const chosen = chooseCandidate(candidates);
    if (!chosen) {
      this.position.x = target.x;
      this.position.y = target.y;
      this._emit({ kind: 'move-skip' });
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this._setPhase('moving');
      this._stopIdle();
      this._currentMove = {
        resolve: resolve as (value?: unknown) => void,
        reject: reject as (reason?: unknown) => void,
        cancelled: false,
        startTime: null,
        path: chosen.path,
        candidate: chosen,
        candidates,
        progress: 0,
        springVelocity: 0,
        springForce: 0,
        springTime: 0,
        target: { x: target.x, y: target.y },
      };
      this.target.x = target.x;
      this.target.y = target.y;
      this._ensureLoop();
    });
  }

  click({ count = 1, holdMs = 110, gapMs = 50 }: ClickOptions = {}): Promise<void> {
    return new Promise<void>((resolve) => {
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
          this._emitFrame(performance.now() / 1000, 0);
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

  stop({ snapToTarget = false } = {}): void {
    if (this._currentMove) {
      if (snapToTarget) {
        this.position.x = this._currentMove.target.x;
        this.position.y = this._currentMove.target.y;
      }
      this._currentMove.reject?.(new Error('stopped'));
      this._currentMove = null;
    }
    this._setPhase('idle');
    if (this.idleEnabled) this._startIdle();
  }

  destroy(): void {
    this.stop();
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._stopIdle();
  }

  // Internals ------------------------------------------------------------

  private _setPhase(next: EnginePhase): void {
    if (this.phase !== next) {
      this.phase = next;
      this.onStateChange(next);
    }
  }

  private _ensureLoop(): void {
    if (this._rafId != null) return;
    const tick = (nowMs: number) => {
      this._rafId = null;
      this._step(nowMs / 1000);
      if (this._rafId == null) {
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _step(now: number): void {
    const rawDelta = this._lastStepTime != null ? (now - this._lastStepTime) : (1 / 60);
    const clampedDelta = rawDelta < (1 / 240) ? (1 / 240) : (rawDelta > (1 / 24) ? (1 / 24) : rawDelta);
    this._lastStepTime = now;

    if (this._currentMove) {
      const move = this._currentMove;
      if (move.startTime == null) move.startTime = now;
      const elapsed = now - move.startTime;
      const normalized = elapsed <= 0 ? 0 : (elapsed >= this.duration ? 1 : elapsed / this.duration);
      const targetSpringTime = normalized * this.duration;

      // Inline mutable spring advance — zero allocation
      const cfg = this.spring;
      const sDt = cfg.dt;
      const sHalfDt = sDt * 0.5;
      let cur = move.progress;
      let sVel = move.springVelocity;
      let sForce = move.springForce;
      let sTime = move.springTime;

      // Stale-time clamp
      if ((targetSpringTime - sTime) > 1) {
        sTime = targetSpringTime - 1 / 60;
      }
      while (sTime < targetSpringTime) {
        const vHalf = sVel + sForce * sHalfDt;
        const next = cur + vHalf * sDt;
        const f = cfg.stiffness * (1 - next) + (-cfg.drag) * vHalf;
        sVel = vHalf + f * sHalfDt;
        sForce = f;
        cur = next;
        sTime += sDt;
      }
      move.progress = cur;
      move.springVelocity = sVel;
      move.springForce = sForce;
      move.springTime = sTime;

      const sample = samplePath(move.path, cur);
      this.position.x = sample.point.x;
      this.position.y = sample.point.y;
      this.heading.x = sample.tangent.x;
      this.heading.y = sample.tangent.y;

      this._emitFrame(now, 0);

      if (normalized >= 1 || isCloseEnough(cur, 1, this.spring)) {
        this.position.x = move.target.x;
        this.position.y = move.target.y;
        const resolve = move.resolve;
        this._currentMove = null;
        this._setPhase('idle');
        this._settleStartTime = now;
        this._ensureLoop();
        this._emitFrame(now, 0);
        resolve?.();
      }
    } else if (this.phase === 'idle') {
      this.idlePhase += clampedDelta * 3;
      const idleAngleOffset = this.idleEnabled
        ? Math.sin(this.idlePhase * 0.8) * WOBBLE_AMPLITUDE
        : 0;
      this._emitFrame(now, idleAngleOffset);

      // Stop loop once settled
      const vx = this.dynamics.tipVX;
      const vy = this.dynamics.tipVY;
      const tipSpeedSq = vx * vx + vy * vy;
      const settleElapsed = now - (this._settleStartTime ?? now);
      const isSettled = tipSpeedSq < 4 && Math.abs(this.dynamics.angle) < 0.02;
      if (!this.idleEnabled && isSettled && settleElapsed > 0.3) {
        if (this._rafId != null) {
          cancelAnimationFrame(this._rafId);
          this._rafId = null;
        }
      }
    }
  }

  private _emitFrame(now: number, idleAngleOffset: number): void {
    const visual = this.dynamics.advance(this.position.x, this.position.y, now, idleAngleOffset);
    // Write into pre-allocated frame state
    const f = _frameState;
    f.phase = this.phase;
    f.sample.x = this.position.x;
    f.sample.y = this.position.y;
    f.tip.x = visual.tip.x;
    f.tip.y = visual.tip.y;
    f.angle = visual.angle;
    f.heading.x = this.heading.x;
    f.heading.y = this.heading.y;
    f.velocity.x = visual.velocity.x;
    f.velocity.y = visual.velocity.y;
    f.bodyOffset.x = visual.bodyOffset.x;
    f.bodyOffset.y = visual.bodyOffset.y;
    f.fogOffset.x = visual.fogOffset.x;
    f.fogOffset.y = visual.fogOffset.y;
    f.fogOpacity = visual.fogOpacity;
    f.fogScale = visual.fogScale;
    f.clickProgress = this.clickProgress;
    f.candidate = this._currentMove?.candidate ?? null;
    f.candidates = this._currentMove?.candidates ?? null;
    this.onUpdate(f);
  }

  private _emit(_event: { kind: string }): void { /* reserved */ }

  private _startIdle(): void {
    this._idleStartedAt = performance.now();
    this._ensureLoop();
  }

  private _stopIdle(): void {
    this._idleStartedAt = null;
  }
}

// Convenience: run a one-shot move with default settings.
export async function moveCursor({ from, to, bounds, params, spring, onUpdate }: MoveCursorOptions): Promise<void> {
  const engine = new CursorMotionEngine({ initial: from, bounds, params, spring, onUpdate, idle: false });
  try {
    await engine.moveTo(to);
  } finally {
    engine.destroy();
  }
}

export { OFFICIAL_SPRING, buildSpringConfig };
