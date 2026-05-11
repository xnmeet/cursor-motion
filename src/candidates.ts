// Heading-driven candidate path generator + scorer.
//
// Mirrors HeadingDrivenCursorMotionModel from open-codex-computer-use:
// given start, end, current heading, and resting heading, produce a small
// family of plausible cubic-Bezier candidates (direct / turn / brake /
// orbit), then pick the one with the lowest score.

import type { Vec2, Bounds, Path, PathMeasurement, PathParams, Candidate, CandidateDescriptor } from './types.js';
import { add, sub, scale, normalize, length, perpendicular, signedAngle } from './vec2.js';
import { makePath, makeSegment, measurePath } from './path.js';

const DEFAULT_START_HANDLE = 0.29;
const DEFAULT_END_HANDLE = 0.08;
const DEFAULT_ARC_SIZE = 0.06;
const DEFAULT_ARC_FLOW = 0.64;

// Description of one candidate family.
const DESCRIPTORS: CandidateDescriptor[] = [
  { id: 'direct', family: 'direct', kind: 'base', side: 0,
    arcScale: 0.55, startReachScale: 1.0, endReachScale: 1.0,
    startNormalScale: 0.35, endNormalScale: 0.35,
    startLineWeight: 1.0, startHeadingWeight: 0.45, startGuideNormalBias: 0.0,
    endLineWeight: 1.0, endHeadingWeight: 0.55, endGuideNormalBias: 0.0,
    flowShift: 0, startFlowWeight: 0.7, endFlowWeight: 0.7, scoreBias: 0 },
  { id: 'turn-left', family: 'turn', kind: 'arched', side: -1,
    arcScale: 1.0, startReachScale: 1.05, endReachScale: 0.95,
    startNormalScale: 1.0, endNormalScale: 0.5,
    startLineWeight: 0.55, startHeadingWeight: 0.85, startGuideNormalBias: 0.25,
    endLineWeight: 0.85, endHeadingWeight: 0.55, endGuideNormalBias: 0.05,
    flowShift: -0.05, startFlowWeight: 0.9, endFlowWeight: 0.6, scoreBias: 0 },
  { id: 'turn-right', family: 'turn', kind: 'arched', side: 1,
    arcScale: 1.0, startReachScale: 1.05, endReachScale: 0.95,
    startNormalScale: 1.0, endNormalScale: 0.5,
    startLineWeight: 0.55, startHeadingWeight: 0.85, startGuideNormalBias: 0.25,
    endLineWeight: 0.85, endHeadingWeight: 0.55, endGuideNormalBias: 0.05,
    flowShift: -0.05, startFlowWeight: 0.9, endFlowWeight: 0.6, scoreBias: 0 },
  { id: 'brake-left', family: 'brake', kind: 'arched', side: -1,
    arcScale: 0.9, startReachScale: 0.85, endReachScale: 1.15,
    startNormalScale: 0.4, endNormalScale: 1.0,
    startLineWeight: 0.85, startHeadingWeight: 0.5, startGuideNormalBias: 0.05,
    endLineWeight: 0.55, endHeadingWeight: 0.85, endGuideNormalBias: 0.25,
    flowShift: 0.07, startFlowWeight: 0.6, endFlowWeight: 0.9, scoreBias: 6 },
  { id: 'brake-right', family: 'brake', kind: 'arched', side: 1,
    arcScale: 0.9, startReachScale: 0.85, endReachScale: 1.15,
    startNormalScale: 0.4, endNormalScale: 1.0,
    startLineWeight: 0.55, startHeadingWeight: 0.85, startGuideNormalBias: 0.25,
    endLineWeight: 0.85, endHeadingWeight: 0.5, endGuideNormalBias: 0.05,
    flowShift: 0.07, startFlowWeight: 0.6, endFlowWeight: 0.9, scoreBias: 6 },
  { id: 'orbit-left', family: 'orbit', kind: 'arched', side: -1,
    arcScale: 1.35, startReachScale: 1.15, endReachScale: 1.15,
    startNormalScale: 1.0, endNormalScale: 1.0,
    startLineWeight: 0.5, startHeadingWeight: 0.9, startGuideNormalBias: 0.35,
    endLineWeight: 0.5, endHeadingWeight: 0.9, endGuideNormalBias: 0.35,
    flowShift: 0, startFlowWeight: 0.8, endFlowWeight: 0.8, scoreBias: 12 },
  { id: 'orbit-right', family: 'orbit', kind: 'arched', side: 1,
    arcScale: 1.35, startReachScale: 1.15, endReachScale: 1.15,
    startNormalScale: 1.0, endNormalScale: 1.0,
    startLineWeight: 0.5, startHeadingWeight: 0.9, startGuideNormalBias: 0.35,
    endLineWeight: 0.5, endHeadingWeight: 0.9, endGuideNormalBias: 0.35,
    flowShift: 0, startFlowWeight: 0.8, endFlowWeight: 0.8, scoreBias: 12 },
];

