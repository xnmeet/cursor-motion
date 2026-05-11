import type { Vec2, Bounds, PathParams, Candidate } from './types.js';
export interface MakeCandidatesInput {
    start: Vec2;
    end: Vec2;
    bounds?: Bounds | null;
    startForward?: Vec2;
    endForward?: Vec2;
    params?: PathParams;
}
export declare function makeCandidates({ start, end, bounds, startForward, endForward, params, }: MakeCandidatesInput): Candidate[];
export declare function chooseCandidate(candidates: Candidate[]): Candidate | null;
export declare const DEFAULT_PARAMS: Required<PathParams>;
//# sourceMappingURL=candidates.d.ts.map