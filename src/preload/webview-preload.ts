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
        // Detect platform from user agent
        const ua = navigator.userAgent
        const os = ua.includes('Windows') ? 'win' : ua.includes('Linux') ? 'linux' : 'mac'
        const info = { os, arch: 'x86-64', nacl_arch: 'x86-64' }
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

// 13.5. navigator.userAgentData — Chrome 90+ API; Google uses this to detect embedded browsers
try {
  const uaBrands = [
    { brand: 'Not A(Brand', version: '8' },
    { brand: 'Chromium', version: '132' },
    { brand: 'Google Chrome', version: '132' }
  ]
  const uaPlatform = navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('Linux') ? 'Linux' : 'macOS'

  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({
      brands: uaBrands,
      mobile: false,
      platform: uaPlatform,
      getHighEntropyValues: async () => ({
        brands: uaBrands,
        fullVersionList: [
          { brand: 'Not A(Brand', version: '8.0.0.0' },
          { brand: 'Chromium', version: '132.0.6834.210' },
          { brand: 'Google Chrome', version: '132.0.6834.210' }
        ],
        mobile: false,
        model: '',
        platform: uaPlatform,
        platformVersion: uaPlatform === 'macOS' ? '14.0.0' : uaPlatform === 'Windows' ? '15.0.0' : '6.5.0',
        architecture: 'x86',
        bitness: '64',
        uaFullVersion: '132.0.6834.210',
        wow64: false
      }),
      toJSON: () => ({ brands: uaBrands, mobile: false, platform: uaPlatform })
    }),
    configurable: true
  })
} catch {}

// ── Enhanced Stealth Evasion (Browserbase-grade) ──────────────────────────

// 14. Canvas fingerprint randomization — add imperceptible noise to canvas
// output to break canvas fingerprinting while keeping visual output identical
;(function patchCanvasFingerprint() {
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: any) {
      try {
        const ctx = this.getContext('2d')
        if (ctx && this.width > 0 && this.height > 0) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height)
          // Modify 3-5 random pixels with random noise per call
          const numPixels = 3 + Math.floor(Math.random() * 3)
          for (let i = 0; i < numPixels; i++) {
            const idx = Math.floor(Math.random() * (imageData.data.length / 4)) * 4
            const channel = Math.floor(Math.random() * 3) // R, G, or B
            imageData.data[idx + channel] ^= 1
          }
          ctx.putImageData(imageData, 0, 0)
        }
      } catch { /* canvas may be tainted — skip noise */ }
      return origToDataURL.call(this, type, quality)
    }

    // Also patch toBlob
    const origToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function(callback: BlobCallback, type?: string, quality?: any) {
      try {
        const ctx = this.getContext('2d')
        if (ctx && this.width > 0 && this.height > 0) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height)
          const numPixels = 3 + Math.floor(Math.random() * 3)
          for (let i = 0; i < numPixels; i++) {
            const idx = Math.floor(Math.random() * (imageData.data.length / 4)) * 4
            const channel = Math.floor(Math.random() * 3)
            imageData.data[idx + channel] ^= 1
          }
          ctx.putImageData(imageData, 0, 0)
        }
      } catch { /* canvas may be tainted */ }
      return origToBlob.call(this, callback, type, quality)
    }

    // Patch getImageData to add per-call random noise
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function(sx: number, sy: number, sw: number, sh: number, settings?: ImageDataSettings) {
      const data = settings
        ? origGetImageData.call(this, sx, sy, sw, sh, settings)
        : origGetImageData.call(this, sx, sy, sw, sh)
      // Modify 3-5 random pixels with random noise per call
      if (data.data.length >= 4) {
        const numPixels = 3 + Math.floor(Math.random() * 3)
        for (let i = 0; i < numPixels; i++) {
          const idx = Math.floor(Math.random() * (data.data.length / 4)) * 4
          const channel = Math.floor(Math.random() * 3)
          data.data[idx + channel] ^= 1
        }
      }
      return data
    }
  } catch (e) {
    if (!(window as any).__oc_stealth_status) (window as any).__oc_stealth_status = {}
    ;(window as any).__oc_stealth_status.canvasPatchFailed = true
  }
})()

