import type { Vec2, Bounds } from './types.js';
export declare const EPS = 1e-9;
export declare function v(x: number, y: number): Vec2;
export declare function add(a: Vec2, b: Vec2): Vec2;
export declare function sub(a: Vec2, b: Vec2): Vec2;
export declare function scale(a: Vec2, s: number): Vec2;
export declare function length(a: Vec2): number;
export declare function normalize(a: Vec2, fallback?: Vec2): Vec2;
export declare function perpendicular(a: Vec2): Vec2;
export declare function clamp(value: number, min: number, max: number): number;
export declare function signedAngle(lhs: Vec2, rhs: Vec2): number;
export declare function pointInBounds(p: Vec2, bounds: Bounds | null, padding?: number): boolean;
//# sourceMappingURL=vec2.d.ts.map