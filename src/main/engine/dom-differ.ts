/**
 * DomDiffer — Lightweight structural comparison of page state.
 * Determines if a cached workflow can be replayed without AI re-engagement.
 *
 * Takes a structural snapshot (headings, form labels, interactive element counts)
 * and compares against the snapshot from when the action was cached.
 *
 * Similarity > 80%: replay directly (no AI needed)
 * Similarity 50-80%: replay with fallback chain
 * Similarity < 50%: re-engage AI (page changed significantly)
 */

/** Lightweight structural snapshot of a page — designed to be <500 bytes */
export interface StructuralSnapshot {
  /** Current page URL */
  url: string
  /** All heading texts (h1-h6) */
  headings: string[]
  /** All form field labels */
  formLabels: string[]
  /** All button texts */
  buttonTexts: string[]
  /** All link texts (truncated) */
  linkTexts: string[]
  /** Count of interactive elements */
  interactiveCount: number
  /** When snapshot was taken */
  timestamp: number
}

/** Result of comparing two snapshots */
export interface DomDiffResult {
  /** Overall similarity score 0-100 */
  similarity: number
  /** Strategy recommendation based on similarity */
  strategy: 'cache' | 'fallback' | 'recompute'
  /** Human-readable reason */
  reason: string
}

/**
 * JavaScript snippet that extracts a structural snapshot from the page.
 * Runs via webContents.executeJavaScript — no external dependencies.
 * Returns a StructuralSnapshot object.
 */
export function takeSnapshotScript(): string {
  return `(function(){
    function vis(el){
      if(!el)return false;
      var s=getComputedStyle(el);
      return s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.opacity)>0
    }
    function txt(el){return(el.textContent||'').trim().substring(0,40)}

    var headings=[];
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').forEach(function(el){
      if(vis(el)){var t=txt(el);if(t)headings.push(t)}
    });

    var formLabels=[];
    document.querySelectorAll('label,[aria-label]').forEach(function(el){
      if(!vis(el))return;
      var t=el.getAttribute('aria-label')||txt(el);
      if(t&&t.length>1)formLabels.push(t.substring(0,30))
    });
    // Also grab placeholders as pseudo-labels
    document.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(function(el){
      if(vis(el)){var p=el.getAttribute('placeholder');if(p)formLabels.push(p.substring(0,30))}
    });

    var buttonTexts=[];
    document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]').forEach(function(el){
      if(!vis(el))return;
      var t=txt(el)||el.getAttribute('value')||el.getAttribute('aria-label')||'';
      t=t.substring(0,30);
      if(t&&t.length>1)buttonTexts.push(t)
    });

    var linkTexts=[];
    document.querySelectorAll('a,[role="link"]').forEach(function(el){
      if(!vis(el))return;
      var t=txt(el);
      if(t&&t.length>1)linkTexts.push(t.substring(0,25))
    });
    // Cap arrays to keep snapshot small
    linkTexts=linkTexts.slice(0,20);

    var interactiveCount=document.querySelectorAll(
      'button,a,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]'
    ).length;

    return{
      url:location.href,
      headings:headings.slice(0,10),
      formLabels:formLabels.slice(0,15),
      buttonTexts:buttonTexts.slice(0,15),
      linkTexts:linkTexts,
      interactiveCount:interactiveCount,
      timestamp:Date.now()
    }
  })()`
}

/**
 * Take a structural snapshot of the current page.
 * @param executeJs Function that runs JS in the webview (e.g. webContents.executeJavaScript)
 * Returns null if the snapshot could not be taken (e.g. page not loaded, script error).
 */
export async function takeSnapshot(executeJs: (script: string) => Promise<unknown>): Promise<StructuralSnapshot | null> {
  try {
    const result = await executeJs(takeSnapshotScript())
    if (!result || typeof result !== 'object') return null
    const snapshot = result as StructuralSnapshot
    if (!snapshot.url || typeof snapshot.interactiveCount !== 'number') return null
    return snapshot
  } catch {
    return null
  }
}

/**
 * Compare two structural snapshots and return a similarity score.
 * Uses Jaccard similarity on text arrays + interactive count ratio.
 * @returns Score 0-100
 */
