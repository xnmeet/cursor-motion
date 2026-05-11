/** A plain 2D point / vector. */
export interface Vec2 {
    x: number;
    y: number;
}
/** Axis-aligned bounding rectangle. */
export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
/** Spring configuration (Velocity-Verlet). */
export interface SpringConfig {
    response: number;
    dampingFraction: number;
    stiffness: number;
    drag: number;
    dt: number;
    closeEnoughProgressThreshold: number;
    closeEnoughDistanceThreshold: number;
    idleVelocityThreshold: number;
}
/** Mutable state of a 1D spring simulation. */
export interface SpringState {
    time: number;
    velocity: number;
    force: number;
}
/** A single cubic Bezier segment. */
export interface Segment {
    end: Vec2;
    control1: Vec2;
    control2: Vec2;
}
/** A multi-segment cubic Bezier path. */
export interface Path {
    start: Vec2;
    end: Vec2;
    startControl: Vec2 | null;
    arc: Vec2 | null;
    arcIn: Vec2 | null;
    arcOut: Vec2 | null;
    endControl: Vec2 | null;
    segments: Segment[];
}
/** Result of sampling a path at a given progress. */
export interface PathSample {
    point: Vec2;
    tangent: Vec2;
}
/** Geometric measurements of a path. */
export interface PathMeasurement {
    length: number;
    angleChangeEnergy: number;
    maxAngleChange: number;
    totalTurn: number;
    staysInBounds: boolean;
}
/** Descriptor for one candidate path family. */
export interface CandidateDescriptor {
    id: string;
    family: string;
    kind: string;
    side: number;
    arcScale: number;
    startReachScale: number;
    endReachScale: number;
    startNormalScale: number;
    endNormalScale: number;
    startLineWeight: number;
    startHeadingWeight: number;
    startGuideNormalBias: number;
    endLineWeight: number;
    endHeadingWeight: number;
    endGuideNormalBias: number;
    flowShift: number;
    startFlowWeight: number;
    endFlowWeight: number;
    scoreBias: number;
}
/** A scored candidate path. */
export interface Candidate {
    id: string;
    kind: string;
    side: number;
    descriptor: CandidateDescriptor;
    path: Path;
    measurement: PathMeasurement;
    score: number;
}
/** Path builder parameters (user-tunable knobs). */
export interface PathParams {
    startHandle?: number;
    endHandle?: number;
    arcSize?: number;
    arcFlow?: number;
}
/** Per-frame visual state emitted by the engine. */
export interface VisualState {
    phase: EnginePhase;
    sample: Vec2;
    tip: Vec2;
    angle: number;
    heading: Vec2;
    velocity: Vec2;
    bodyOffset: Vec2;
    fogOffset: Vec2;
    fogOpacity: number;
    fogScale: number;
    clickProgress: number;
    candidate: Candidate | null;
    candidates: Candidate[] | null;
}
/** Engine lifecycle phases. */
export type EnginePhase = 'idle' | 'moving' | 'clicking';
/** Options for constructing a CursorMotionEngine. */
export interface EngineOptions {
    initial?: Vec2;
    bounds?: Bounds | null;
    spring?: SpringConfig;
    params?: PathParams;
    onUpdate?: (state: VisualState) => void;
    onStateChange?: (phase: EnginePhase) => void;
    duration?: number | null;
    idle?: boolean;
}
/** Options for a click action. */
export interface ClickOptions {
    count?: number;
    holdMs?: number;
    gapMs?: number;
}
/** Options for moveCursor convenience function. */
export interface MoveCursorOptions {
    from: Vec2;
    to: Vec2;
    bounds?: Bounds | null;
    params?: PathParams;
    spring?: SpringConfig;
    onUpdate?: (state: VisualState) => void;
}
/** Internal visual spring config (tipSpring / angleSpring). */
export interface VisualSpringConfig {
    stiffness: number;
    drag: number;
    dt: number;
}
/** Render state from VisualDynamics. */
export interface DynamicsRenderState {
    tip: Vec2;
    angle: number;
    velocity: Vec2;
    angleVelocity: number;
    bodyOffset: Vec2;
    fogOffset: Vec2;
    fogOpacity: number;
    fogScale: number;
}
/** Options for the DOM renderer. */
export interface DomRendererOptions {
    container?: HTMLElement;
    zIndex?: number;
    showTrail?: boolean;
    showCandidates?: boolean;
    glyphHTML?: string;
    size?: number;
}
//# sourceMappingURL=types.d.ts.map