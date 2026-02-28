/**
 * Oculo Webview Preload Script
 *
 * Injected into every webview via the preload attribute.
 * Runs in an isolated world BEFORE page scripts — this is the ONLY reliable
 * place to patch browser fingerprints. The executeJavaScript approach from
 * did-start-navigation/dom-ready is too late (ThreatMetrix runs instantly).
 */

// ── Anti-Bot Fingerprint Patching ────────────────────────────────────────
// All patches must run here, before ANY page JavaScript executes.

// 1. navigator.webdriver — must be undefined (not true)
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true })
} catch { /* CSP may block */ }

// 2. navigator.languages — real Chrome value (not Electron's system locale)
try {
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true })
} catch {}

// 3. navigator.plugins — fake a realistic Chrome plugin array (5 entries)
try {
  const fakePlugins = {
    length: 5,
    0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
    2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
    3: { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    4: { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
    item: function(i: number) { return (this as any)[i] || null },
    namedItem: function(name: string) { for (let i = 0; i < 5; i++) { if ((this as any)[i]?.name === name) return (this as any)[i] } return null },
    refresh: function() {},
    [Symbol.iterator]: function*() { for (let i = 0; i < 5; i++) yield (this as any)[i] }
  }
  Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true })
} catch {}

// 4. navigator.mimeTypes — fake realistic mime types (4 entries)
try {
  const fakeMimeTypes = {
    length: 4,
    0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    1: { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    2: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
    3: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
    item: function(i: number) { return (this as any)[i] || null },
    namedItem: function(name: string) { for (let i = 0; i < 4; i++) { if ((this as any)[i]?.type === name) return (this as any)[i] } return null },
    [Symbol.iterator]: function*() { for (let i = 0; i < 4; i++) yield (this as any)[i] }
  }
  Object.defineProperty(navigator, 'mimeTypes', { get: () => fakeMimeTypes, configurable: true })
} catch {}

// 5. window.chrome — comprehensive fake matching real Chrome behavior
try {
  const fakeChrome = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: function() { return null },
      getIsInstalled: function() { return false }
    },
    runtime: {
      id: undefined,
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      connect: function(extensionId?: string) {
        if (extensionId !== undefined && typeof extensionId !== 'string') {
          throw new TypeError('chrome.runtime.connect() called from a webpage must specify an Extension ID (string) for its first argument')
        }
        return {
          name: '', sender: undefined,
          disconnect: function() {},
          onDisconnect: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false } },
          onMessage: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false } },
          postMessage: function() { throw new Error('Attempting to use a disconnected port object') }
        }
      },
      sendMessage: function(extensionId?: string) {
        if (extensionId !== undefined && typeof extensionId !== 'string') {
          throw new TypeError('chrome.runtime.sendMessage() called from a webpage must specify an Extension ID (string) for its first argument')
        }
      },
      getManifest: function() { return undefined },
      getURL: function(path: string) { return 'chrome-extension://invalid/' + path },
      getPlatformInfo: function(cb?: Function) {
        const info = { os: 'mac', arch: 'x86-64', nacl_arch: 'x86-64' }
        if (cb) cb(info)
        return Promise.resolve(info)
      },
      lastError: undefined
    },
    csi: function() { return {} },
    loadTimes: function() {
      return {
        requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000,
        commitLoadTime: Date.now() / 1000, finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000, firstPaintTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0, navigationType: 'Other',
        wasFetchedViaSpdy: false, wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2'
      }
    }
  }
  Object.defineProperty(window, 'chrome', { get: () => fakeChrome, configurable: true })
} catch {}

// 6. Notification.permission — Electron auto-grants; real Chrome returns 'default' on first visit
// ThreatMetrix cross-checks this — if 'granted' without user interaction, it's automation
try {
  if (typeof Notification !== 'undefined') {
    Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true })
  }
} catch {}

// 7. navigator.permissions.query — consistent with Notification.permission = 'default'
try {
  const origQuery = navigator.permissions.query.bind(navigator.permissions)
  navigator.permissions.query = function(desc: PermissionDescriptor) {
    if (desc.name === 'notifications') {
      return Promise.resolve({ state: 'prompt' as PermissionState, onchange: null } as PermissionStatus)
    }
    return origQuery(desc)
  }
} catch {}

// 8. navigator.connection — Electron has rtt=0 (headless indicator). Always override.
try {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g', rtt: 50, downlink: 10.5, downlinkMax: Infinity,
      saveData: false, type: 'wifi', onchange: null, ontypechange: null,
      addEventListener: function() {}, removeEventListener: function() {}
    }),
    configurable: true
  })
} catch {}

// 9. navigator.hardwareConcurrency — reasonable value
try {
  if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true })
  }
} catch {}

// 10. navigator.deviceMemory — reasonable value
try {
  if (!(navigator as any).deviceMemory) {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true })
  }
} catch {}

// 11. window.outerWidth / outerHeight — Electron returns 0 (definitive headless indicator)
try {
  if (window.outerWidth === 0) {
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth || screen.availWidth, configurable: true })
  }
  if (window.outerHeight === 0) {
    Object.defineProperty(window, 'outerHeight', { get: () => (window.innerHeight || screen.availHeight) + 85, configurable: true })
  }
} catch {}

