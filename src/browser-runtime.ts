import { CursorMotionEngine } from './engine.js';
import { DomCursorRenderer } from './renderer-dom.js';

import type { Bounds, Vec2, VisualState } from './types.js';

interface BrowserRuntimeOptions {
  layerId: string;
  cursorId: string;
  layerClassName: string;
  cursorClassName: string;
  visibleClassName: string;
  bloomClassName: string;
  moveGlobal: string;
  clickGlobal: string;
  readyGlobal: string;
  zIndex: number;
  bounds: Bounds | null;
  showTrail: boolean;
  showCandidates: boolean;
  idle: boolean;
}

type RuntimeWindow = Window &
  Record<string, unknown> & {
    __CursorMotionBrowserRuntime?: typeof runtimeApi;
  };

function finitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function installCursorMotionBrowserRuntime(options: BrowserRuntimeOptions): void {
  const win = window as unknown as RuntimeWindow;
  if (win[options.readyGlobal] && win[options.moveGlobal] && win[options.clickGlobal]) return;

  let layer: HTMLDivElement | null = null;
  let renderer: DomCursorRenderer | null = null;
  let engine: CursorMotionEngine | null = null;
  let hasPosition = false;

  function ensureLayer(): HTMLDivElement {
    const container = document.body || document.documentElement;
    const existing = document.getElementById(options.layerId) as HTMLDivElement | null;
    if (existing) {
      layer = existing;
    }
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.id = options.layerId;
      layer.className = options.layerClassName;
      container.appendChild(layer);
    }

    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.zIndex = String(options.zIndex);
    layer.style.pointerEvents = 'none';
    layer.style.overflow = 'visible';
    return layer;
  }

  function ensureRenderer(): DomCursorRenderer {
    const currentLayer = ensureLayer();
    if (renderer && renderer.root.isConnected && renderer.root.parentElement === currentLayer) return renderer;

    renderer?.root.remove();
    renderer = new DomCursorRenderer({
      container: currentLayer,
      zIndex: options.zIndex,
      showTrail: options.showTrail,
      showCandidates: options.showCandidates,
    });
    renderer.glyph.id = options.cursorId;
    renderer.glyph.classList.add(options.cursorClassName);
    return renderer;
  }

  function renderFrame(state: VisualState): void {
    const currentRenderer = ensureRenderer();
    currentRenderer.setShowTrail(options.showTrail);
    currentRenderer.setShowCandidates(options.showCandidates);
    currentRenderer.onUpdate(state);
    currentRenderer.glyph.classList.add(options.visibleClassName);
  }

  function createEngine(initial: Vec2): CursorMotionEngine {
    engine?.destroy();
    engine = new CursorMotionEngine({
      initial,
      bounds: options.bounds,
      idle: options.idle,
      onUpdate: renderFrame,
    });
    hasPosition = true;
    return engine;
  }

  function ensureEngine(initial: Vec2): CursorMotionEngine {
    ensureRenderer();
    return engine ?? createEngine(initial);
  }

  function spawnBloom(x: number, y: number): void {
    const currentLayer = ensureLayer();
    const bloom = document.createElement('div');
    bloom.className = options.bloomClassName;
    bloom.style.left = `${x}px`;
    bloom.style.top = `${y}px`;
    currentLayer.appendChild(bloom);
    setTimeout(() => {
      bloom.remove();
    }, 700);
  }

  win[options.moveGlobal] = (x: number, y: number, animate = true): void => {
    if (!finitePoint(x, y)) return;
    const target = { x, y };
    if (!hasPosition || animate === false) {
      createEngine(target);
      return;
    }
    ensureEngine(target).moveTo(target).catch(() => {
      // Superseded movement is expected when calls overlap.
    });
  };

  win[options.clickGlobal] = (x: number, y: number): void => {
    if (!finitePoint(x, y)) return;
    const target = { x, y };
    if (!hasPosition) createEngine(target);
    spawnBloom(x, y);
    ensureEngine(target).click().catch(() => {
      // Click animation is decorative; ignore visual-only failures.
    });
  };

  ensureRenderer();
  win[options.readyGlobal] = true;
}

const runtimeApi = { installCursorMotionBrowserRuntime };

(window as unknown as RuntimeWindow).__CursorMotionBrowserRuntime = runtimeApi;

export { installCursorMotionBrowserRuntime };
