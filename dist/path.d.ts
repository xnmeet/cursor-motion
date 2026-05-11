import type { Vec2, Bounds, Segment, Path, PathSample, PathMeasurement } from './types.js';
import { add, sub, scale, length, normalize } from './vec2.js';
export declare function makeSegment(end: Vec2, control1: Vec2, control2: Vec2): Segment;
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
export declare function makePath(opts: MakePathOptions): Path;
export declare function sampleCubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2;
export declare function sampleCubicTangent(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2;
export declare function samplePath(path: Path, progress: number): PathSample;
export declare function pointAt(path: Path, progress: number): Vec2;
export declare function measurePath(path: Path, bounds?: Bounds | null, samplesPerSegment?: number, minStepDistance?: number): PathMeasurement;
export declare function samplePoints(path: Path, count: number): Vec2[];
export { add, sub, scale, length, normalize };
//# sourceMappingURL=path.d.ts.map