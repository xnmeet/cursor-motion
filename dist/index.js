// Public entry point. Re-exports the most common APIs.
export { CursorMotionEngine, moveCursor, OFFICIAL_SPRING, buildSpringConfig, } from './engine.js';
export { DomCursorRenderer } from './renderer-dom.js';
export { makeCandidates, chooseCandidate, DEFAULT_PARAMS, } from './candidates.js';
export { makePath, makeSegment, samplePath, pointAt, measurePath, samplePoints, sampleCubic, sampleCubicTangent, } from './path.js';
export { makeSpringState, advanceStep, advanceTo, isCloseEnough, computeCloseEnoughTime, DEFAULT_CLOSE_ENOUGH_TIME, } from './spring.js';
export * as vec2 from './vec2.js';
//# sourceMappingURL=index.js.map