// 12. WebGL vendor/renderer — make it look like real Chrome on macOS
try {
  const getParameterOrig = WebGLRenderingContext.prototype.getParameter
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return 'Google Inc. (Apple)'        // UNMASKED_VENDOR_WEBGL
    if (p === 37446) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)' // UNMASKED_RENDERER_WEBGL
    return getParameterOrig.call(this, p)
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2Orig = WebGL2RenderingContext.prototype.getParameter
    WebGL2RenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Google Inc. (Apple)'
      if (p === 37446) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)'
      return getParameter2Orig.call(this, p)
    }
  }
} catch {}

// 13. navigator.mediaDevices.enumerateDevices — strip labels like real Chrome (no permission)
try {
  if (navigator.mediaDevices) {
    const origEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
    navigator.mediaDevices.enumerateDevices = async function() {
      const devices = await origEnumerate()
      return devices.map(d => ({
        deviceId: d.deviceId === 'default' ? 'default' : '',
        kind: d.kind, label: '', groupId: '',
        toJSON: () => ({})
      } as MediaDeviceInfo))
    }
  }
} catch {}

// ── Cosmetic Ad Element Hiding ────────────────────────────────────────────
// Hide common ad containers that slip through network-level blocking.
// Injected as CSS so it's instant and doesn't require DOM mutation observers.
;(function injectAdHidingCSS() {
  const style = document.createElement('style')
  style.id = '__oculo-ad-hide'
  style.textContent = `
    [id*="google_ads"], [id*="google_ad"], [id*="GoogleAd"],
    [id*="ad-container"], [id*="ad_container"], [id*="adContainer"],
    [id*="ad-wrapper"], [id*="ad_wrapper"], [id*="adWrapper"],
    [id*="ad-slot"], [id*="ad_slot"], [id*="adSlot"],
    [id*="ad-banner"], [id*="ad_banner"], [id*="adBanner"],
    [class*="ad-container"], [class*="ad_container"], [class*="adContainer"],
    [class*="ad-wrapper"], [class*="ad_wrapper"], [class*="adWrapper"],
    [class*="ad-slot"], [class*="ad_slot"], [class*="adSlot"],
    [class*="ad-banner"], [class*="ad_banner"], [class*="adBanner"],
    iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
    iframe[src*="adserver"], iframe[src*="adservice"],
    iframe[src*="ad."], iframe[src*="/ads/"],
    [data-ad], [data-adunit], [data-ad-slot], [data-ad-client],
    [data-google-query-id], [data-ad-format],
    .adsbygoogle, ins.adsbygoogle, #carbonads, .carbon-wrap,
    [class*="sponsored-"], [class*="sponsored_"],
    [id*="taboola-"], [id*="outbrain-"],
    .taboola, .outbrain, .mgid-widget,
    [class*="promoted-content"], [class*="native-ad"],
    div[id^="div-gpt-ad"], div[data-google-query-id]
    { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }
  `
  if (document.documentElement) {
    document.documentElement.appendChild(style)
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.appendChild(style)
    })
  }
})()

// ── Markdown Extraction (Readability + Turndown) ─────────────────────────
// Firecrawl-inspired: extract article content as clean markdown
;(function setupMarkdownExtraction() {
  try {
    const { Readability } = require('@mozilla/readability')
    const TurndownService = require('turndown')

    ;(window as any).__oc_extract_markdown = () => {
      try {
        const clone = document.cloneNode(true) as Document
        const article = new Readability(clone).parse()
        if (!article) return { error: 'No readable content found' }
        const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
        const md = td.turndown(article.content)
        return { title: article.title, byline: article.byline || '', markdown: md }
      } catch (e: any) {
        return { error: 'Extraction failed: ' + e.message }
      }
    }
  } catch {
    // Readability/Turndown not available — fallback will be handled by renderer
    ;(window as any).__oc_extract_markdown = () => ({ error: 'Readability not available in this context' })
  }
})()

// ── Console Capture ──────────────────────────────────────────────────────
// Persistent across navigations
;(function setupConsoleCapture() {
  if ((window as any).__oc_logs) return
  ;(window as any).__oc_logs = [] as Array<{ type: string; msg: string; ts: number }>
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  }
  for (const type of ['log', 'warn', 'error', 'info'] as const) {
    console[type] = function (...args: any[]) {
      ;(window as any).__oc_logs.push({
        type,
        msg: args.map((a: any) => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a) }
          catch { return String(a) }
        }).join(' '),
        ts: Date.now()
      })
      if ((window as any).__oc_logs.length > 200) {
        (window as any).__oc_logs.shift()
      }
      orig[type].apply(console, args)
    }
  }

  // Capture uncaught errors
  window.addEventListener('error', (e) => {
    (window as any).__oc_logs.push({
      type: 'error',
      msg: `Uncaught: ${e.message || ''} at ${e.filename || ''}:${e.lineno || ''}`,
      ts: Date.now()
    })
  })

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    (window as any).__oc_logs.push({
      type: 'error',
      msg: `Unhandled rejection: ${String(e.reason)}`,
      ts: Date.now()
    })
  })
})()

