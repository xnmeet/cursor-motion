// Drop-in DOM renderer. Pairs with CursorMotionEngine.onUpdate to draw a
// soft cursor (tip + glow + click pulse) on top of any web page or
// container. No external dependencies.
//
// The glyph matches the official reference: dark charcoal fill with white
// stroke, neutral orientation pointing upper-left (-135°). The fog/glow is
// rendered as a separate element to allow independent offset/scale/opacity.

// Pointer shape derived from the reference SynthesizedCursorGlyphView contour.
// Coordinate system: 48×48 viewBox, pointer centered, tip at upper-left.
// The shape path is scaled from the original 48×48 pixel contour data.
const POINTER_PATH = 'M14.5 6.5 L10.5 29.5 L17 21 L29 19 Z';

const DEFAULT_GLYPH_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" style="overflow:visible">
  <defs>
    <radialGradient id="cm-fog">
      <stop offset="0%" stop-color="rgba(97,92,89,0.40)"/>
      <stop offset="50%" stop-color="rgba(110,105,102,0.28)"/>
      <stop offset="82%" stop-color="rgba(117,112,110,0.11)"/>
      <stop offset="100%" stop-color="rgba(153,153,153,0)"/>
    </radialGradient>
  </defs>
  <circle class="cm-fog-circle" cx="24" cy="24" r="33" fill="url(#cm-fog)"/>
  <path class="cm-pointer" d="${POINTER_PATH}"
        fill="rgba(97,92,89,0.98)"
        stroke="rgba(230,230,230,0.92)"
        stroke-width="1.55"
        stroke-linejoin="round"
        stroke-linecap="round"/>
</svg>
`.trim();

export class DomCursorRenderer {
  constructor({
    container = document.body,
    zIndex = 9999,
    showTrail = false,
    showCandidates = false,
    glyphHTML = DEFAULT_GLYPH_SVG,
    size = 48,
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

    // Cursor glyph container.
    this.glyph = document.createElement('div');
    Object.assign(this.glyph.style, {
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      // Tip of the pointer is at roughly 30%/14% in our 48x48 viewBox
      transformOrigin: '30% 14%',
      transform: 'translate(-30%, -14%)',
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

    // Motion compression: subtle squash along velocity
    const bodyMag = Math.hypot(bodyOffset?.x ?? 0, bodyOffset?.y ?? 0);
    const motionComp = Math.min(bodyMag * 0.008, 0.018);
    const pulseComp = clickProgress * 0.03;
    const scX = 1 - motionComp - pulseComp;
    const scY = 1 + (pulseComp * 0.4);

    const bx = bodyOffset?.x ?? 0;
    const by = bodyOffset?.y ?? 0;
    this.glyph.style.transform =
      `translate(${tip.x + bx}px, ${tip.y + by}px) translate(-30%, -14%) ` +
      `rotate(${angle}rad) scale(${scX}, ${scY})`;

    // Update fog circle: separate offset, opacity, and scale
    const fogEl = this.glyph.querySelector('.cm-fog-circle');
    if (fogEl) {
      const fox = fogOffset?.x ?? 0;
      const foy = fogOffset?.y ?? 0;
      const fs = fogScale ?? 1;
      const fo = fogOpacity ?? 0.12;
      // Fog opacity multiplier relative to base (0.12)
      const opacityMul = Math.max(0.28, Math.min(fo / 0.12, 2.2));
      fogEl.style.opacity = String(Math.min(opacityMul, 1));
      // The fog offset is relative to the pointer; translate within the SVG
      fogEl.setAttribute('transform', `translate(${fox * 0.7} ${foy * 0.7}) scale(${fs})`);
      fogEl.setAttribute('transform-origin', '24 24');
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
