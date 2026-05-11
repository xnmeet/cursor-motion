// Public entry point. Re-exports the most common APIs.

export type {
  Vec2,
  Bounds,
  SpringConfig,
  SpringState,
  Segment,
  Path,
  PathSample,
  PathMeasurement,
  CandidateDescriptor,
  Candidate,
  PathParams,
  VisualState,
  EnginePhase,
  EngineOptions,
  ClickOptions,
  MoveCursorOptions,
  VisualSpringConfig,
  DynamicsRenderState,
  DomRendererOptions,
} from './types.js';

export {
  CursorMotionEngine,
  moveCursor,
  OFFICIAL_SPRING,
  buildSpringConfig,
} from './engine.js';

export { DomCursorRenderer } from './renderer-dom.js';

export {
  makeCandidates,
  chooseCandidate,
  DEFAULT_PARAMS,
} from './candidates.js';

export {
  makePath,
  makeSegment,
  samplePath,
  pointAt,
  measurePath,
  samplePoints,
  sampleCubic,
  sampleCubicTangent,
} from './path.js';

export {
  makeSpringState,
  advanceStep,
  advanceTo,
  isCloseEnough,
  computeCloseEnoughTime,
  DEFAULT_CLOSE_ENOUGH_TIME,
} from './spring.js';

export * as vec2 from './vec2.js';