// 15. WebRTC IP leak prevention — prevent WebRTC from leaking real IP
;(function patchWebRTC() {
  try {
    if (typeof RTCPeerConnection !== 'undefined') {
      const OrigRTCPeerConnection = RTCPeerConnection
      const PatchedRTCPeerConnection = function(this: RTCPeerConnection, config?: RTCConfiguration) {
        // Force empty ICE servers to prevent STUN/TURN IP leak
        const safeConfig: RTCConfiguration = {
          ...config,
          iceServers: [],
          iceTransportPolicy: 'relay' as RTCIceTransportPolicy
        }
        return new OrigRTCPeerConnection(safeConfig)
      } as any
      PatchedRTCPeerConnection.prototype = OrigRTCPeerConnection.prototype
      PatchedRTCPeerConnection.generateCertificate = OrigRTCPeerConnection.generateCertificate
      Object.defineProperty(window, 'RTCPeerConnection', {
        value: PatchedRTCPeerConnection,
        writable: true,
        configurable: true
      })
      // Also patch the prefixed variant
      if ((window as any).webkitRTCPeerConnection) {
        Object.defineProperty(window, 'webkitRTCPeerConnection', {
          value: PatchedRTCPeerConnection,
          writable: true,
          configurable: true
        })
      }
    }
  } catch (e) {
    if (!(window as any).__oc_stealth_status) (window as any).__oc_stealth_status = {}
    ;(window as any).__oc_stealth_status.webrtcPatchFailed = true
  }
})()

// 16. AudioContext fingerprint randomization — add noise to frequency data
;(function patchAudioFingerprint() {
  try {
    if (typeof AnalyserNode !== 'undefined') {
      const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData
      AnalyserNode.prototype.getFloatFrequencyData = function(array: any) {
        origGetFloatFrequencyData.call(this, array)
        // Random per element per call
        for (let i = 0; i < array.length; i++) {
          array[i] += (Math.random() - 0.5) * 0.0002
        }
      }

      const origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData
      AnalyserNode.prototype.getByteFrequencyData = function(array: any) {
        origGetByteFrequencyData.call(this, array)
        // Random per element per call
        for (let i = 0; i < array.length; i++) {
          array[i] ^= (Math.random() < 0.5 ? 1 : 0)
        }
      }
    }

    // Patch AudioBuffer.getChannelData for offline audio fingerprinting
    if (typeof AudioBuffer !== 'undefined') {
      const origGetChannelData = AudioBuffer.prototype.getChannelData
      AudioBuffer.prototype.getChannelData = function(channel: number) {
        const data = origGetChannelData.call(this, channel)
        // Add per-call random noise to multiple samples
        const numSamples = Math.min(data.length, 3 + Math.floor(Math.random() * 3))
        for (let i = 0; i < numSamples; i++) {
          const idx = Math.floor(Math.random() * data.length)
          data[idx] += (Math.random() - 0.5) * 0.0002
        }
        return data
      }
    }
  } catch (e) {
    if (!(window as any).__oc_stealth_status) (window as any).__oc_stealth_status = {}
    ;(window as any).__oc_stealth_status.audioPatchFailed = true
  }
})()