export function compare(a: StructuralSnapshot, b: StructuralSnapshot): DomDiffResult {
  // Jaccard similarity for each text array category
  const headingSim = jaccard(a.headings, b.headings)
  const formSim = jaccard(a.formLabels, b.formLabels)
  const buttonSim = jaccard(a.buttonTexts, b.buttonTexts)
  const linkSim = jaccard(a.linkTexts, b.linkTexts)

  // Interactive count ratio (0-1)
  const maxCount = Math.max(a.interactiveCount, b.interactiveCount, 1)
  const minCount = Math.min(a.interactiveCount, b.interactiveCount)
  const countRatio = minCount / maxCount

  // URL path similarity (same domain + path = bonus)
  let urlBonus = 0
  try {
    const urlA = new URL(a.url)
    const urlB = new URL(b.url)
    if (urlA.hostname === urlB.hostname) {
      urlBonus = 0.1
      if (urlA.pathname === urlB.pathname) urlBonus = 0.2
    }
  } catch { /* ignore */ }

  // Weighted average — forms and buttons matter most for action replay
  const weights = {
    headings: 0.15,
    forms: 0.30,
    buttons: 0.25,
    links: 0.10,
    count: 0.10,
    url: 0.10
  }

  const rawScore =
    headingSim * weights.headings +
    formSim * weights.forms +
    buttonSim * weights.buttons +
    linkSim * weights.links +
    countRatio * weights.count +
    urlBonus / 0.2 * weights.url  // normalize urlBonus (max 0.2) to 0-1

  const similarity = Math.round(rawScore * 100)

  // If interactive element count differs by more than 50%, cap similarity at 50%
  const countDivergenceRatio = Math.min(a.interactiveCount, b.interactiveCount) / Math.max(a.interactiveCount, b.interactiveCount || 1)
  if (countDivergenceRatio < 0.5) {
    return { similarity: Math.min(similarity, 49), strategy: 'recompute' as const, reason: `Interactive element count diverged too much (ratio ${(countDivergenceRatio * 100).toFixed(0)}%)` }
  }

  // Determine strategy
  let strategy: 'cache' | 'fallback' | 'recompute'
  let reason: string

  if (similarity > 80) {
    strategy = 'cache'
    reason = `High similarity (${similarity}%) — page structure matches cached state`
  } else if (similarity >= 50) {
    strategy = 'fallback'
    reason = `Moderate similarity (${similarity}%) — try cached selectors with fallback to resolver`
  } else {
    strategy = 'recompute'
    reason = `Low similarity (${similarity}%) — page changed significantly, re-engage AI`
  }

  return { similarity, strategy, reason }
}

/**
 * Jaccard similarity between two string arrays.
 * Compares lowercased, trimmed values.
 * Returns 0-1 (1 = identical sets, 0 = no overlap).
 * Empty sets: returns 1 if both empty, 0 if only one is empty.
 */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0

  const setA = new Set(a.map(s => s.toLowerCase().trim()))
  const setB = new Set(b.map(s => s.toLowerCase().trim()))

  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }

  const union = new Set([...setA, ...setB]).size
  return union > 0 ? intersection / union : 0
}

/* ── Visual (pixel-level) screenshot comparison ── */

/**
 * Compare two screenshots pixel-by-pixel.
 * pngjs and pixelmatch are loaded lazily — they may not be available in all builds.
 * @param img1Base64 - Base64 PNG string (before)
 * @param img2Base64 - Base64 PNG string (after)
 * @returns Diff percentage (0-100) and diff image as base64 PNG
 */
export function compareScreenshots(img1Base64: string, img2Base64: string): {
  diffPercentage: number
  diffImageBase64: string
  width: number
  height: number
} {
  // Lazy require — these native modules may not be bundled in all builds
  const { PNG } = require('pngjs') as typeof import('pngjs')
  const pixelmatch = require('pixelmatch') as any
  const png1 = PNG.sync.read(Buffer.from(img1Base64, 'base64'))
  const png2 = PNG.sync.read(Buffer.from(img2Base64, 'base64'))

  // Images must be same size
  const width = Math.min(png1.width, png2.width)
  const height = Math.min(png1.height, png2.height)

  // Resize to common dimensions if needed
  const data1 = cropImageData(png1, width, height)
  const data2 = cropImageData(png2, width, height)

  const diff = new PNG({ width, height })

  const numDiffPixels = pixelmatch(data1, data2, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false
  })

  const totalPixels = width * height
  const diffPercentage = Math.round((numDiffPixels / totalPixels) * 10000) / 100

  const diffBuffer = PNG.sync.write(diff)
  const diffImageBase64 = diffBuffer.toString('base64')

  return { diffPercentage, diffImageBase64, width, height }
}

function cropImageData(png: { width: number; height: number; data: Buffer }, targetWidth: number, targetHeight: number): Buffer {
  if (png.width === targetWidth && png.height === targetHeight) {
    return png.data
  }

  const result = Buffer.alloc(targetWidth * targetHeight * 4)
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcIdx = (y * png.width + x) * 4
      const dstIdx = (y * targetWidth + x) * 4
      result[dstIdx] = png.data[srcIdx]
      result[dstIdx + 1] = png.data[srcIdx + 1]
      result[dstIdx + 2] = png.data[srcIdx + 2]
      result[dstIdx + 3] = png.data[srcIdx + 3]
    }
  }
  return result
}
