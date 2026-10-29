/**
 * The widget's CSS, inside its Shadow DOM root. The host page's styles can't select anything in there; what they can
 * reach is the host element itself (`*`, attribute selectors) and inherited properties, so `:host` resets everything
 * with `!important` (inside a shadow root, an `!important` `:host` rule beats the page's `!important`). Only px: a
 * page's `html { font-size }` mustn't scale the widget.
 */
export interface Placement {
  position: "bottom-right" | "bottom-left" | "inline";
  size: number;
  offset: { x: number; y: number };
  zIndex: number;
}

export function widgetStyles({ position, size, offset, zIndex }: Placement): string {
  const fixed = position !== "inline";
  const side = position === "bottom-left" ? "left" : "right";
  const host = fixed
    ? `position: fixed !important; bottom: ${offset.y}px !important; ${side}: ${offset.x}px !important;
       z-index: ${zIndex} !important;`
    : "position: relative !important;";
  return `
:host {
  all: initial !important;
  display: block !important;
  ${host}
  width: auto !important; height: auto !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  transform: none !important; filter: none !important; opacity: 1 !important; visibility: visible !important;
  pointer-events: none !important;
  --th-size: ${size}px;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
  color: #1d2733 !important;
  direction: ltr !important;
}
*, *::before, *::after { box-sizing: border-box; }
.root { position: relative; display: flex; flex-direction: column; align-items: ${fixed && side === "left" ? "flex-start" : "flex-end"};
  gap: 8px; pointer-events: none; }
.root > * { pointer-events: auto; }
.row { display: flex; align-items: center; gap: 8px; flex-direction: ${side === "left" ? "row-reverse" : "row"}; }
.stage { position: relative; width: var(--th-size); height: var(--th-size); padding: 0; margin: 0; border: 0;
  border-radius: 50%; overflow: hidden; cursor: pointer; background: linear-gradient(#f6f9fc, #bcc7d4);
  box-shadow: 0 6px 24px rgba(16, 24, 40, 0.22), 0 0 0 3px #fff; display: block; font: inherit; color: inherit; }
.stage:focus-visible, .launcher:focus-visible, .close:focus-visible { outline: 3px solid #2f6feb; outline-offset: 3px; }
.view { position: absolute; inset: 0; }
.view canvas, .view img, .view svg { display: block; width: 100% !important; height: 100% !important; object-fit: cover; }
.badge { position: absolute; bottom: 6%; left: 50%; transform: translateX(-50%); width: 30px; height: 30px;
  border-radius: 50%; background: rgba(255, 255, 255, 0.92); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  display: flex; align-items: center; justify-content: center; transition: opacity 0.2s; }
.badge svg { width: 16px; height: 16px; fill: #1d2733; }
.root[data-state="playing"] .stage:not(:hover) .badge { opacity: 0; }
.close { position: absolute; top: -4px; ${side === "left" ? "right" : "left"}: -4px; width: 24px; height: 24px;
  padding: 0; margin: 0; border: 0; border-radius: 50%; background: #fff; color: #1d2733; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); font: 16px/24px system-ui, sans-serif; text-align: center; }
.stage-wrap { position: relative; }
.hint, .caption { background: #fff; border-radius: 14px; box-shadow: 0 4px 16px rgba(16, 24, 40, 0.18); }
.hint { padding: 8px 12px; font-size: 13px; white-space: nowrap; cursor: pointer; border: 0; margin: 0;
  font-family: inherit; color: inherit; }
.caption { max-width: min(300px, calc(100vw - 32px)); padding: 8px 12px; font-size: 14px; }
.caption .now { font-weight: 600; color: #0b4fd6; }
.launcher { width: 52px; height: 52px; padding: 0; margin: 0; border: 0; border-radius: 50%; cursor: pointer;
  background: #1d2733; box-shadow: 0 4px 16px rgba(16, 24, 40, 0.3); display: flex; align-items: center;
  justify-content: center; }
.launcher svg { width: 26px; height: 26px; fill: #fff; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
[hidden] { display: none !important; }
@media (max-width: 480px) { :host { --th-size: ${Math.min(size, 112)}px; } }
@media (prefers-reduced-motion: reduce) { .badge { transition: none; } }
`;
}

const svg = (path: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

export const ICONS = {
  play: svg("M8 5v14l11-7z"),
  stop: svg("M7 7h10v10H7z"),
  muted: svg("M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.45 2.45c.03-.2.05-.42.05-.65zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9zM12 4 9.91 6.09 12 8.18z"),
  chat: svg("M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"),
};

/** The still shown without WebGL (and with reduced motion, when there's no `poster`): a head and shoulders. */
export const STILL_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f9fc"/><stop offset="1" stop-color="#bcc7d4"/></linearGradient></defs>
<rect width="100" height="100" fill="url(#g)"/>
<ellipse cx="50" cy="44" rx="17" ry="21" fill="#9aa6b5"/>
<path d="M18 100c2-18 15-28 32-28s30 10 32 28z" fill="#9aa6b5"/></svg>`;