interface GuideInput {
  line: Vec2;
  forward: Vec2;
  normal: Vec2;
  sideSign: number;
  lineWeight: number;
  headingWeight: number;
  normalBias: number;
}

function resolveGuide({ line, forward, normal, sideSign, lineWeight, headingWeight, normalBias }: GuideInput): Vec2 {
  const lin = scale(line, lineWeight);
  const fwd = scale(forward, headingWeight);
  const nrm = scale(normal, normalBias * sideSign);
  return normalize({ x: lin.x + fwd.x + nrm.x, y: lin.y + fwd.y + nrm.y }, line);
}

interface PathFromDescriptorInput {
  start: Vec2;
  end: Vec2;
  descriptor: CandidateDescriptor;
  startForward: Vec2;
  endForward: Vec2;
  params: Required<PathParams>;
}

function makePathFromDescriptor({ start, end, descriptor, startForward, endForward, params }: PathFromDescriptorInput): Path {
  const delta = sub(end, start);
  const distance = Math.max(length(delta), 1);
  const direction = normalize(delta, { x: 1, y: 0 });
  const normal = perpendicular(direction);
  const farFactor = Math.min(distance / 800, 1);

  const startHandle = params.startHandle;
  const endHandle = params.endHandle;
  const arcSize = params.arcSize;
  const arcFlow = params.arcFlow;

  const resolvedFlow = Math.max(0, Math.min(1, arcFlow + descriptor.flowShift));
  const flowBias = (resolvedFlow - 0.5) * distance * 0.18;

  const baseStartReach = distance * (0.10 + startHandle * 0.56);
  const baseEndReach = distance * (0.11 + endHandle * 0.62);
  const distanceLift = 0.68 + farFactor * 0.56;
  const baseArcHeight = Math.min(
    Math.max(distance * (0.10 + arcSize * 0.92) * descriptor.arcScale * distanceLift, 20),
    distance * 0.96,
  );

  const sideSign = descriptor.side;
  const arcVector: Vec2 = { x: normal.x * baseArcHeight * sideSign, y: normal.y * baseArcHeight * sideSign };

  const startGuide = resolveGuide({
    line: direction, forward: startForward, normal,
    sideSign, lineWeight: descriptor.startLineWeight,
    headingWeight: descriptor.startHeadingWeight,
    normalBias: descriptor.startGuideNormalBias,
  });
  const endGuide = resolveGuide({
    line: direction, forward: endForward, normal,
    sideSign, lineWeight: descriptor.endLineWeight,
    headingWeight: descriptor.endHeadingWeight,
    normalBias: descriptor.endGuideNormalBias,
  });

  const startReach = Math.max(baseStartReach * descriptor.startReachScale + flowBias * descriptor.startFlowWeight, 12);
  const endReach = Math.max(baseEndReach * descriptor.endReachScale - flowBias * descriptor.endFlowWeight, 12);

  const c1Base = add(start, scale(startGuide, startReach));
  const c2Base = sub(end, scale(endGuide, endReach));

  const control1: Vec2 = { x: c1Base.x + arcVector.x * descriptor.startNormalScale, y: c1Base.y + arcVector.y * descriptor.startNormalScale };
  const control2: Vec2 = { x: c2Base.x + arcVector.x * descriptor.endNormalScale, y: c2Base.y + arcVector.y * descriptor.endNormalScale };

  return makePath({
    start, end, startControl: control1, endControl: control2,
    segments: [makeSegment(end, control1, control2)],
  });
}