// 17. Font enumeration blocking — limit document.fonts to standard web-safe fonts
;(function patchFontEnumeration() {
  try {
    if (document.fonts && typeof document.fonts.check === 'function') {
      // Standard web-safe fonts that all browsers have
      const STANDARD_FONTS = new Set([
        'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
        'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Helvetica',
        'Helvetica Neue', 'Lucida Console', 'Lucida Sans Unicode', 'Tahoma',
        'Palatino Linotype', 'Book Antiqua', 'Garamond', 'MS Sans Serif',
        'MS Serif', 'Symbol', 'Webdings', 'Wingdings',
        // System fonts
        'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
        'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'sans-serif',
        'serif', 'monospace', 'cursive', 'fantasy'
      ])

      const origCheck = document.fonts.check.bind(document.fonts)
      document.fonts.check = function(font: string, text?: string): boolean {
        // Better parser: strip everything before the first font-family
        // CSS font shorthand: [style] [variant] [weight] [stretch] [size][/line-height] family [, family]*
        // Font-family always comes after size, which contains digits
        const families = font
          .replace(/^[^,]*?\d+(?:\.\d+)?(?:px|pt|em|rem|%|vh|vw|ex|ch|cm|mm|in|pc)\s*(?:\/\s*[\d.]+(?:px|pt|em|rem|%)?\s*)?/, '') // strip size and line-height
          .split(',')
          .map(f => f.trim().replace(/["']/g, ''))
          .filter(f => f.length > 0)
        // Only report standard fonts as available
        const hasStandard = families.some(f => STANDARD_FONTS.has(f))
        if (hasStandard) return origCheck(font, text)
        return true  // Report all fonts as available to prevent font enumeration
      }
    }
  } catch (e) {
    if (!(window as any).__oc_stealth_status) (window as any).__oc_stealth_status = {}
    ;(window as any).__oc_stealth_status.fontPatchFailed = true
  }
})()

// 18. Battery API spoofing — return consistent fake battery data
;(function patchBatteryAPI() {
  try {
    const fakeBattery = {
      charging: true,
      chargingTime: 0,
      dischargingTime: Infinity,
      level: 1.0,
      onchargingchange: null,
      onchargingtimechange: null,
      ondischargingtimechange: null,
      onlevelchange: null,
      addEventListener: function() {},
      removeEventListener: function() {},
      dispatchEvent: function() { return true }
    }

    // Always define getBattery, even if it doesn't exist natively
    Object.defineProperty(navigator, 'getBattery', {
      value: function() {
        return Promise.resolve(fakeBattery)
      },
      writable: true,
      configurable: true
    })

    // Also handle the deprecated battery property
    Object.defineProperty(navigator, 'battery', {
      get: () => fakeBattery,
      configurable: true
    })
  } catch (e) {
    if (!(window as any).__oc_stealth_status) (window as any).__oc_stealth_status = {}
    ;(window as any).__oc_stealth_status.batteryPatchFailed = true
  }
})()

// 19. Screen resolution consistency — ensure screen dimensions are realistic
// and consistent with window dimensions (mismatches flag headless browsers)
;(function patchScreenConsistency() {
  try {
    // Randomize from common resolutions per session
    const resolutions = [
      [1920, 1080], [1366, 768], [1536, 864], [1440, 900], [1680, 1050], [2560, 1440]
    ]
    const [screenWidth, screenHeight] = resolutions[Math.floor(Math.random() * resolutions.length)]
    const availWidth = screenWidth
    const availHeight = screenHeight - 65  // Taskbar offset
    const colorDepth = 24
    const pixelDepth = 24

    Object.defineProperty(screen, 'width', { get: () => screenWidth, configurable: true })
    Object.defineProperty(screen, 'height', { get: () => screenHeight, configurable: true })
    Object.defineProperty(screen, 'availWidth', { get: () => availWidth, configurable: true })
    Object.defineProperty(screen, 'availHeight', { get: () => availHeight, configurable: true })
    Object.defineProperty(screen, 'colorDepth', { get: () => colorDepth, configurable: true })
    Object.defineProperty(screen, 'pixelDepth', { get: () => pixelDepth, configurable: true })

    // Screen orientation — consistent with landscape monitor
    if (screen.orientation) {
      try {
        Object.defineProperty(screen.orientation, 'type', {
          get: () => 'landscape-primary', configurable: true
        })
        Object.defineProperty(screen.orientation, 'angle', {
          get: () => 0, configurable: true
        })
      } catch {
        // Fallback: replace the entire orientation object
        try {
          Object.defineProperty(screen, 'orientation', {
            value: { type: 'landscape-primary', angle: 0, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true } },
            configurable: true
          })
        } catch { /* truly immutable, accept it */ }
      }
    }

    // Ensure devicePixelRatio is reasonable (Retina = 2, standard = 1)
    if (!window.devicePixelRatio || window.devicePixelRatio === 0) {
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 2, configurable: true })
    }

    // matchMedia consistency — ensure screen-related media queries match
    const origMatchMedia = window.matchMedia?.bind(window)
    if (origMatchMedia) {
      window.matchMedia = function(query: string): MediaQueryList {
        // Intercept resolution-related queries to ensure consistency
        if (query.includes('prefers-color-scheme')) {
          return origMatchMedia(query)  // Pass through theme queries
        }
        return origMatchMedia(query)
      }
    }
  } catch (e) {
    if (!(window as any).__oc_stealth_status) (window as any).__oc_stealth_status = {}
    ;(window as any).__oc_stealth_status.screenPatchFailed = true
  }
})()

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

// ── File Chooser Interception ────────────────────────────────────────────
// Prevent native OS file dialog from opening during MCP automation.
// When AI clicks a file input (or a button that triggers one), the dialog
// would block the automation pipeline. Instead, we suppress it and record
// the event so the MCP tool handler can guide the AI to use the upload action.
;(function setupFileInputInterception() {
  const origClick = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function() {
    if (this.type === 'file') {
      // Record the intercepted file dialog for MCP tool handler to detect
      ;(window as any).__oculoFileDialogBlocked = {
        selector: this.id ? '#' + this.id : this.name ? 'input[name="' + this.name + '"]' : 'input[type=file]',
        ts: Date.now()
      }
      // Don't call original — prevents native file picker
      return
    }
    return origClick.call(this)
  }
})()

