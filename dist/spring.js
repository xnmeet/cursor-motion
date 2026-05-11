// Spring progress + Velocity-Verlet simulation.
//
// This is a direct port of CursorMotionProgressAnimator from
// open-codex-computer-use, which is itself a binary-confirmed transcription
// of the official cursor path animation:
//   - SpringParameters(response = 1.4, dampingFraction = 0.9)
//   - VelocityVerletSimulation.Configuration(dt = 1/240, idleVelocityThreshold = 28800)
//   - CloseEnoughConfiguration(progressThreshold = 1.0, distanceThreshold = 0.01)
//
// The default close-enough wall-clock time empirically settles to
// ≈ 343 / 240 ≈ 1.4292s. We expose that as DEFAULT_CLOSE_ENOUGH_TIME so
// callers can use the same timeline regardless of distance.
const TWO_PI = Math.PI * 2;
export const OFFICIAL_SPRING = (() => {
    const response = 1.4;
    const dampingFraction = 0.9;
    const dt = 1 / 240;
    const idleVelocityThreshold = 28800;
    const rawStiffness = response > 0 ? Math.pow(TWO_PI / response, 2) : Infinity;
    const stiffness = Math.min(rawStiffness, idleVelocityThreshold);
    const drag = 2 * dampingFraction * Math.sqrt(stiffness);
    return Object.freeze({
        response,
        dampingFraction,
        stiffness,
        drag,
        dt,
        closeEnoughProgressThreshold: 1,
        closeEnoughDistanceThreshold: 0.01,
        idleVelocityThreshold,
    });
})();
/** Build a custom spring config from response + dampingFraction. */
export function buildSpringConfig({ response = 1.4, dampingFraction = 0.9, dt = 1 / 240, idleVelocityThreshold = 28800, closeEnoughProgressThreshold = 1, closeEnoughDistanceThreshold = 0.01, } = {}) {
    const rawStiffness = response > 0 ? Math.pow(TWO_PI / response, 2) : Infinity;
    const stiffness = Math.min(rawStiffness, idleVelocityThreshold);
    const drag = 2 * dampingFraction * Math.sqrt(stiffness);
    return {
        response,
        dampingFraction,
        stiffness,
        drag,
        dt,
        closeEnoughProgressThreshold,
        closeEnoughDistanceThreshold,
        idleVelocityThreshold,
    };
}
export function makeSpringState() {
    return { time: 0, velocity: 0, force: 0 };
}
// One Velocity-Verlet step. Order is taken verbatim from the disassembly:
//   velocityHalf = velocity + force * dt/2
//   current      = current + velocityHalf * dt
//   force        = stiffness*(target-current) + (-drag)*velocityHalf
//   velocity     = velocityHalf + force * dt/2
export function advanceStep(current, target, state, config = OFFICIAL_SPRING) {
    const halfDt = config.dt * 0.5;
    const velocityHalf = state.velocity + state.force * halfDt;
    const nextCurrent = current + velocityHalf * config.dt;
    const force = config.stiffness * (target - nextCurrent) + -config.drag * velocityHalf;
    const velocity = velocityHalf + force * halfDt;
    return [
        nextCurrent,
        { time: state.time + config.dt, velocity, force },
    ];
}
// Advance the simulation up to `targetTime`. Mirrors the runtime stale-time
// clamp: if the gap is more than 1s (e.g. tab returning from the background),
// we collapse to the last 1/60s rather than catching up frame-by-frame.
export function advanceTo(current, target, state, targetTime, config = OFFICIAL_SPRING) {
    let cur = current;
    let s = state;
    const gap = targetTime - s.time;
    if (gap > 1) {
        s = { ...s, time: targetTime - 1 / 60 };
    }
    let safety = 0;
    const maxIters = Math.max(8192, Math.ceil(gap / config.dt) + 64);
    while (s.time < targetTime && safety < maxIters) {
        [cur, s] = advanceStep(cur, target, s, config);
        safety += 1;
    }
    return [cur, s];
}
export function isCloseEnough(progress, target = 1, config = OFFICIAL_SPRING) {
    return (progress >= config.closeEnoughProgressThreshold &&
        Math.abs(target - progress) <= config.closeEnoughDistanceThreshold);
}
// Find the first simulation time at which the spring is "close enough"
// to its target. With OFFICIAL_SPRING this returns ≈ 1.4291667s.
export function computeCloseEnoughTime(config = OFFICIAL_SPRING) {
    let current = 0;
    let state = makeSpringState();
    for (let step = 1; step < 4096; step += 1) {
        const targetTime = step * config.dt;
        [current, state] = advanceTo(current, 1, state, targetTime, config);
        if (isCloseEnough(current, 1, config)) {
            return state.time;
        }
    }
    return 1.43;
}
export const DEFAULT_CLOSE_ENOUGH_TIME = computeCloseEnoughTime(OFFICIAL_SPRING);
//# sourceMappingURL=spring.js.map