function preferredTurnSide(start: Vec2, end: Vec2, startForward: Vec2): number {
  const delta = sub(end, start);
  const dir = normalize(delta, { x: 1, y: 0 });
  const cross = startForward.x * dir.y - startForward.y * dir.x;
  if (cross > 0.05) return 1;
  if (cross < -0.05) return -1;
  return 0;
}

function turnDemand(startForward: Vec2, endForward: Vec2, start: Vec2, end: Vec2): number {
  const delta = sub(end, start);
  const dir = normalize(delta, { x: 1, y: 0 });
  const startTurn = Math.abs(signedAngle(startForward, dir));
  const endTurn = Math.abs(signedAngle(dir, endForward));
  return Math.min(1, (startTurn + endTurn) / Math.PI);
}

interface ScoreCandidateInput {
  path: Path;
  measurement: PathMeasurement;
  descriptor: CandidateDescriptor;
  context: CandidateContext;
}

interface CandidateContext {
  distance: number;
  turnDemand: number;
  directness: number;
  preferredSide: number;
}

function scoreCandidate({ path: _path, measurement, descriptor, context }: ScoreCandidateInput): number {
  const distance = Math.max(context.distance, 1);
  const excessLength = Math.max(measurement.length / distance - 1, 0);

  let score = descriptor.scoreBias;
  score += excessLength * 180;
  score += measurement.angleChangeEnergy * 90;
  score += measurement.maxAngleChange * 85;
  score += measurement.totalTurn * (descriptor.side === 0 ? 10 : 12);

  if (descriptor.side === 0) {
    score += context.turnDemand * 130;
  } else {
    score += context.directness * 90;
    if (descriptor.side !== context.preferredSide && context.preferredSide !== 0) {
      score += Math.max(context.turnDemand, 0.45) * 200;
    }
  }
  if (!measurement.staysInBounds) score += 45;
  return score;
}

export interface MakeCandidatesInput {
  start: Vec2;
  end: Vec2;
  bounds?: Bounds | null;
  startForward?: Vec2;
  endForward?: Vec2;
  params?: PathParams;
}

export function makeCandidates({
  start,
  end,
  bounds = null,
  startForward = { x: 1, y: 0 },
  endForward = { x: 1, y: 0 },
  params = {},
}: MakeCandidatesInput): Candidate[] {
  const sf = normalize(startForward, { x: 1, y: 0 });
  const ef = normalize(endForward, { x: 1, y: 0 });
  const distance = Math.max(length(sub(end, start)), 1);
  const preferredSide = preferredTurnSide(start, end, sf);
  const td = turnDemand(sf, ef, start, end);
  const directness = 1 - td;

  const context: CandidateContext = { distance, turnDemand: td, directness, preferredSide };

  const resolvedParams: Required<PathParams> = {
    startHandle: params.startHandle ?? DEFAULT_START_HANDLE,
    endHandle: params.endHandle ?? DEFAULT_END_HANDLE,
    arcSize: params.arcSize ?? DEFAULT_ARC_SIZE,
    arcFlow: params.arcFlow ?? DEFAULT_ARC_FLOW,
  };

  return DESCRIPTORS.map((descriptor) => {
    const path = makePathFromDescriptor({
      start, end, descriptor, startForward: sf, endForward: ef, params: resolvedParams,
    });
    const measurement = measurePath(path, bounds);
    const score = scoreCandidate({ path, measurement, descriptor, context });
    return { id: descriptor.id, kind: descriptor.kind, side: descriptor.side, descriptor, path, measurement, score };
  });
}

// Pick the candidate with the lowest score, preferring in-bounds ones.
export function chooseCandidate(candidates: Candidate[]): Candidate | null {
  if (!candidates || candidates.length === 0) return null;
  const inBounds = candidates.filter((c) => c.measurement.staysInBounds);
  const pool = inBounds.length > 0 ? inBounds : candidates;
  let best = pool[0];
  for (const c of pool) {
    if (c.score < best.score || (c.score === best.score && c.id < best.id)) {
      best = c;
    }
  }
  return best;
}

export const DEFAULT_PARAMS: Required<PathParams> = {
  startHandle: DEFAULT_START_HANDLE,
  endHandle: DEFAULT_END_HANDLE,
  arcSize: DEFAULT_ARC_SIZE,
  arcFlow: DEFAULT_ARC_FLOW,
};