// ── CAPTCHA Detection ────────────────────────────────────────────────────
;(function setupCaptchaDetection() {
  if ((window as any).__oc_captcha) return
  ;(window as any).__oc_captcha = false

  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '.h-captcha',
    'iframe[src*="turnstile"]',
    '.cf-turnstile',
    '[data-sitekey]'
  ]

  function checkForCaptcha(): void {
    for (const sel of captchaSelectors) {
      if (document.querySelector(sel)) {
        (window as any).__oc_captcha = true
        return
      }
    }
  }

  if (document.readyState === 'complete') {
    checkForCaptcha()
  } else {
    window.addEventListener('load', checkForCaptcha)
  }

  const observer = new MutationObserver(() => { checkForCaptcha() })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true })
    })
  }
})()

// ── Dialog Handling ──────────────────────────────────────────────────────
;(function setupDialogHandling() {
  if ((window as any).__oc_dialogs) return
  const origAlert = window.alert
  const origConfirm = window.confirm
  const origPrompt = window.prompt

  ;(window as any).__oc_dialogs = [] as Array<{
    type: string; message: string; defaultValue?: string; ts: number; response: string
  }>

  window.alert = function(message?: any) {
    const msg = String(message || '')
    ;(window as any).__oc_dialogs.push({ type: 'alert', message: msg, ts: Date.now(), response: 'dismissed' })
  }

  window.confirm = function(message?: string): boolean {
    const msg = String(message || '')
    ;(window as any).__oc_dialogs.push({ type: 'confirm', message: msg, ts: Date.now(), response: 'accepted' })
    return true
  }

  window.prompt = function(message?: string, defaultValue?: string): string | null {
    const msg = String(message || '')
    ;(window as any).__oc_dialogs.push({ type: 'prompt', message: msg, defaultValue: defaultValue || '', ts: Date.now(), response: defaultValue || '' })
    return defaultValue || ''
  }
})()

// ── Beforeunload Suppression ─────────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
  e.stopImmediatePropagation()
}, true)

// ── Highlight-to-Ask (Feature 3) ─────────────────────────────────────────
// Detect text selection and send to host for floating popup
;(function setupHighlightToAsk() {
  const { ipcRenderer } = require('electron')

  document.addEventListener('mouseup', () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (!text || text.length > 5000) return

    // Get position for popup placement
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    ipcRenderer.sendToHost('text:selected', {
      text,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top)
    })
  })
})()

// ── Smart Copy (Feature 12) ──────────────────────────────────────────────
// Intercept copy to preserve table structure as TSV
;(function setupSmartCopy() {
  function tableToTSV(table: HTMLTableElement): string {
    const rows: string[] = []
    for (const row of Array.from(table.rows)) {
      const cells: string[] = []
      for (const cell of Array.from(row.cells)) {
        cells.push(cell.textContent?.trim().replace(/\t/g, ' ').replace(/\n/g, ' ') || '')
      }
      rows.push(cells.join('\t'))
    }
    return rows.join('\n')
  }

  document.addEventListener('copy', (e) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    // Check if selection contains a table
    const range = selection.getRangeAt(0)
    const container = range.cloneContents()
    const tables = container.querySelectorAll('table')

    if (tables.length === 0) return // Let default copy handle it

    e.preventDefault()

    // Get the actual table elements from the DOM (not the cloned fragment)
    const ancestor = range.commonAncestorContainer as Element
    const el = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement
    const realTable = el?.closest('table') || el?.querySelector('table')

    if (realTable) {
      const tsv = tableToTSV(realTable)
      const html = realTable.outerHTML
      e.clipboardData?.setData('text/plain', tsv)
      e.clipboardData?.setData('text/html', html)
    } else {
      // Multiple tables or partial selection — use first table from fragment
      const tempDiv = document.createElement('div')
      tempDiv.appendChild(container)
      e.clipboardData?.setData('text/plain', selection.toString())
      e.clipboardData?.setData('text/html', tempDiv.innerHTML)
    }
  })
})()

// ── Image Context Menu (Feature 14) ──────────────────────────────────────
// Right-click on images sends to host for AI analysis
;(function setupImageContext() {
  const { ipcRenderer } = require('electron')

  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement
      ipcRenderer.sendToHost('image:describe', img.src)
    }
  })
})()

// ── WebMCP Polyfill (navigator.modelContext API) ─────────────────────────
import './webmcp-polyfill'

// ── Login Page Detection ─────────────────────────────────────────────────
;(function setupLoginDetection() {
  function checkLogin(): void {
    ;(window as any).__oc_login = !!document.querySelector('input[type=password]')
  }

  if (document.readyState === 'complete') checkLogin()
  else window.addEventListener('load', checkLogin)

  const observer = new MutationObserver(checkLogin)
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true })
    })
  }
})()
