// Canvas/SVG app detection for visual-first applications (Figma, Excalidraw, etc.)
// These apps render primarily to <canvas>/<svg> so DOM-based tools need coordinate-based fallbacks.

export interface CanvasElementInfo {
  tag: string
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasDetectionResult {
  isCanvasApp: boolean
  appType: string | null
  canvasElements: CanvasElementInfo[]
  overlayElements: number
  viewportCoverage: number
}

export interface KnownAppInfo {
  shortcuts: Record<string, string>
  api: string
}

/**
 * Inline JS to run via executeJavaScript() — detects canvas/SVG-heavy apps.
 * Returns a JSON string of CanvasDetectionResult.
 */
export const CANVAS_DETECT_SCRIPT = `(function() {
  var hostname = location.hostname;
  var pathname = location.pathname;
  var appType = null;

  // URL-based known app detection
  if (hostname.includes('figma.com')) appType = 'figma';
  else if (hostname.includes('canva.com')) appType = 'canva';
  else if (hostname.includes('docs.google.com') && pathname.startsWith('/presentation')) appType = 'google_slides';
  else if (hostname.includes('miro.com')) appType = 'miro';
  else if (hostname.includes('excalidraw.com')) appType = 'excalidraw';
  else if (hostname.includes('tldraw.com')) appType = 'tldraw';
  else if (hostname.includes('photopea.com')) appType = 'photopea';
  else if (hostname.includes('pixlr.com')) appType = 'pixlr';

  // Enumerate canvas and SVG elements
  var elements = document.querySelectorAll('canvas, svg');
  var canvasElements = [];
  var totalCanvasArea = 0;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var rect = el.getBoundingClientRect();
    var w = rect.width;
    var h = rect.height;

    // Filter out tiny elements (icons, decorations)
    if (w <= 50 || h <= 50) continue;

    canvasElements.push({
      tag: el.tagName.toLowerCase(),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(w),
      h: Math.round(h)
    });

    totalCanvasArea += w * h;
  }

  // Calculate viewport coverage percentage
  var viewportArea = window.innerWidth * window.innerHeight;
  var viewportCoverage = viewportArea > 0
    ? Math.round(totalCanvasArea / viewportArea * 100 * 10) / 10
    : 0;

  // Count visible DOM overlay elements (toolbars, buttons, inputs)
  var overlaySelectors = 'button, [role="button"], [role="toolbar"], input, select';
  var overlayCandidates = document.querySelectorAll(overlaySelectors);
  var overlayElements = 0;
  for (var j = 0; j < overlayCandidates.length; j++) {
    if (overlayCandidates[j].offsetParent !== null) overlayElements++;
  }

  var isCanvasApp = viewportCoverage > 30 || appType !== null;

  return JSON.stringify({
    isCanvasApp: isCanvasApp,
    appType: appType,
    canvasElements: canvasElements,
    overlayElements: overlayElements,
    viewportCoverage: viewportCoverage
  });
})()`

/**
 * Known canvas app metadata — keyboard shortcuts and JS API hints.
 */
export const KNOWN_APPS: Record<string, KnownAppInfo> = {
  figma: {
    shortcuts: {
      V: 'Select',
      T: 'Text',
      R: 'Rectangle',
      F: 'Frame',
      L: 'Line',
      P: 'Pen',
      O: 'Ellipse',
      H: 'Hand',
      'Ctrl+D': 'Duplicate'
    },
    api: 'Not accessible from browser console'
  },
  excalidraw: {
    shortcuts: {
      'V / 1': 'Select',
      'R / 3': 'Rectangle',
      'D / 4': 'Diamond',
      'O / 5': 'Ellipse',
      'A / 6': 'Arrow',
      'L / 7': 'Line',
      'T / 8': 'Text',
      'F / 9': 'Freedraw',
      'E / 0': 'Eraser'
    },
    api: 'window.excalidrawAPI'
  },
  canva: {
    shortcuts: {
      T: 'Text',
      R: 'Rectangle',
      L: 'Line'
    },
    api: 'Not accessible'
  },
  photopea: {
    shortcuts: {
      V: 'Move',
      M: 'Marquee',
      L: 'Lasso',
      W: 'Magic Wand',
      C: 'Crop',
      B: 'Brush',
      E: 'Eraser',
      G: 'Gradient',
      T: 'Type',
      P: 'Pen'
    },
    api: 'app.activeDocument'
  },
  tldraw: {
    shortcuts: {
      V: 'Select',
      D: 'Draw',
      E: 'Eraser',
      A: 'Arrow',
      T: 'Text',
      N: 'Note',
      F: 'Frame'
    },
    api: 'window.tldrawApp'
  },
  miro: {
    shortcuts: {
      V: 'Select',
      T: 'Text',
      S: 'Sticky note',
      P: 'Pen',
      L: 'Line',
      R: 'Rectangle'
    },
    api: 'Not accessible'
  },
  google_slides: {
    shortcuts: {
      'Ctrl+M': 'New slide',
      'Ctrl+D': 'Duplicate',
      Delete: 'Delete slide'
    },
    api: 'Not accessible'
  }
}

/**
 * Build a human-readable header block from canvas detection results.
 * Included in page descriptions so Claude knows to use coordinate-based actions.
 */
export function buildCanvasHeader(info: CanvasDetectionResult): string {
  const lines: string[] = []

  const appLabel = info.appType || 'Unknown Canvas App'
  lines.push(`[CANVAS APP: ${appLabel}] \u2014 ${info.viewportCoverage}% of viewport is canvas`)

  for (const el of info.canvasElements) {
    lines.push(`Canvas: ${el.tag} at (${el.x},${el.y}) ${el.w}x${el.h}`)
  }

  lines.push(`DOM overlay: ${info.overlayElements} interactive elements (toolbars, menus)`)
  lines.push('')

  // Append keyboard shortcuts if known
  if (info.appType && KNOWN_APPS[info.appType]) {
    const app = KNOWN_APPS[info.appType]
    lines.push(`Keyboard shortcuts for ${info.appType}:`)
    const entries = Object.entries(app.shortcuts)
    const formatted = entries.map(([key, desc]) => `  ${key} \u2014 ${desc}`)
    lines.push(...formatted)
    lines.push('')
    lines.push(`JS API: ${app.api}`)
  } else {
    lines.push('JS API: Not accessible from browser console')
  }

  lines.push('')
  lines.push(
    'TIP: Use clickAtPoint(x,y) for canvas content. Use press(key) for tools.'
  )
  lines.push(
    'Use screenshotSoM for coordinate grid. DOM menus/toolbars work normally via click/fill.'
  )

  return lines.join('\n')
}

/**
 * Inline JS that injects a coordinate grid overlay onto the page.
 * Useful for visually identifying click targets on canvas apps.
 * Returns 'Grid overlay injected'.
 */
export const GRID_OVERLAY_SCRIPT = `(function() {
  // Remove existing overlay if present
  var existing = document.getElementById('oculo-grid-overlay');
  if (existing) existing.remove();

  var canvas = document.createElement('canvas');
  canvas.id = 'oculo-grid-overlay';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '999997';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  if (!ctx) return 'Grid overlay failed: no 2d context';

  var w = canvas.width;
  var h = canvas.height;
  var step = 100;
  var color = 'rgba(0,150,255,0.3)';

  // Draw vertical grid lines
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  for (var x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Draw horizontal grid lines
  for (var y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw coordinate labels at intersections
  ctx.font = '9px monospace';
  ctx.fillStyle = color;
  for (var gx = 0; gx <= w; gx += step) {
    for (var gy = 0; gy <= h; gy += step) {
      if (gx === 0 && gy === 0) continue; // skip origin clutter
      ctx.fillText(gx + ',' + gy, gx + 2, gy + 10);
    }
  }

  // Show viewport dimensions in the bottom-right corner
  var dimText = w + 'x' + h;
  var metrics = ctx.measureText(dimText);
  ctx.fillText(dimText, w - metrics.width - 6, h - 6);

  return 'Grid overlay injected';
})()`
