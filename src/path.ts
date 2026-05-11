// Path geometry: multi-segment cubic Bezier path matching the
// CursorMotionPath / Segment layout reverse-engineered from
// SkyComputerUseService (see software-cursor-motion-model.md).
//
// A path holds N cubic segments. sample(progress) maps progress ∈ [0,1]
// to one of the N segments and a local t, then evaluates the standard
// cubic Bezier formula. measure(...) walks 24 fixed steps per segment
// to compute length / angleChangeEnergy / maxAngleChange / totalTurn /
// staysInBounds — used by the candidate scorer.

import type { Vec2, Bounds, Segment, Path, PathSample, PathMeasurement } from './types.js';
import { add, sub, scale, length, normalize, pointInBounds, clamp } from './vec2.js';

export function makeSegment(end: Vec2, control1: Vec2, control2: Vec2): Segment {
  return { end, control1, control2 };
}

export interface MakePathOptions {
  start: Vec2;
  end: Vec2;
  startControl?: Vec2 | null;
  arc?: Vec2 | null;
  arcIn?: Vec2 | null;
  arcOut?: Vec2 | null;
  endControl?: Vec2 | null;
  segments: Segment[];
}

export function makePath(opts: MakePathOptions): Path {
  return {
    start: opts.start,
    end: opts.end,
    startControl: opts.startControl ?? null,
    arc: opts.arc ?? null,
    arcIn: opts.arcIn ?? null,
    arcOut: opts.arcOut ?? null,
    endControl: opts.endControl ?? null,
    segments: opts.segments,
  };
}

// Standard cubic Bezier point.
export function sampleCubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const omt = 1 - t;
  const omt2 = omt * omt;
  const t2 = t * t;
  const a = omt2 * omt;
  const b = 3 * omt2 * t;
  const c = 3 * omt * t2;
  const d = t2 * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

// Cubic Bezier first derivative (un-normalized tangent).
export function sampleCubicTangent(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const omt = 1 - t;
  return {
    x: 3 * omt * omt * (c1.x - p0.x) + 6 * omt * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x),
    y: 3 * omt * omt * (c1.y - p0.y) + 6 * omt * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y),
  };
}

// progress ∈ [0,1] across the whole path → (point, normalized tangent).
export function samplePath(path: Path, progress: number): PathSample {
  const segs = path.segments;
  if (!segs || segs.length === 0) {
    return { point: path.start, tangent: { x: 1, y: 0 } };
  }

  const clamped = clamp(progress, 0, 1);
  const segCount = segs.length;
  let segIndex: number;
  let localT: number;
  if (clamped >= 1) {
    segIndex = segCount - 1;
    localT = 1;
  } else {
    const scaled = clamped * segCount;
    segIndex = Math.min(Math.floor(scaled), segCount - 1);
    localT = scaled - segIndex;
  }

  const seg = segs[segIndex];
  const segStart = segIndex === 0 ? path.start : segs[segIndex - 1].end;
  const point = sampleCubic(segStart, seg.control1, seg.control2, seg.end, localT);
  const rawTangent = sampleCubicTangent(segStart, seg.control1, seg.control2, seg.end, localT);
  return { point, tangent: normalize(rawTangent, { x: 1, y: 0 }) };
}

// Convenience: just the point.
export function pointAt(path: Path, progress: number): Vec2 {
  return samplePath(path, progress).point;
}

// Measure path geometry. Mirrors CursorMotionPath.measure (24 samples/segment,
// minStepDistance 0.01, padding 20pt for bounds check).
export function measurePath(
  path: Path,
  bounds: Bounds | null = null,
  samplesPerSegment: number = 24,
  minStepDistance: number = 0.01,
): PathMeasurement {
  let totalLength = 0;
  let angleChangeEnergy = 0;
  let maxAngleChange = 0;
  let totalTurn = 0;
  let staysInBounds = bounds ? pointInBounds(path.start, bounds, 20) : true;
  let prev = path.start;
  let prevAngle: number | null = null;

  const totalSteps = Math.max(path.segments.length * Math.max(samplesPerSegment, 1), 1);
  for (let step = 1; step <= totalSteps; step += 1) {
    const progress = step / totalSteps;
    const { point } = samplePath(path, progress);
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;
    const stepLen = Math.hypot(dx, dy);

    if (bounds && staysInBounds) {
      staysInBounds = pointInBounds(point, bounds, 20);
    }

    if (stepLen > minStepDistance) {
      const angle = Math.atan2(dy, dx);
      totalLength += stepLen;
      if (prevAngle !== null) {
        let delta = angle - prevAngle;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        angleChangeEnergy += delta * delta;
        const abs = Math.abs(delta);
        if (abs > maxAngleChange) maxAngleChange = abs;
        totalTurn += abs;
      }
      prevAngle = angle;
      prev = point;
    }
  }

  return { length: totalLength, angleChangeEnergy, maxAngleChange, totalTurn, staysInBounds };
}

// Sample N evenly spaced points along the whole path.
export function samplePoints(path: Path, count: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const progress = count <= 1 ? 0 : i / (count - 1);
    out.push(samplePath(path, progress).point);
  }
  return out;
}

// Re-export vec2 helpers for convenience.
export { add, sub, scale, length, normalize };
