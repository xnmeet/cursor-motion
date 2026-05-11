// Minimal 2D vector / point helpers. All other modules expect plain {x, y} objects,
// so these helpers never wrap or hide the data — they just return new {x, y}.
export const EPS = 1e-9;
export function v(x, y) {
    return { x, y };
}
export function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
export function scale(a, s) {
    return { x: a.x * s, y: a.y * s };
}
export function length(a) {
    return Math.hypot(a.x, a.y);
}
export function normalize(a, fallback = { x: 1, y: 0 }) {
    const len = length(a);
    if (len < EPS)
        return fallback;
    return { x: a.x / len, y: a.y / len };
}
// Rotated 90° CCW. Used as the in-plane normal when curving paths.
export function perpendicular(a) {
    return { x: -a.y, y: a.x };
}
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
// Signed angle from `lhs` to `rhs` in radians, in (-π, π].
export function signedAngle(lhs, rhs) {
    return Math.atan2(lhs.x * rhs.y - lhs.y * rhs.x, lhs.x * rhs.x + lhs.y * rhs.y);
}
// Treat `bounds` as { minX, minY, maxX, maxY }.
export function pointInBounds(p, bounds, padding = 0) {
    if (!bounds)
        return true;
    return (p.x >= bounds.minX - padding &&
        p.x <= bounds.maxX + padding &&
        p.y >= bounds.minY - padding &&
        p.y <= bounds.maxY + padding);
}
//# sourceMappingURL=vec2.js.map