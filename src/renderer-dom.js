// Drop-in DOM renderer. Pairs with CursorMotionEngine.onUpdate to draw a
// soft cursor (tip + glow + click pulse) on top of any web page or
// container. No external dependencies.

const DEFAULT_GLYPH_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <radialGradient id="cm-fog" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.85)"/>
      <stop offset="55%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <linearGradient id="cm-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d8dcec"/>
    </linearGradient>
  </defs>
  <circle cx="16" cy="16" r="15" fill="url(#cm-fog)"/>
  <path d="M9 7 L23 15 L15 17 L13 25 Z"
        fill="url(#cm-body)"
        stroke="rgba(20,24,40,0.55)"
        stroke-width="0.9"
        stroke-linejoin="round"/>
</svg>
`.trim();

export class DomCursorRenderer {
  constructor({
    container = document.body,
    zIndex = 9999,
    showTrail = false,
    showCandidates = false,
    glyphHTML = DEFAULT_GLYPH_SVG,
    size = 32,
  } = {}) {
    this.container = container;
    this.size = size;
    this.showTrail = showTrail;
    this.showCandidates = showCandidates;

    // Root: pointer-events none so it never blocks the underlying UI.
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: String(zIndex),
      overflow: 'visible',
    });

    // Optional debug SVG layer for trail + candidates.
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'visible',
    });
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.root.appendChild(this.svg);

    // Cursor glyph.
    this.glyph = document.createElement('div');
    Object.assign(this.glyph.style, {
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      transformOrigin: '25% 25%', // tip anchor near the upper-left
      transform: 'translate(-25%, -25%)',
      filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.18))',
      willChange: 'transform',
    });
    this.glyph.innerHTML = glyphHTML;
    this.root.appendChild(this.glyph);

    this.container.style.position = this.container.style.position || 'relative';
    this.container.appendChild(this.root);

    this._trailPoints = [];
  }

  // Engine-compatible onUpdate callback.
  onUpdate = (state) => {
    const { tip, angle, clickProgress, candidate, candidates, bodyOffset, fogOffset, fogOpacity, fogScale } = state;
    if (!tip) return;

    // The cursor SVG artwork already has its tip pointing upper-left (~-135°).
    // The `angle` from visual dynamics is 0 at rest (upper-left),
    // so we just apply it directly as the rotation.
    const sc = 1 - clickProgress * 0.18;
    const bx = bodyOffset?.x ?? 0;
    const by = bodyOffset?.y ?? 0;
    this.glyph.style.transform =
      `translate(${tip.x + bx}px, ${tip.y + by}px) translate(-25%, -25%) ` +
      `rotate(${angle}rad) scale(${sc})`;

    // Update fog circle opacity/scale if the glyph has one
    const fogEl = this.glyph.querySelector('circle');
    if (fogEl && fogOpacity != null) {
      fogEl.style.opacity = String(Math.min(fogOpacity / 0.34, 1));
      const fs = fogScale ?? 1;
      fogEl.setAttribute('transform', `scale(${fs})`);
      fogEl.setAttribute('transform-origin', '16 16');
    }

    if (this.showTrail) {
      this._trailPoints.push({ x: tip.x, y: tip.y });
      if (this._trailPoints.length > 200) this._trailPoints.shift();
    }

    if (this.showCandidates || this.showTrail) {
      this._redrawDebug({ candidate, candidates });
    } else if (this.svg.firstChild) {
      this._clearSvg();
    }
  };

  setShowTrail(flag) {
    this.showTrail = !!flag;
    if (!flag) this._trailPoints = [];
    if (!flag && !this.showCandidates) this._clearSvg();
  }
  setShowCandidates(flag) {
    this.showCandidates = !!flag;
    if (!flag && !this.showTrail) this._clearSvg();
  }

  destroy() {
    this.root.remove();
  }

  _clearSvg() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
  }

  _redrawDebug({ candidate, candidates }) {
    this._clearSvg();

    if (this.showCandidates && candidates) {
      for (const c of candidates) {
        const path = this._buildPathD(c.path);
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('d', path);
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', c === candidate ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.18)');
        el.setAttribute('stroke-width', c === candidate ? '2' : '1');
        el.setAttribute('stroke-dasharray', c === candidate ? '' : '4 4');
        this.svg.appendChild(el);
      }
    }

    if (this.showTrail && this._trailPoints.length > 1) {
      const d = this._trailPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', d);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'rgba(140,200,255,0.85)');
      el.setAttribute('stroke-width', '1.5');
      this.svg.appendChild(el);
    }
  }

  _buildPathD(path) {
    if (!path.segments?.length) return '';
    let d = `M${path.start.x},${path.start.y}`;
    let prev = path.start;
    for (const seg of path.segments) {
      d += ` C${seg.control1.x},${seg.control1.y} ${seg.control2.x},${seg.control2.y} ${seg.end.x},${seg.end.y}`;
      prev = seg.end;
    }
    void prev;
    return d;
  }
}