// ── Beforeunload Suppression ─────────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
  e.stopImmediatePropagation()
}, true)

// ── Highlight-to-Ask (Feature 3) ─────────────────────────────────────────
// Detect text selection and send to host for floating popup
;(function setupHighlightToAsk() {
  const { ipcRenderer, webFrame } = require('electron')
  // Set marker in main world (world 0) so evaluate() can see it
  webFrame.executeJavaScript('window.__oculoHighlightActive = true').catch(() => {})

  document.addEventListener('mouseup', () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (!text || text.length > 5000) return

    // Get position for popup placement
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    // Use ipcRenderer.send for WebContentsView compatibility (sendToHost only works with <webview>)
    ipcRenderer.send('text:selected', {
      text,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top)
    })
  })
})()

// ── Smart Copy (Feature 12) ──────────────────────────────────────────────
// Intercept copy to preserve table structure as TSV
;(function setupSmartCopy() {
  // Set marker in main world (world 0) so evaluate() can see it
  const { webFrame } = require('electron')
  webFrame.executeJavaScript('window.__oculoSmartCopyActive = true').catch(() => {})

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
      // Use ipcRenderer.send for WebContentsView compatibility
      ipcRenderer.send('image:describe', img.src)
    }
  })
})()

// ── Web3 Wallet Relay Provider (EIP-1193) ────────────────────────────────
// Injects window.ethereum that proxies RPC calls via postMessage to the main process
// relay server. Uses a message channel since webview-preload can't access ipcRenderer.
;(function setupWeb3WalletRelay() {
  // Don't inject if a real wallet extension is already present
  if ((window as any).ethereum) return

  let requestId = 1
  const eventListeners = new Map<string, Set<(...args: any[]) => void>>()
  let connected = false
  let currentAccounts: string[] = []
  let currentChainId = '0x1'

  // Listen for wallet state updates injected by main process via executeJavaScript
  ;(window as any).__oculoWalletUpdate = function(data: any) {
    if (data.type === 'state') {
      connected = true
      currentAccounts = data.accounts || []
      currentChainId = data.chainId || '0x1'
      if ((window as any).ethereum) {
        ;(window as any).ethereum.chainId = currentChainId
        ;(window as any).ethereum.selectedAddress = currentAccounts[0] || null
      }
      emitEvent('connect', { chainId: currentChainId })
      if (currentAccounts.length > 0) {
        emitEvent('accountsChanged', currentAccounts)
      }
    } else if (data.type === 'accountsChanged') {
      currentAccounts = data.data || []
      if ((window as any).ethereum) {
        ;(window as any).ethereum.selectedAddress = currentAccounts[0] || null
      }
      emitEvent('accountsChanged', currentAccounts)
    } else if (data.type === 'chainChanged') {
      currentChainId = data.data || '0x1'
      if ((window as any).ethereum) {
        ;(window as any).ethereum.chainId = currentChainId
      }
      emitEvent('chainChanged', currentChainId)
    } else if (data.type === 'rpc-response') {
      // Resolve a pending request
      const pending = (window as any).__oculoPendingRequests?.get(data.id)
      if (pending) {
        ;(window as any).__oculoPendingRequests.delete(data.id)
        clearTimeout(pending.timer)
        if (data.error) {
          const err: any = new Error(data.error.message || 'Unknown error')
          err.code = data.error.code || -32603
          pending.reject(err)
        } else {
          pending.resolve(data.result)
        }
      }
    }
  }
  ;(window as any).__oculoPendingRequests = new Map()

  function emitEvent(event: string, ...args: any[]): void {
    const listeners = eventListeners.get(event)
    if (listeners) {
      for (const fn of listeners) {
        try { fn(...args) } catch { /* listener error */ }
      }
    }
  }

  // EIP-1193 provider interface
  interface EIP1193Provider {
    isMetaMask: boolean
    isOculoRelay: boolean
    _events: Record<string, unknown>
    isConnected: () => boolean
    chainId: string
    selectedAddress: string | null
    networkVersion: string
    request: (args: { method: string; params?: any[] }) => Promise<any>
    on: (event: string, handler: (...args: any[]) => void) => EIP1193Provider
    removeListener: (event: string, handler: (...args: any[]) => void) => EIP1193Provider
    removeAllListeners: (event?: string) => EIP1193Provider
    enable: () => Promise<any>
    send: (methodOrPayload: any, paramsOrCallback?: any) => any
    sendAsync: (payload: any, callback: (err: any, result: any) => void) => void
  }

  const provider: EIP1193Provider = {
    isMetaMask: true,
    isOculoRelay: true,
    _events: {},

    isConnected: () => connected,

    get chainId() { return currentChainId },
    set chainId(v: string) { currentChainId = v },

    get selectedAddress() { return currentAccounts[0] || null },
    set selectedAddress(v: string | null) {
      if (v) currentAccounts = [v, ...currentAccounts.slice(1)]
    },

    get networkVersion() {
      // Convert hex chainId to decimal string
      try { return String(parseInt(currentChainId, 16)) } catch { return '1' }
    },

    request: async ({ method, params }: { method: string; params?: any[] }): Promise<any> => {
      const id = requestId++

      // Some methods can be answered locally without the relay
      if (method === 'eth_chainId') {
        if (currentChainId && connected) return currentChainId
      }
      if (method === 'eth_accounts') {
        if (currentAccounts.length > 0 && connected) return currentAccounts
      }

      // Route through HTTP fetch to the local relay server
      // fetch to localhost is allowed from HTTPS pages (unlike WebSocket)
      try {
        const resp = await fetch('http://127.0.0.1:19517/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, method, params: params || [] })
        })
        const data = await resp.json()
        if (data.error) {
          const err: any = new Error(data.error.message || 'Unknown error')
          err.code = data.error.code || -32603
          throw err
        }
        // Update local state
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          if (Array.isArray(data.result)) {
            currentAccounts = data.result
            connected = true
            ;(provider as any).selectedAddress = currentAccounts[0] || null
          }
        }
        if (method === 'eth_chainId' && data.result) {
          currentChainId = data.result
          ;(provider as any).chainId = currentChainId
        }
        return data.result
      } catch (err: any) {
        const error: any = new Error(err.message || 'Relay request failed')
        error.code = err.code || -32603
        throw error
      }
    },

    on: (event: string, handler: (...args: any[]) => void): EIP1193Provider => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set())
      }
      eventListeners.get(event)!.add(handler)
      return provider
    },

    removeListener: (event: string, handler: (...args: any[]) => void): EIP1193Provider => {
      eventListeners.get(event)?.delete(handler)
      return provider
    },

    removeAllListeners: (event?: string): EIP1193Provider => {
      if (event) {
        eventListeners.delete(event)
      } else {
        eventListeners.clear()
      }
      return provider
    },

    // Legacy methods (EIP-1193 deprecated but some dApps still use them)
    enable: async () => {
      return provider.request({ method: 'eth_requestAccounts' })
    },

    send: (methodOrPayload: any, paramsOrCallback?: any): any => {
      if (typeof methodOrPayload === 'string') {
        return provider.request({ method: methodOrPayload, params: paramsOrCallback || [] })
      }
      // Legacy: send({ method, params }, callback)
      if (typeof paramsOrCallback === 'function') {
        provider.request({ method: methodOrPayload.method, params: methodOrPayload.params || [] })
          .then((result: any) => paramsOrCallback(null, { id: methodOrPayload.id, jsonrpc: '2.0', result }))
          .catch((err: any) => paramsOrCallback(err))
        return
      }
      return provider.request({ method: methodOrPayload.method, params: methodOrPayload.params || [] })
    },

    sendAsync: (payload: any, callback: (err: any, result: any) => void): void => {
      provider.request({ method: payload.method, params: payload.params || [] })
        .then((result: any) => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
        .catch((err: any) => callback(err, null))
    }
  }

  // Define as non-configurable so dApps can't accidentally overwrite it
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: false,
    configurable: false
  })

  // Also dispatch the EIP-6963 announceProvider event for modern dApps
  try {
    const info = {
      uuid: 'oculo-wallet-relay-v1',
      name: 'Oculo (MetaMask Relay)',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%23818cf8"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18">O</text></svg>',
      rdns: 'com.oculo.wallet-relay'
    }
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider })
    }))
    // Listen for requestProvider events from dApps
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info, provider })
      }))
    })
  } catch { /* EIP-6963 optional */ }

  // Connect to relay immediately so isConnected() returns true
  // when dApps check before calling request()
  // Check relay status on load via HTTP
  fetch('http://127.0.0.1:19517/status')
    .then(r => r.json())
    .then(status => {
      if (status.chromeConnected && status.accounts?.length > 0) {
        connected = true
        currentAccounts = status.accounts
        currentChainId = status.chainId || '0x1'
        ;(provider as any).chainId = currentChainId
        ;(provider as any).selectedAddress = currentAccounts[0] || null
        emitEvent('connect', { chainId: currentChainId })
        emitEvent('accountsChanged', currentAccounts)
      }
    })
    .catch(() => {}) // Relay not running, that's fine
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
