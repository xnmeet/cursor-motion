export interface CursorMotionBrowserBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CursorMotionBrowserOptions {
  styleId?: string;
  layerId?: string;
  cursorId?: string;
  layerClassName?: string;
  cursorClassName?: string;
  visibleClassName?: string;
  bloomClassName?: string;
  moveGlobal?: string;
  clickGlobal?: string;
  readyGlobal?: string;
  zIndex?: number;
  bounds?: CursorMotionBrowserBounds | null;
  showTrail?: boolean;
  showCandidates?: boolean;
  idle?: boolean;
}

const DEFAULT_BROWSER_OPTIONS = {
  styleId: '__cursor-motion-styles',
  layerId: '__cursor-motion-layer',
  cursorId: '__cursor-motion-cursor',
  layerClassName: '__cursor-motion-layer',
  cursorClassName: '__cursor-motion-cursor',
  visibleClassName: '--visible',
  bloomClassName: '__cursor-motion-click-bloom',
  moveGlobal: '__cursorMotionMoveCursor',
  clickGlobal: '__cursorMotionClickCursor',
  readyGlobal: '__cursorMotionReady',
  zIndex: 2147483647,
  bounds: null,
  showTrail: false,
  showCandidates: false,
  idle: false,
};

interface ResolvedCursorMotionBrowserOptions extends Required<Omit<CursorMotionBrowserOptions, 'bounds'>> {
  bounds: CursorMotionBrowserBounds | null;
}

function resolveOptions(options: CursorMotionBrowserOptions = {}): ResolvedCursorMotionBrowserOptions {
  return { ...DEFAULT_BROWSER_OPTIONS, ...options };
}

// Replaced during `npm run build` by scripts/build-browser-runtime.mjs.
const BROWSER_RUNTIME_SOURCE = '__CURSOR_MOTION_BROWSER_RUNTIME_SOURCE__';

export function createCursorMotionBrowserStyle(options: CursorMotionBrowserOptions = {}): string {
  const o = resolveOptions(options);

  return `
.${o.layerClassName} {
  position: fixed;
  inset: 0;
  z-index: ${o.zIndex};
  pointer-events: none;
  overflow: visible;
}
.${o.cursorClassName} {
  opacity: 0;
  pointer-events: none;
  box-sizing: border-box;
  transition: opacity 0.18s ease;
}
.${o.cursorClassName}.${o.visibleClassName} {
  opacity: 1;
}
.${o.cursorClassName} svg {
  display: block;
  width: 48px;
  height: 48px;
  overflow: visible;
}
.${o.bloomClassName} {
  position: fixed;
  width: 54px;
  height: 54px;
  margin-left: -27px;
  margin-top: -27px;
  border-radius: 999px;
  border: 1.5px solid rgba(230, 230, 230, 0.52);
  background: radial-gradient(circle, rgba(97, 92, 89, 0.22) 0%, rgba(97, 92, 89, 0.12) 44%, rgba(97, 92, 89, 0) 72%);
  pointer-events: none;
  animation: __cursor-motion-click-bloom 0.46s ease-out forwards;
  box-sizing: border-box;
}
@keyframes __cursor-motion-click-bloom {
  0% {
    transform: scale(0.44);
    opacity: 0.72;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}
`;
}

export const CURSOR_MOTION_BROWSER_STYLE = createCursorMotionBrowserStyle();

export function createCursorMotionBrowserScript(options: CursorMotionBrowserOptions = {}): string {
  const resolved = resolveOptions(options);

  return `
(function() {
  var OPTIONS = ${JSON.stringify(resolved)};
  if (window[OPTIONS.readyGlobal] && window[OPTIONS.moveGlobal] && window[OPTIONS.clickGlobal]) return;
${BROWSER_RUNTIME_SOURCE}
  window.__CursorMotionBrowserRuntime.installCursorMotionBrowserRuntime(OPTIONS);
})();
`;
}

export const CURSOR_MOTION_BROWSER_SCRIPT = createCursorMotionBrowserScript();
