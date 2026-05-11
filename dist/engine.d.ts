import type { Vec2, Bounds, SpringConfig, PathParams, VisualState, EnginePhase, EngineOptions, ClickOptions, MoveCursorOptions } from './types.js';
import { OFFICIAL_SPRING, buildSpringConfig } from './spring.js';
export declare class CursorMotionEngine {
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
    private dynamics;
    private _rafId;
    private _lastStepTime;
    private _currentMove;
    private _idleStartedAt;
    private _settleStartTime;
    constructor({ initial, bounds, spring, params, onUpdate, onStateChange, duration, idle, }?: EngineOptions);
    setBounds(bounds: Bounds | null): void;
    setParams(partial: PathParams): void;
    setSpring(config: SpringConfig): void;
    setDuration(seconds: number): void;
    getState(): {
        phase: EnginePhase;
        position: Vec2;
        tip: Vec2;
        angle: number;
        heading: Vec2;
        clickProgress: number;
    };
    moveTo(target: Vec2): Promise<void>;
    click({ count, holdMs, gapMs }?: ClickOptions): Promise<void>;
    stop({ snapToTarget }?: {
        snapToTarget?: boolean | undefined;
    }): void;
    destroy(): void;
    private _setPhase;
    private _ensureLoop;
    private _step;
    private _emitFrame;
    private _emit;
    private _startIdle;
    private _stopIdle;
}
export declare function moveCursor({ from, to, bounds, params, spring, onUpdate }: MoveCursorOptions): Promise<void>;
export { OFFICIAL_SPRING, buildSpringConfig };
//# sourceMappingURL=engine.d.ts.map