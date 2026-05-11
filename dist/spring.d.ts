import type { SpringConfig, SpringState } from './types.js';
export declare const OFFICIAL_SPRING: SpringConfig;
/** Build a custom spring config from response + dampingFraction. */
export declare function buildSpringConfig({ response, dampingFraction, dt, idleVelocityThreshold, closeEnoughProgressThreshold, closeEnoughDistanceThreshold, }?: Partial<SpringConfig>): SpringConfig;
export declare function makeSpringState(): SpringState;
export declare function advanceStep(current: number, target: number, state: SpringState, config?: SpringConfig): [number, SpringState];
export declare function advanceTo(current: number, target: number, state: SpringState, targetTime: number, config?: SpringConfig): [number, SpringState];
export declare function isCloseEnough(progress: number, target?: number, config?: SpringConfig): boolean;
export declare function computeCloseEnoughTime(config?: SpringConfig): number;
export declare const DEFAULT_CLOSE_ENOUGH_TIME: number;
//# sourceMappingURL=spring.d.ts.map