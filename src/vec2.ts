// Minimal 2D vector / point helpers. All other modules expect plain {x, y} objects,
// so these helpers never wrap or hide the data — they just return new {x, y}.

import type { Vec2, Bounds } from './types.js';

export const EPS = 1e-9;

export function v(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function normalize(a: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const len = length(a);
  if (len < EPS) return fallback;
  return { x: a.x / len, y: a.y / len };
}

// Rotated 90° CCW. Used as the in-plane normal when curving paths.
export function perpendicular(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Signed angle from `lhs` to `rhs` in radians, in (-π, π].
export function signedAngle(lhs: Vec2, rhs: Vec2): number {
  return Math.atan2(lhs.x * rhs.y - lhs.y * rhs.x, lhs.x * rhs.x + lhs.y * rhs.y);
}

// Treat `bounds` as { minX, minY, maxX, maxY }.
export function pointInBounds(p: Vec2, bounds: Bounds | null, padding: number = 0): boolean {
  if (!bounds) return true;
  return (
    p.x >= bounds.minX - padding &&
    p.x <= bounds.maxX + padding &&
    p.y >= bounds.minY - padding &&
    p.y <= bounds.maxY + padding
  );
}
