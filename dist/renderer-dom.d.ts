import type { VisualState, DomRendererOptions } from './types.js';
export declare class DomCursorRenderer {
    container: HTMLElement;
    size: number;
    showTrail: boolean;
    showCandidates: boolean;
    root: HTMLDivElement;
    svg: SVGSVGElement;
    glyph: HTMLDivElement;
    private _trailPoints;
    constructor({ container, zIndex, showTrail, showCandidates, glyphHTML, size, }?: DomRendererOptions);
    onUpdate: (state: VisualState) => void;
    setShowTrail(flag: boolean): void;
    setShowCandidates(flag: boolean): void;
    destroy(): void;
    private _clearSvg;
    private _redrawDebug;
    private _buildPathD;
}
//# sourceMappingURL=renderer-dom.d.ts.map