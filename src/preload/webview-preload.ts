/**
 * Oculo Webview Preload Script
 *
 * Injected into every webview via the preload attribute.
 * Runs in an isolated world before page scripts.
 * Provides persistent monitoring capabilities that survive in-page navigation.
 */

// Anti-bot: patch navigator.webdriver before page scripts run
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
} catch { /* CSP may block */ }

// Ensure chrome runtime looks normal
try {
  if ((window as any).chrome === undefined) {
    Object.defineProperty(window, 'chrome', {
      get: () => ({ runtime: {}, csi: () => ({}), loadTimes: () => ({}) })
    })
  }
} catch { /* CSP may block */ }

// Console capture — persistent across navigations
;(function setupConsoleCapture() {
  if ((window as any).__oculo_logs) return
  ;(window as any).__oculo_logs = [] as Array<{ type: string; msg: string; ts: number }>
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  }
  for (const type of ['log', 'warn', 'error', 'info'] as const) {
    console[type] = function (...args: any[]) {
      ;(window as any).__oculo_logs.push({
        type,
        msg: args.map((a: any) => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a) }
          catch { return String(a) }
        }).join(' '),
        ts: Date.now()
      })
      if ((window as any).__oculo_logs.length > 200) {
        (window as any).__oculo_logs.shift()
      }
      orig[type].apply(console, args)
    }
  }

  // Capture uncaught errors
  window.addEventListener('error', (e) => {
    (window as any).__oculo_logs.push({
      type: 'error',
      msg: `Uncaught: ${e.message || ''} at ${e.filename || ''}:${e.lineno || ''}`,
      ts: Date.now()
    })
  })

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    (window as any).__oculo_logs.push({
      type: 'error',
      msg: `Unhandled rejection: ${String(e.reason)}`,
      ts: Date.now()
    })
  })
})()

// CAPTCHA detection via MutationObserver
;(function setupCaptchaDetection() {
  if ((window as any).__oculoCaptchaWatching) return
  ;(window as any).__oculoCaptchaWatching = true

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
        (window as any).__oculo_captcha_detected = true
        return
      }
    }
  }

  // Check on load
  if (document.readyState === 'complete') {
    checkForCaptcha()
  } else {
    window.addEventListener('load', checkForCaptcha)
  }

  // Watch for dynamically injected CAPTCHAs
  const observer = new MutationObserver(() => {
    checkForCaptcha()
  })

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true })
      }
    })
  }
})()

// Dialog handling — intercept alert/confirm/prompt and store for AI agent
;(function setupDialogHandling() {
  if ((window as any).__oculo_dialogs) return
  const origAlert = window.alert
  const origConfirm = window.confirm
  const origPrompt = window.prompt

  ;(window as any).__oculo_dialogs = [] as Array<{
    type: string; message: string; defaultValue?: string; ts: number; response: string
  }>

  window.alert = function(message?: any) {
    const msg = String(message || '')
    ;(window as any).__oculo_dialogs.push({
      type: 'alert',
      message: msg,
      ts: Date.now(),
      response: 'dismissed'
    })
    // Don't actually show the alert — it would block the agent
    console.info('[Oculo] Alert intercepted:', msg)
  }

  window.confirm = function(message?: string): boolean {
    const msg = String(message || '')
    ;(window as any).__oculo_dialogs.push({
      type: 'confirm',
      message: msg,
      ts: Date.now(),
      response: 'accepted'
    })
    console.info('[Oculo] Confirm intercepted (auto-accepted):', msg)
    // Default to accepting — the AI can override via the 'respondToDialog' action
    return true
  }

  window.prompt = function(message?: string, defaultValue?: string): string | null {
    const msg = String(message || '')
    ;(window as any).__oculo_dialogs.push({
      type: 'prompt',
      message: msg,
      defaultValue: defaultValue || '',
      ts: Date.now(),
      response: defaultValue || ''
    })
    console.info('[Oculo] Prompt intercepted:', msg)
    // Return the default value — the AI can override via the 'respondToDialog' action
    return defaultValue || ''
  }
})()

// beforeunload handler — prevent "Leave site?" from blocking navigation
window.addEventListener('beforeunload', (e) => {
  // Suppress the browser's "Leave site?" dialog
  e.stopImmediatePropagation()
}, true)

// Login page detection — flag pages with password fields
;(function setupLoginDetection() {
  function checkLogin(): void {
    const hasPassword = !!document.querySelector('input[type=password]')
    ;(window as any).__oculo_is_login_page = hasPassword
  }

  if (document.readyState === 'complete') {
    checkLogin()
  } else {
    window.addEventListener('load', checkLogin)
  }

  // Re-check on DOM changes (SPA navigations)
  const observer = new MutationObserver(checkLogin)
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true })
      }
    })
  }
})()
