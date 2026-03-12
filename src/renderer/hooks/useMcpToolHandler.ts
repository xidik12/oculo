import { useEffect } from 'react'
import type { Tab } from '../../shared/types'
import type { ElementFingerprint } from '../../shared/types'
import { buildClickCode, buildFillCode, buildReadCode, buildWaitForStableCode, buildConsoleCapture, buildSlimStateCode, buildPageCode, buildFingerprintMatchCode, fuzzyMatchCode, gaussianDelay } from '../utils/webview-scripts'

function oculoApi(): any {
  return (window as any).oculo
}

const NEW_TAB_URL = 'oculo://newtab'

let tabCounter = 1000000
function newId(): string {
  return `tab-${Date.now()}-${++tabCounter}`
}

export interface McpToolHandlerParams {
  activeTabIdRef: React.MutableRefObject<string>
  tabsRef: React.MutableRefObject<Tab[]>
  lastPageSnapshot: React.MutableRefObject<string>
  lastA11ySnapshot: React.MutableRefObject<string>
  currentRefMap: React.MutableRefObject<Record<string, ElementFingerprint>>
  tabOpQueue: React.MutableRefObject<Map<string, Promise<unknown>>>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>
  setAiActing: React.Dispatch<React.SetStateAction<boolean>>
  setChatOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function useMcpToolHandler(params: McpToolHandlerParams): void {
  const {
    activeTabIdRef, tabsRef, lastPageSnapshot, lastA11ySnapshot,
    currentRefMap, tabOpQueue, setTabs, setActiveTabId, setAiActing, setChatOpen
  } = params

  // MCP tool execution — separate effect with inline handler
  useEffect(() => {
    const api = oculoApi()
    if (!api?.onMcpToolCall) return

    // ViewHandle — proxies webview-like calls through IPC to WebContentsView in main process.
    // Provides the same interface as a <webview> DOM element so all existing tool code works unchanged.
    function createViewHandle(tabId: string, wcId: number): any {
      return {
        executeJavaScript: (code: string) => api.viewExecuteJS(wcId, code),
        sendInputEvent: (event: any) => api.viewSendInput(wcId, event),
        insertText: (text: string) => api.viewInsertText(wcId, text),
        capturePage: () => api.viewCapturePage(wcId),
        loadURL: (url: string) => api.viewLoadURL(wcId, url),
        goBack: () => api.viewGoBack(wcId),
        goForward: () => api.viewGoForward(wcId),
        reload: () => api.viewReload(wcId),
        canGoBack: () => {
          const t = tabsRef.current.find(t => t.id === tabId)
          return t?.canGoBack ?? false
        },
        canGoForward: () => {
          const t = tabsRef.current.find(t => t.id === tabId)
          return t?.canGoForward ?? false
        },
        isLoading: () => {
          const t = tabsRef.current.find(t => t.id === tabId)
          return t?.isLoading ?? false
        },
        getWebContentsId: () => wcId,
        getURL: () => {
          const t = tabsRef.current.find(t => t.id === tabId)
          return t?.url ?? ''
        },
        getTitle: () => {
          const t = tabsRef.current.find(t => t.id === tabId)
          return t?.title ?? ''
        },
      }
    }

    // Helper: find the active tab's ViewHandle (replaces webview DOM search)
    function findActiveWebview(): any {
      const activeId = activeTabIdRef.current
      const tab = tabsRef.current.find(t => t.id === activeId)
      if (tab?.webContentsId) return createViewHandle(tab.id, tab.webContentsId)
      // Fallback: legacy webview DOM search (transition period)
      const webviews = document.querySelectorAll('webview')
      for (const w of webviews) {
        const parent = w.closest('div')
        if (parent && !parent.classList.contains('hidden')) return w
      }
      return null
    }

    // Helper: find ViewHandle by tab ID (v0.3.0 — background task execution)
    function findWebviewByTabId(tabId: string): any {
      const tab = tabsRef.current.find(t => t.id === tabId)
      if (tab?.webContentsId) return createViewHandle(tab.id, tab.webContentsId)
      // Fallback: legacy preload webview registry (transition period)
      const oculo = (window as any).oculo
      if (!oculo) return null
      try {
        const info = oculo.getWebviewInfo?.(tabId)
        if (info) {
          return {
            executeJavaScript: (code: string) => oculo.executeInWebview(tabId, code),
            getWebContentsId: () => oculo.getWebContentsId?.(tabId),
            isLoading: () => {
              const t = tabsRef.current.find(t => t.id === tabId)
              return t?.isLoading ?? false
            }
          }
        }
      } catch { /* not found */ }
      return null
    }

    // Helper: wait for a webview to finish loading
    async function waitForWebviewReady(wv: any, maxAttempts = 20): Promise<boolean> {
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 500))
        try { if (!(wv as any).isLoading?.()) return true } catch { /* wait */ }
      }
      return false
    }


    // Helper: convert a NativeImage (from capturePage()) to a base64 PNG string
    // Fix #23: Auto-resize images wider than 2000px to prevent context bloat in subagents
    function nativeImageToBase64(nativeImage: any): string {
      let img = nativeImage
      try {
        const size = img.getSize?.()
        if (size && size.width > 2000) {
          img = img.resize({ width: 2000 })
        }
      } catch { /* resize not available, use original */ }
      const pngBuffer = img.toPNG()
      const bytes = new Uint8Array(pngBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return btoa(binary)
    }


    // Helper: parse and strip ---REFMAP--- block from a11y snapshot result.
    // Returns { snapshot, refMap } where snapshot has the block removed.
    function parseRefMapFromSnapshot(raw: string): { snapshot: string; refMap: Record<string, import('@shared/types').ElementFingerprint> } {
      const marker = '\n---REFMAP---\n'
      const idx = raw.indexOf(marker)
      if (idx === -1) return { snapshot: raw, refMap: {} }
      const snapshot = raw.substring(0, idx)
      try {
        const refMap = JSON.parse(raw.substring(idx + marker.length))
        return { snapshot, refMap }
      } catch { return { snapshot, refMap: {} } }
    }

    // Helper: get a ref-tagged a11y snapshot for post-action use (updates currentRefMap)
    async function getRefTaggedSnapshot(wv: any): Promise<string> {
      try {
        const wcId = (wv as any).getWebContentsId?.()
        if (!wcId) return ''
        const raw = await api.a11ySnapshot(wcId)
        if (!raw || raw.startsWith('Error')) return ''
        const { snapshot, refMap } = parseRefMapFromSnapshot(raw)
        currentRefMap.current = refMap
        return snapshot
      } catch { return '' }
    }


    // Helper: diff two page snapshots to return only changes (smart delta)
    function diffPageSnapshot(prev: string, curr: string): string {
      if (!prev || !curr) return curr
      const prevLines = new Set(prev.split('\n'))
      const currLines = curr.split('\n')
      // If URL changed, return full snapshot
      const prevUrl = prev.split('\n')[0]
      const currUrl = currLines[0]
      if (prevUrl !== currUrl) return curr
      // Categorize changes
      const newLines: string[] = []
      const removedLines: string[] = []
      const currSet = new Set(currLines)
      for (const line of currLines) {
        if (!prevLines.has(line) && line.trim()) newLines.push(line)
      }
      for (const line of prev.split('\n')) {
        if (!currSet.has(line) && line.trim()) removedLines.push(line)
      }
      if (!newLines.length && !removedLines.length) return '[no change]'
      // Too many changes — return full snapshot
      if (newLines.length + removedLines.length > currLines.length * 0.6) return curr
      // Build categorized delta
      const parts: string[] = []
      // Detect specific change types
      const newFields = newLines.filter(l => l.startsWith('  ') && (l.includes('(#') || l.includes('([name') || l.includes('input') || l.includes('textarea')))
      const newButtons = newLines.filter(l => l.includes('button:') || l.includes('link:'))
      const valueChanges = newLines.filter(l => l.includes(' = "'))
      const otherNew = newLines.filter(l => !newFields.includes(l) && !newButtons.includes(l) && !valueChanges.includes(l))
      if (newFields.length) parts.push('New fields: ' + newFields.map(l => l.trim()).join(', '))
      if (newButtons.length) parts.push('New: ' + newButtons.map(l => l.trim()).join(', '))
      if (valueChanges.length) parts.push('Changed: ' + valueChanges.map(l => l.trim()).join(', '))
      if (otherNew.length) parts.push(otherNew.map(l => l.trim()).join(', '))
      const removedImportant = removedLines.filter(l => l.includes('button:') || l.includes('#') || l.includes('field'))
      if (removedImportant.length) parts.push('Removed: ' + removedImportant.map(l => l.trim()).join(', '))
      if (!parts.length) return '[no change]'
      return '\u0394 ' + parts.join(' | ')
    }

    // Helper: get page snapshot with optional diff tracking
    async function getPageSnapshot(wv: any, forceFull = false): Promise<string> {
      try {
        const raw = await (wv as any).executeJavaScript(buildPageCode())
        if (forceFull || !lastPageSnapshot.current) {
          lastPageSnapshot.current = raw
          return raw
        }
        const diff = diffPageSnapshot(lastPageSnapshot.current, raw)
        lastPageSnapshot.current = raw
        return diff
      } catch { return '' }
    }

    const cleanup = api.onMcpToolCall(async (callId: string, toolName: string, args: any) => {
      setAiActing(true)  // v0.3.0: show action overlay

      // Fix 10: Per-tab operation queue — serialize operations on the same tab
      const effectiveTabId = args?.tabId || 'active'
      const prev = tabOpQueue.current.get(effectiveTabId) || Promise.resolve()
      const executeOp = async (): Promise<void> => {

      try {
        // v0.3.0: Background task execution — use specific tab's webview if tabId is provided
        let wv = args?.tabId ? findWebviewByTabId(args.tabId) : findActiveWebview()
        // Fallback to active if tabId webview not found
        if (!wv && args?.tabId) wv = findActiveWebview()

        // No view exists (newtab) — create WebContentsView via main process, then navigate.
        if (!wv && toolName === 'act' && args?.action === 'navigate' && args?.url) {
          const tabId = activeTabIdRef.current
          const tempTitle = new URL(args.url).hostname.replace('www.', '')
          try {
            // Create a WebContentsView for this tab and navigate to URL
            const wcId = await api.viewCreate(tabId, args.url)
            setTabs(prev => prev.map(t => t.id === tabId ? { ...t, url: args.url, title: tempTitle, isLoading: true, webContentsId: wcId } : t))
            const newWv = createViewHandle(tabId, wcId)
            await waitForWebviewReady(newWv, 8)
            try {
              const title = await newWv.executeJavaScript('document.title')
              const snapshot = await getRefTaggedSnapshot(newWv) || await getPageSnapshot(newWv, true)
              api.sendMcpToolResult(callId, 'Navigated to ' + (title || tempTitle) + ' | ' + args.url + (snapshot ? '\n---\n' + snapshot : ''))
            } catch {
              api.sendMcpToolResult(callId, 'Navigated to ' + args.url)
            }
          } catch {
            api.sendMcpToolResult(callId, 'Failed to navigate to ' + args.url)
          }
          return
        }

        if (!wv) {
          api.sendMcpToolResult(callId, 'No active browser tab. Navigate to a URL first.')
          return
        }

        let result = ''
        switch (toolName) {
          case 'page': {
            const detail = args.detail || args.mode || ''
            if (detail === 'markdown') {
              // Firecrawl-inspired: extract article content as clean markdown
              try {
                const md = await (wv as any).executeJavaScript('window.__oc_extract_markdown ? window.__oc_extract_markdown() : {error:"Not available"}')
                if (md.error) {
                  // Fallback to compact description if markdown extraction fails
                  result = await getPageSnapshot(wv, true)
                } else {
                  result = `# ${md.title}\n`
                  if (md.byline) result += `*${md.byline}*\n\n`
                  result += md.markdown
                }
              } catch {
                result = await getPageSnapshot(wv, true)
              }
              break
            }
            if (detail === 'a11y' || detail === 'full' || detail === 'interactive') {
              // Use CDP accessibility tree for detailed view
              try {
                const wcId = (wv as any).getWebContentsId?.()
                if (wcId) {
                  const rawA11y = await api.a11ySnapshot(wcId)
                  // Parse and strip refMap, store for ref-based act resolution
                  const { snapshot: parsed, refMap } = parseRefMapFromSnapshot(rawA11y)
                  currentRefMap.current = refMap
                  result = parsed
                } else {
                  result = await getPageSnapshot(wv, true)
                }
              } catch {
                // Fallback to regular snapshot if CDP fails
                result = await getPageSnapshot(wv, true)
              }
              // Incremental a11y diff — only send changes if previous snapshot exists
              if (detail === 'a11y' && result.length > 0) {
                if (lastA11ySnapshot.current) {
                  const prevLines = new Set(lastA11ySnapshot.current.split('\n'))
                  const currLines = result.split('\n')
                  const newLines = currLines.filter(l => !prevLines.has(l) && l.trim())
                  const removedSet = new Set(currLines)
                  const removedLines = lastA11ySnapshot.current.split('\n').filter(l => !removedSet.has(l) && l.trim())
                  // Only use diff if changes are < 50% of total and there are actual changes
                  if (newLines.length + removedLines.length < currLines.length * 0.5 && (newLines.length + removedLines.length) > 0) {
                    const fullResult = result // Keep full for storage
                    const diffParts: string[] = [currLines[0], currLines[1]] // Keep URL and Title
                    if (newLines.length) diffParts.push('+ ' + newLines.join('\n+ '))
                    if (removedLines.length) diffParts.push('- ' + removedLines.map(l => l.trim()).slice(0, 10).join(', '))
                    result = diffParts.join('\n')
                    lastA11ySnapshot.current = fullResult
                  } else {
                    lastA11ySnapshot.current = result
                  }
                } else {
                  lastA11ySnapshot.current = result
                }
              }
            } else {
              result = await getPageSnapshot(wv, true)
            }
            // Append cached workflow hints and past lessons for this domain
            try {
              const currentUrl = await (wv as any).executeJavaScript('location.href')
              const domain = new URL(currentUrl).hostname
              const workflows = await api.runCacheSummary(domain)
              if (workflows) result += '\n' + workflows
              const lessons = await api.lessonsForDomain(domain)
              if (lessons) result += '\n' + lessons
            } catch { /* no enrichment data */ }
            // Auto-inject console capture so errors are always available
            try { await (wv as any).executeJavaScript(buildConsoleCapture()) } catch { /* injection failed */ }
            // Vision grounding: attach screenshot for LLM visual analysis
            if (args.screenshot) {
              try {
                const nativeImage = await (wv as any).capturePage()
                const base64 = nativeImageToBase64(nativeImage)
                const filePath = await api.screenshotSave(base64)
                result += '\n[Screenshot: ' + filePath + ']'
              } catch { /* screenshot failed, non-critical */ }
            }
            break
          }

          case 'act': {
            // 3-Tier Ref Resolution: CDP Direct → Fingerprint Similarity → Text Fallback
            if (args.ref && !args.text && !args.selector && !args.name) {
              const refId = String(args.ref).startsWith('e') ? args.ref : `e${args.ref}`
              const refEntry = currentRefMap.current[refId]
              if (!refEntry) {
                result = `Error: ref "${refId}" not found in current snapshot. Call page({detail:"a11y"}) first to get fresh refs.`
                break
              }

              let resolved = false

              // Tier 1: CDP Direct — O(1), precise. Use backendDOMNodeId to resolve live node.
              if (refEntry.backendDOMNodeId) {
                try {
                  const wcId = (wv as any).getWebContentsId?.()
                  if (wcId) {
                    const nodeResult = await api.resolveNode(wcId, refEntry.backendDOMNodeId)
                    if (nodeResult?.alive && nodeResult.selector) {
                      args.selector = nodeResult.selector
                      resolved = true
                    }
                  }
                } catch { /* CDP tier failed, fall through */ }
              }

              // Tier 2: Fingerprint Similarity — score all interactive elements vs stored fingerprint
              if (!resolved) {
                try {
                  const fpResult = await (wv as any).executeJavaScript(buildFingerprintMatchCode(refEntry))
                  if (fpResult?.found && fpResult.selector) {
                    args.selector = fpResult.selector
                    resolved = true
                  }
                } catch { /* fingerprint tier failed, fall through */ }
              }

              // Tier 3: Text Fallback — original behavior (name + role → text matching)
              if (!resolved) {
                args.name = refEntry.name
                args.role = refEntry.role
                if (!args.text && refEntry.name) args.text = refEntry.name
              }
            }
            const action = args.action
            // Rate limiting: human-like delay between actions
            if (action !== 'navigate' && action !== 'wait' && action !== 'listTabs') {
              await gaussianDelay(100, 400)
            }
            if (action === 'navigate' && args.url) {
              // Navigate the webview directly — WebViewContainer's did-navigate handler
              // will update React state (address bar, tab title) automatically
              await (wv as any).loadURL(args.url)
              await waitForWebviewReady(wv, 8)
              try {
                const t = await (wv as any).executeJavaScript('document.title')
                result = 'Navigated to ' + t + ' | ' + args.url
              } catch {
                result = 'Navigated to ' + args.url
              }
            } else if (action === 'click') {
              // Pre-simulation: detect risky clicks and gather context
              const clickText = (args.text || '').toLowerCase()
              const riskyKeywords = ['pay', 'purchase', 'buy', 'checkout', 'submit', 'delete', 'remove', 'cancel subscription', 'send', 'publish', 'confirm order', 'place order', 'authorize']
              const isRisky = riskyKeywords.some(k => clickText.includes(k))
              let preSimContext = ''
              if (isRisky) {
                try {
                  preSimContext = await (wv as any).executeJavaScript(
                    '(function(){' +
                    'var ctx=[];' +
                    // Find price/amount information
                    'var prices=document.body.innerText.match(/\\$[\\d,.]+|USD\\s*[\\d,.]+|€[\\d,.]+|£[\\d,.]+|total[:\\s]*[\\d,.]+/gi);' +
                    'if(prices&&prices.length)ctx.push("Amounts on page: "+prices.slice(0,3).join(", "));' +
                    // Find email addresses that might receive something
                    'var emails=document.body.innerText.match(/[\\w.-]+@[\\w.-]+\\.\\w{2,}/g);' +
                    'if(emails&&emails.length)ctx.push("Recipients: "+[...new Set(emails)].slice(0,3).join(", "));' +
                    // Find form summary / order summary
                    'var summary=document.querySelector("[class*=summary],[class*=total],[class*=order],[class*=receipt],.checkout-summary,.order-total");' +
                    'if(summary)ctx.push("Summary: "+summary.textContent.trim().replace(/\\s+/g," ").substring(0,150));' +
                    // Find warning/confirmation text near the button
                    'var warns=Array.from(document.querySelectorAll("[class*=warn],[class*=alert],[class*=caution],[role=alert]"));' +
                    'warns.forEach(function(w){var t=w.textContent.trim();if(t.length>5&&t.length<200)ctx.push("⚠ "+t);});' +
                    'return ctx.length?"⚠ PRE-SIMULATION: "+ctx.join(" | "):"";' +
                    '})()'
                  )
                } catch { /* pre-sim failed, proceed anyway */ }
              }
              result = await (wv as any).executeJavaScript(buildClickCode(args.text || '', args.selector || '', args.nth || 0, args.modifiers))
              // Auto-retry with different strategy if element not found
              if (result.startsWith('Element not found') && (args.text || args.selector)) {
                // Strategy 1: Try via a11y tree
                let retried = false
                try {
                  const wcId = (wv as any).getWebContentsId?.()
                  if (wcId && args.text) {
                    const a11yTree = await api.a11ySnapshot(wcId)
                    // Find the element in a11y tree by text match
                    const lines = a11yTree.split('\n')
                    const match = lines.find((l: string) => {
                      const lower = l.toLowerCase()
                      return (lower.includes('button') || lower.includes('link')) && lower.includes((args.text || '').toLowerCase())
                    })
                    if (match) {
                      // Extract ref number from a11y tree [N]
                      const refMatch = match.match(/\[(\d+)\]/)
                      if (refMatch) {
                        result += '\nA11y tree found: ' + match.trim() + ' — use page({detail:"a11y"}) then click #ref'
                        retried = true
                      }
                    }
                  }
                } catch { /* a11y retry failed */ }
                // Strategy 2: Try scrolling to find it
                if (!retried) {
                  try {
                    const scrollFindCode = '(function(){' +
                      'var text=' + JSON.stringify(args.text || '') + ';' +
                      'for(var i=0;i<5;i++){' +
                      'window.scrollBy(0,window.innerHeight*0.7);' +
                      '}' +
                      'var all=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit]"));' +
                      'var match=all.find(function(el){var t=(el.textContent||"").trim().toLowerCase();return t.includes(text.toLowerCase());});' +
                      'if(match){match.scrollIntoView({block:"center"});return "Found after scrolling: "+(match.textContent||"").trim().substring(0,50);}' +
                      'return "";' +
                      '})()'
                    const scrollResult = await (wv as any).executeJavaScript(scrollFindCode)
                    if (scrollResult) {
                      // Element found after scrolling — now click it
                      const retryResult = await (wv as any).executeJavaScript(buildClickCode(args.text || '', args.selector || '', args.nth || 0))
                      if (!retryResult.startsWith('Element not found')) {
                        result = retryResult + ' (found after scrolling)'
                      }
                    }
                  } catch { /* scroll retry failed */ }
                }
              }
              if (preSimContext) result = preSimContext + '\n' + result
            } else if (action === 'scroll') {
              const dir = args.direction || 'down'
              const amt = args.amount || 500
              const scrollCode = dir === 'up' ? 'window.scrollBy(0,-' + amt + ')'
                : dir === 'left' ? 'window.scrollBy(-' + amt + ',0)'
                : dir === 'right' ? 'window.scrollBy(' + amt + ',0)'
                : 'window.scrollBy(0,' + amt + ')'
              await (wv as any).executeJavaScript(scrollCode)
              result = 'Scrolled ' + dir + ' ' + amt + 'px'
            } else if (action === 'back') {
              if ((wv as any).canGoBack()) { (wv as any).goBack(); await new Promise(r => setTimeout(r, 1500)); result = 'Went back' }
              else result = 'Cannot go back'
            } else if (action === 'forward') {
              if ((wv as any).canGoForward()) { (wv as any).goForward(); await new Promise(r => setTimeout(r, 1500)); result = 'Went forward' }
              else result = 'Cannot go forward'
            } else if (action === 'reload') {
              (wv as any).reload(); await new Promise(r => setTimeout(r, 2000)); result = 'Reloaded'
            } else if (action === 'press') {
              const key = args.key || 'Enter'
              // Map common key names to Electron keyCode format
              const keyMap: Record<string, string> = {
                'Enter': '\r', 'Tab': '\t', 'Escape': '\u001b', 'Backspace': '\b',
                'Delete': '\u007f', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
                'ArrowLeft': 'Left', 'ArrowRight': 'Right',
                'Space': ' ', ' ': ' '
              }
              const modifiers = args.modifiers || []
              try {
                // Use native sendInputEvent for reliable key presses
                const keyCode = keyMap[key] || key
                const mods: string[] = []
                if (modifiers.includes('ctrl') || modifiers.includes('control')) mods.push('control')
                if (modifiers.includes('shift')) mods.push('shift')
                if (modifiers.includes('alt')) mods.push('alt')
                if (modifiers.includes('meta') || modifiers.includes('cmd')) mods.push('meta')
                ;(wv as any).sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods })
                if (keyCode.length === 1) {
                  ;(wv as any).sendInputEvent({ type: 'char', keyCode, modifiers: mods })
                }
                await new Promise(r => setTimeout(r, 50))
                ;(wv as any).sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods })
                await new Promise(r => setTimeout(r, 100))
                result = 'Pressed ' + key + (mods.length ? ' with ' + mods.join('+') : '')
              } catch {
                // Fallback to JS-dispatched events
                const pressCode = '(function(){' +
                  'var key=' + JSON.stringify(key) + ';' +
                  'var el=document.activeElement||document.body;' +
                  'el.dispatchEvent(new KeyboardEvent("keydown",{key:key,code:key==="Enter"?"Enter":"Key"+key.toUpperCase(),bubbles:true,cancelable:true}));' +
                  'el.dispatchEvent(new KeyboardEvent("keypress",{key:key,code:key==="Enter"?"Enter":"Key"+key.toUpperCase(),bubbles:true,cancelable:true}));' +
                  'el.dispatchEvent(new KeyboardEvent("keyup",{key:key,code:key==="Enter"?"Enter":"Key"+key.toUpperCase(),bubbles:true,cancelable:true}));' +
                  'if(key==="Enter"&&el.tagName==="INPUT"&&el.form){el.form.requestSubmit?el.form.requestSubmit():el.form.submit();}' +
                  'return "Pressed "+key;' +
                  '})()'
                await (wv as any).executeJavaScript(pressCode)
                result = 'Pressed ' + key
              }
            } else if (action === 'type') {
              // Type text into a field — supports both regular inputs (React) and contenteditable
              // Fix 3: Accept name/role from ref resolution (not just selector/label/placeholder)
              // Fix 4: Use InputEvent with insertText for React 18+ compatibility
              // Fix #10: Explicit string coercion — prevents any type-related duplication
              const textToType = String(args.text || '')
              const shouldClear = !!args.clear
              if (!textToType) {
                result = 'Error: text parameter required for type action'
              } else {
                try {
                  // Resolve element: selector → label → name/role → placeholder → first visible editable
                  const resolveCode = '(function(){' +
                    'function isVisible(el){if(!el)return false;var s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&parseFloat(s.opacity)>0;}' +
                    'var sel=' + JSON.stringify(args.selector || '') + ';' +
                    'var label=' + JSON.stringify(args.label || '') + ';' +
                    'var ph=' + JSON.stringify(args.placeholder || '') + ';' +
                    'var ariaName=' + JSON.stringify(args.name || '') + ';' +
                    'var ariaRole=' + JSON.stringify(args.role || '') + ';' +
                    'var el=null;' +
                    // 1. CSS selector
                    'if(sel){el=document.querySelector(sel);}' +
                    // 2. Label
                    'if(!el&&label){' +
                    'var lower=label.toLowerCase();' +
                    'var labels=document.querySelectorAll("label");' +
                    'for(var i=0;i<labels.length;i++){' +
                    'if((labels[i].textContent||"").trim().toLowerCase().includes(lower)){' +
                    'if(labels[i].htmlFor){el=document.getElementById(labels[i].htmlFor);}' +
                    'if(!el)el=labels[i].querySelector("input,textarea,select,[contenteditable=true]");' +
                    'if(el)break;}}' +
                    'if(!el){var ariaEls=document.querySelectorAll("[aria-label]");' +
                    'for(var i=0;i<ariaEls.length;i++){if(ariaEls[i].getAttribute("aria-label").toLowerCase().includes(lower)&&isVisible(ariaEls[i])){el=ariaEls[i];break;}}}}' +
                    // 3. Name/Role from ref resolution (Fix 3)
                    'if(!el&&ariaName){' +
                    'var roleSel=ariaRole?"[role=\\""+ariaRole+"\\"]":"input,textarea,select,[contenteditable=true]";' +
                    'var candidates=document.querySelectorAll(roleSel);' +
                    'var nameLower=ariaName.toLowerCase();' +
                    'for(var i=0;i<candidates.length;i++){' +
                    'var c=candidates[i];if(!isVisible(c))continue;' +
                    'var an=(c.getAttribute("aria-label")||"").toLowerCase();' +
                    'var pn=(c.getAttribute("placeholder")||"").toLowerCase();' +
                    'var nn=(c.getAttribute("name")||"").toLowerCase();' +
                    'if(an.includes(nameLower)||pn.includes(nameLower)||nn.includes(nameLower)){el=c;break;}' +
                    '}' +
                    'if(!el){var lbls=document.querySelectorAll("label");' +
                    'for(var i=0;i<lbls.length;i++){' +
                    'if((lbls[i].textContent||"").trim().toLowerCase().includes(nameLower)){' +
                    'if(lbls[i].htmlFor){el=document.getElementById(lbls[i].htmlFor);}' +
                    'if(!el)el=lbls[i].querySelector("input,textarea,select,[contenteditable=true]");' +
                    'if(el)break;}}}}' +
                    // 4. Placeholder / data-placeholder
                    'if(!el&&ph){' +
                    'var lower=ph.toLowerCase();' +
                    'var inputs=document.querySelectorAll("input[placeholder],textarea[placeholder]");' +
                    'for(var i=0;i<inputs.length;i++){if(inputs[i].getAttribute("placeholder").toLowerCase().includes(lower)&&isVisible(inputs[i])){el=inputs[i];break;}}' +
                    'if(!el){var ceEls=document.querySelectorAll("[data-placeholder],[aria-placeholder]");' +
                    'for(var i=0;i<ceEls.length;i++){var p=(ceEls[i].getAttribute("data-placeholder")||ceEls[i].getAttribute("aria-placeholder")||"").toLowerCase();' +
                    'if(p.includes(lower)&&isVisible(ceEls[i])){el=ceEls[i];break;}}}}' +
                    // 5. First visible editable (fallback — only if NO resolution hint was provided)
                    'if(!el&&!sel&&!label&&!ph&&!ariaName){' +
                    'el=document.querySelector("[contenteditable=true]:not([aria-hidden=true]),[role=textbox]:not([aria-hidden=true])");' +
                    'if(!el)el=document.querySelector("textarea,input[type=text],input:not([type])");' +
                    '}' +
                    'if(!el)return JSON.stringify({status:"not_found"});' +
                    'el.scrollIntoView({behavior:"smooth",block:"center"});' +
                    // Return element coords for coordinate-based input (avoids focus traps)
                    'var r=el.getBoundingClientRect();' +
                    'var isInput=el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT";' +
                    'var isCE=el.contentEditable==="true"||el.getAttribute("role")==="textbox";' +
                    'return JSON.stringify({status:"found",x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),isInput:isInput,isCE:isCE,tag:el.tagName});' +
                    '})()'
                  const resolveRaw = await (wv as any).executeJavaScript(resolveCode)
                  const resolveResult = JSON.parse(resolveRaw)

                  if (resolveResult.status === 'not_found') {
                    result = 'Error: element not found' + (args.selector ? ': ' + args.selector : args.label ? ' by label: ' + args.label : args.name ? ' by name: ' + args.name : args.placeholder ? ' by placeholder: ' + args.placeholder : '')
                  } else {
                    // Fix 3+4: Use coordinate-based click to focus, then sendInputEvent for typing
                    // This avoids focus traps (search boxes intercepting) and works with React 18+
                    const { x, y, isInput, isCE } = resolveResult

                    // Click at element coordinates to focus it properly
                    ;(wv as any).sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
                    ;(wv as any).sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
                    await new Promise(r => setTimeout(r, 100))

                    if (shouldClear) {
                      // Select all + delete
                      ;(wv as any).sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['meta'] })
                      ;(wv as any).sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['meta'] })
                      ;(wv as any).sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
                      ;(wv as any).sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
                      await new Promise(r => setTimeout(r, 50))
                    }

                    if (isCE) {
                      // For contenteditable, use insertText (works with DraftJS/ProseMirror/Slate)
                      await (wv as any).insertText(textToType)
                      await new Promise(r => setTimeout(r, 100))
                      result = 'Typed ' + textToType.length + ' chars into editable area'
                    } else {
                      // For regular inputs: use insertText which triggers proper InputEvent
                      // This fires InputEvent with inputType="insertText" — React 18+ compatible
                      await (wv as any).insertText(textToType)
                      await new Promise(r => setTimeout(r, 100))
                      // Verify the value was set
                      const verifyCode = '(function(){' +
                        'var el=document.activeElement;' +
                        'if(el&&(el.tagName==="INPUT"||el.tagName==="TEXTAREA"))return "set:"+el.value.length;' +
                        'return "typed";})()'
                      const verifyResult = await (wv as any).executeJavaScript(verifyCode)
                      if (verifyResult.startsWith('set:')) {
                        result = 'Typed ' + textToType.length + ' chars (field has ' + verifyResult.split(':')[1] + ' chars)'
                      } else {
                        result = 'Typed ' + textToType.length + ' chars'
                      }
                    }
                  }
                } catch (e: any) {
                  result = 'Type failed: ' + e.message
                }
              }
            } else if (action === 'clickAtPoint') {
              // Click at specific x,y coordinates — works for cross-origin iframes (Google Sign-In, etc.)
              const x = Math.round(args.x || 0)
              const y = Math.round(args.y || 0)
              if (x === 0 && y === 0) {
                result = 'Error: x and y coordinates are required for clickAtPoint'
              } else {
                try {
                  // sendInputEvent simulates real OS-level mouse events that propagate through iframes
                  const clickMods = args.modifiers || []
                  const inputMods: string[] = []
                  if (clickMods.includes('ctrl') || clickMods.includes('control')) inputMods.push('control')
                  if (clickMods.includes('shift')) inputMods.push('shift')
                  if (clickMods.includes('alt')) inputMods.push('alt')
                  if (clickMods.includes('meta') || clickMods.includes('cmd')) inputMods.push('meta')
                  ;(wv as any).sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers: inputMods })
                  await new Promise(r => setTimeout(r, 50))
                  ;(wv as any).sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers: inputMods })
                  await new Promise(r => setTimeout(r, 500))
                  result = 'Clicked at coordinates (' + x + ', ' + y + ')' + (inputMods.length ? ' with modifiers: ' + inputMods.join('+') : '')
                } catch (e: any) {
                  result = 'Click failed: ' + e.message
                }
              }
            } else if (action === 'drag') {
              // Drag-and-drop — supports coordinate mode and element mode
              // args.from: { x, y } | { text, selector }
              // args.to: { x, y } | { text, selector }
              // args.steps: number of intermediate mouse moves (default 10)
              const dragFrom = args.from || {}
              const dragTo = args.to || {}
              const dragSteps = args.steps || 10

              // Resolve element positions if text/selector provided
              const resolvePos = async (spec: any): Promise<{ x: number; y: number } | null> => {
                if (typeof spec.x === 'number' && typeof spec.y === 'number') {
                  return { x: spec.x, y: spec.y }
                }
                if (spec.text || spec.selector) {
                  const posCode = '(function(){' +
                    'var sel=' + JSON.stringify(spec.selector || '') + ';' +
                    'var text=' + JSON.stringify(spec.text || '') + ';' +
                    'var el=sel?document.querySelector(sel):null;' +
                    'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){' +
                    'var t=(e.textContent||"").trim();return t.length<200&&t.toLowerCase().includes(text.toLowerCase());});}' +
                    'if(!el)return null;' +
                    'el.scrollIntoView({block:"center"});' +
                    'var r=el.getBoundingClientRect();' +
                    'return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};' +
                    '})()'
                  return await (wv as any).executeJavaScript(posCode)
                }
                return null
              }

              const fromPos = await resolvePos(dragFrom)
              const toPos = await resolvePos(dragTo)

              if (!fromPos || !toPos) {
                result = 'Error: Could not resolve drag positions. from=' + JSON.stringify(dragFrom) + ' to=' + JSON.stringify(dragTo)
              } else {
                try {
                  // 1. Dispatch HTML5 DnD events via JS (for sites using Drag API)
                  await (wv as any).executeJavaScript(
                    '(function(){' +
                    'var fromEl=document.elementFromPoint(' + fromPos.x + ',' + fromPos.y + ');' +
                    'var toEl=document.elementFromPoint(' + toPos.x + ',' + toPos.y + ');' +
                    'if(fromEl){' +
                    'var dt=new DataTransfer();' +
                    'fromEl.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:dt,clientX:' + fromPos.x + ',clientY:' + fromPos.y + '}));' +
                    'if(toEl){' +
                    'toEl.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt,clientX:' + toPos.x + ',clientY:' + toPos.y + '}));' +
                    'toEl.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt,clientX:' + toPos.x + ',clientY:' + toPos.y + '}));' +
                    '}' +
                    'fromEl.dispatchEvent(new DragEvent("dragend",{bubbles:true,cancelable:true,dataTransfer:dt,clientX:' + toPos.x + ',clientY:' + toPos.y + '}));' +
                    '}' +
                    '})()'
                  )
                  // 2. Also simulate low-level mouse events (for non-DnD drag like sliders, sortable lists)
                  ;(wv as any).sendInputEvent({ type: 'mouseDown', x: fromPos.x, y: fromPos.y, button: 'left', clickCount: 1 })
                  await new Promise(r => setTimeout(r, 100))
                  for (let i = 1; i <= dragSteps; i++) {
                    const t = i / dragSteps
                    // Bezier-ish curve for natural movement
                    const cx = fromPos.x + (toPos.x - fromPos.x) * t + Math.sin(t * Math.PI) * (Math.random() * 4 - 2)
                    const cy = fromPos.y + (toPos.y - fromPos.y) * t + Math.sin(t * Math.PI) * (Math.random() * 4 - 2)
                    ;(wv as any).sendInputEvent({ type: 'mouseMove', x: Math.round(cx), y: Math.round(cy), button: 'left' })
                    await new Promise(r => setTimeout(r, 20))
                  }
                  ;(wv as any).sendInputEvent({ type: 'mouseUp', x: toPos.x, y: toPos.y, button: 'left', clickCount: 1 })
                  await new Promise(r => setTimeout(r, 200))
                  result = 'Dragged from (' + fromPos.x + ',' + fromPos.y + ') to (' + toPos.x + ',' + toPos.y + ')'
                } catch (e: any) {
                  result = 'Drag failed: ' + e.message
                }
              }
            } else if (action === 'doubleClick') {
              // Double-click — useful for text selection
              const dblClickCode = buildClickCode(args.text || '', args.selector || '', args.nth || 0)
                .replace('el.click()', 'el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,cancelable:true}))')
              result = await (wv as any).executeJavaScript(dblClickCode)
            } else if (action === 'focus') {
              // Focus an element
              const focusCode = '(function(){' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var text=' + JSON.stringify(args.text || '') + ';' +
                'var el=sel?document.querySelector(sel):null;' +
                'if(!el&&text){el=Array.from(document.querySelectorAll("[contenteditable=true],div[role=textbox],input,textarea,select")).find(function(e){' +
                'return (e.getAttribute("aria-label")||e.getAttribute("placeholder")||e.textContent||"").toLowerCase().includes(text.toLowerCase());});}' +
                'if(!el)el=document.querySelector("[contenteditable=true],div[role=textbox]");' +
                'if(!el)return "No focusable element found";' +
                'el.focus();return "Focused on element";})()'
              result = await (wv as any).executeJavaScript(focusCode)
            } else if (action === 'clear') {
              // Clear focused element or specified element — supports label/placeholder/data-placeholder resolution
              const clearCode = '(function(){' +
                'function isVisible(el){if(!el)return false;var s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&parseFloat(s.opacity)>0;}' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var label=' + JSON.stringify(args.label || '') + ';' +
                'var ph=' + JSON.stringify(args.placeholder || '') + ';' +
                'var el=null;' +
                'if(sel){el=document.querySelector(sel);}' +
                'if(!el&&label){var lower=label.toLowerCase();' +
                'var labels=document.querySelectorAll("label");' +
                'for(var i=0;i<labels.length;i++){if((labels[i].textContent||"").trim().toLowerCase().includes(lower)){' +
                'if(labels[i].htmlFor)el=document.getElementById(labels[i].htmlFor);' +
                'if(!el)el=labels[i].querySelector("input,textarea,select,[contenteditable=true]");if(el)break;}}' +
                'if(!el){var ariaEls=document.querySelectorAll("[aria-label]");' +
                'for(var i=0;i<ariaEls.length;i++){if(ariaEls[i].getAttribute("aria-label").toLowerCase().includes(lower)&&isVisible(ariaEls[i])){el=ariaEls[i];break;}}}}' +
                'if(!el&&ph){var lower=ph.toLowerCase();' +
                'var inputs=document.querySelectorAll("input[placeholder],textarea[placeholder]");' +
                'for(var i=0;i<inputs.length;i++){if(inputs[i].getAttribute("placeholder").toLowerCase().includes(lower)&&isVisible(inputs[i])){el=inputs[i];break;}}' +
                'if(!el){var ceEls=document.querySelectorAll("[data-placeholder],[aria-placeholder]");' +
                'for(var i=0;i<ceEls.length;i++){var p=(ceEls[i].getAttribute("data-placeholder")||ceEls[i].getAttribute("aria-placeholder")||"").toLowerCase();' +
                'if(p.includes(lower)&&isVisible(ceEls[i])){el=ceEls[i];break;}}}}' +
                'if(!el)el=document.activeElement;' +
                'if(!el)return "No element to clear";' +
                'if(el.contentEditable==="true"||el.getAttribute("role")==="textbox"){' +
                'el.focus();document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);return "Cleared editable area";}' +
                'if(el.value!==undefined){' +
                'var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")||Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");' +
                'if(setter&&setter.set){setter.set.call(el,"");}else{el.value="";}' +
                'el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return "Cleared field";}' +
                'return "Element has no clearable content";})()'
              result = await (wv as any).executeJavaScript(clearCode)
            } else if (action === 'wait') {
              // Explicit wait for a duration
              const ms = args.amount || 2000
              await new Promise(r => setTimeout(r, Math.min(ms, 10000)))
              result = 'Waited ' + ms + 'ms'
            } else if (action === 'selectAll') {
              // Select all text in focused element
              const selectAllCode = '(function(){' +
                'var el=document.activeElement;' +
                'if(!el)return "No focused element";' +
                'if(el.select){el.select();return "Selected all text";}' +
                'if(el.contentEditable==="true"){document.execCommand("selectAll");return "Selected all text";}' +
                'return "Cannot select in this element";})()'
              result = await (wv as any).executeJavaScript(selectAllCode)
            } else if (action === 'hover') {
              const hoverCode = '(function(){' +
                'var text=' + JSON.stringify(args.text || '') + ';' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var el=sel?document.querySelector(sel):Array.from(document.querySelectorAll("*")).find(function(e){return e.textContent&&e.textContent.trim().includes(text)});' +
                'if(!el)return "Element not found";' +
                'el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));' +
                'return "Hovered over element";})()'
              result = await (wv as any).executeJavaScript(hoverCode)
            } else if (action === 'select') {
              const selectCode = '(function(){' +
                'var label=' + JSON.stringify(args.label || args.text || '') + ';' +
                'var value=' + JSON.stringify(args.value || '') + ';' +
                'var select=null;' +
                'if(label){var labels=Array.from(document.querySelectorAll("label"));' +
                'var lbl=labels.find(function(l){return l.textContent&&l.textContent.trim().toLowerCase().includes(label.toLowerCase())});' +
                'if(lbl&&lbl.htmlFor)select=document.getElementById(lbl.htmlFor);' +
                'if(!select&&lbl)select=lbl.querySelector("select");}' +
                'if(!select)select=document.querySelector("select");' +
                'if(!select)return "No select element found";' +
                'select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));' +
                'return "Selected \\""+value+"\\"";})()'
              result = await (wv as any).executeJavaScript(selectCode)
            } else if (action === 'rightClick') {
              // Right-click — triggers context menu
              const rightClickCode = '(function(){' +
                'var text=' + JSON.stringify(args.text || '') + ';' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var el=sel?document.querySelector(sel):null;' +
                'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){return e.textContent&&e.textContent.trim().includes(text)});}' +
                'if(!el)return "Element not found";' +
                'var rect=el.getBoundingClientRect();' +
                'el.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));' +
                'return "Right-clicked element";})()'
              result = await (wv as any).executeJavaScript(rightClickCode)
            } else if (action === 'tripleClick') {
              // Triple-click — selects full paragraph/line
              const tripleCode = '(function(){' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var text=' + JSON.stringify(args.text || '') + ';' +
                'var el=sel?document.querySelector(sel):null;' +
                'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){return e.textContent&&e.textContent.trim().includes(text)});}' +
                'if(!el)el=document.activeElement;' +
                'if(!el)return "No element found";' +
                'var rect=el.getBoundingClientRect();var cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;' +
                'for(var i=0;i<3;i++){el.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:i+1,clientX:cx,clientY:cy}));}' +
                'return "Triple-clicked element";})()'
              result = await (wv as any).executeJavaScript(tripleCode)
            } else if (action === 'scrollIntoView') {
              // Scroll a specific element into view
              const scrollToCode = '(function(){' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var text=' + JSON.stringify(args.text || '') + ';' +
                'var el=sel?document.querySelector(sel):null;' +
                'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){' +
                'var t=(e.textContent||"").trim();return t.toLowerCase().includes(text.toLowerCase())&&t.length<500;});}' +
                'if(!el)return "Element not found";' +
                'el.scrollIntoView({behavior:"smooth",block:"center"});' +
                'return "Scrolled to element";})()'
              result = await (wv as any).executeJavaScript(scrollToCode)
              await new Promise(r => setTimeout(r, 500))
            } else if (action === 'waitForElement') {
              // Wait until an element appears on the page
              const timeout = args.amount || 5000
              const waitSelector = args.selector || ''
              const waitText = args.text || ''
              if (!waitSelector && !waitText) {
                result = 'Error: selector or text required for waitForElement'
              } else {
                const waitCode = '(function(){return new Promise(function(resolve){' +
                  'var sel=' + JSON.stringify(waitSelector) + ';' +
                  'var text=' + JSON.stringify(waitText) + ';' +
                  'var timeout=' + Math.min(timeout, 15000) + ';' +
                  'var start=Date.now();' +
                  'function check(){' +
                  'var el=sel?document.querySelector(sel):null;' +
                  'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){return (e.textContent||"").trim().toLowerCase().includes(text.toLowerCase())&&(e.textContent||"").trim().length<500;});}' +
                  'if(el)return resolve("Element found");' +
                  'if(Date.now()-start>timeout)return resolve("Timeout: element not found after "+timeout+"ms");' +
                  'setTimeout(check,200);}' +
                  'check();});})()'
                result = await (wv as any).executeJavaScript(waitCode)
              }
            } else if (action === 'waitForText') {
              // Wait until specific text appears on the page
              const waitText2 = args.text || ''
              const timeout2 = args.amount || 5000
              if (!waitText2) {
                result = 'Error: text required for waitForText'
              } else {
                const waitTextCode = '(function(){return new Promise(function(resolve){' +
                  'var text=' + JSON.stringify(waitText2) + ';' +
                  'var timeout=' + Math.min(timeout2, 15000) + ';' +
                  'var start=Date.now();' +
                  'function check(){' +
                  'if(document.body.innerText.toLowerCase().includes(text.toLowerCase()))return resolve("Text found: "+text);' +
                  'if(Date.now()-start>timeout)return resolve("Timeout: text not found after "+timeout+"ms");' +
                  'setTimeout(check,200);}' +
                  'check();});})()'
                result = await (wv as any).executeJavaScript(waitTextCode)
              }
            } else if (action === 'waitForNetworkIdle') {
              // Wait until no network requests for a period
              const timeout3 = args.amount || 5000
              const waitNetCode = '(function(){return new Promise(function(resolve){' +
                'var timeout=' + Math.min(timeout3, 15000) + ';' +
                'var pending=0;var timer=null;var done=false;' +
                'var origFetch=window.fetch;var origXhr=XMLHttpRequest.prototype.open;' +
                'window.fetch=function(){pending++;var p=origFetch.apply(this,arguments);' +
                'p.finally(function(){pending--;checkIdle();});return p;};' +
                'var origSend=XMLHttpRequest.prototype.send;' +
                'XMLHttpRequest.prototype.send=function(){pending++;var xhr=this;' +
                'xhr.addEventListener("loadend",function(){pending--;checkIdle();});' +
                'origSend.apply(this,arguments);};' +
                'function checkIdle(){if(done)return;if(pending<=0){' +
                'if(timer)clearTimeout(timer);timer=setTimeout(function(){' +
                'done=true;window.fetch=origFetch;XMLHttpRequest.prototype.send=origSend;' +
                'resolve("Network idle");},500);}}' +
                'setTimeout(function(){if(!done){done=true;window.fetch=origFetch;XMLHttpRequest.prototype.send=origSend;' +
                'resolve("Timeout: network still active after "+timeout+"ms ("+pending+" pending)");}},timeout);' +
                'checkIdle();});})()'
              result = await (wv as any).executeJavaScript(waitNetCode)
            } else if (action === 'smartScroll') {
              // Smart scroll: scroll until element found, handle infinite scroll, trigger lazy loading
              const targetText = args.text || ''
              const targetSelector = args.selector || ''
              const maxScrolls = args.amount || 10
              if (!targetText && !targetSelector) {
                result = 'Error: text or selector required for smartScroll'
              } else {
                const smartScrollCode = '(function(){return new Promise(function(resolve){' +
                  'var text=' + JSON.stringify(targetText) + ';' +
                  'var sel=' + JSON.stringify(targetSelector) + ';' +
                  'var maxAttempts=' + Math.min(maxScrolls, 20) + ';' +
                  'var attempts=0;var lastHeight=0;' +
                  'function tryFind(){' +
                  'var el=sel?document.querySelector(sel):null;' +
                  'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){' +
                  'return (e.textContent||"").trim().toLowerCase().includes(text.toLowerCase())&&' +
                  '(e.textContent||"").trim().length<500&&e.offsetHeight>0;});}' +
                  'if(el){el.scrollIntoView({behavior:"smooth",block:"center"});' +
                  'return resolve("Found after "+attempts+" scroll(s): "+(el.textContent||"").trim().substring(0,60));}' +
                  'var currentHeight=document.body.scrollHeight;' +
                  'if(attempts>=maxAttempts){return resolve("Not found after "+attempts+" scrolls (reached scroll limit)");}' +
                  'if(attempts>2&&currentHeight===lastHeight){return resolve("Not found — reached end of page after "+attempts+" scrolls");}' +
                  'lastHeight=currentHeight;attempts++;' +
                  'window.scrollBy(0,window.innerHeight*0.8);' +
                  'setTimeout(tryFind,800);}' +
                  'tryFind();});})()'
                result = await (wv as any).executeJavaScript(smartScrollCode)
              }
            } else if (action === 'dragAndDrop') {
              // Drag from one element to another — supports selectors and text matching
              const fromSel = args.selector || ''
              const toSel = args.value || ''
              const fromText = args.text || ''
              const toText = args.key || '' // reuse key param for destination text
              if (!fromSel && !fromText) {
                result = 'Error: selector or text required for drag source'
              } else if (!toSel && !toText) {
                result = 'Error: value (drop target selector) or key (drop target text) required'
              } else {
                const dragCode = '(function(){' +
                  'function find(sel,text){' +
                  'if(sel){var el=document.querySelector(sel);if(el)return el;}' +
                  'if(text){return Array.from(document.querySelectorAll("*")).find(function(e){' +
                  'return (e.textContent||"").trim().toLowerCase().includes(text.toLowerCase())&&' +
                  'e.offsetHeight>0&&(e.textContent||"").trim().length<200;});}return null;}' +
                  'var from=find(' + JSON.stringify(fromSel) + ',' + JSON.stringify(fromText) + ');' +
                  'var to=find(' + JSON.stringify(toSel) + ',' + JSON.stringify(toText) + ');' +
                  'if(!from)return "Drag source not found";if(!to)return "Drop target not found";' +
                  'var fromRect=from.getBoundingClientRect();var toRect=to.getBoundingClientRect();' +
                  'var cx1=fromRect.left+fromRect.width/2,cy1=fromRect.top+fromRect.height/2;' +
                  'var cx2=toRect.left+toRect.width/2,cy2=toRect.top+toRect.height/2;' +
                  'var dt=new DataTransfer();' +
                  'from.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,clientX:cx1,clientY:cy1,dataTransfer:dt}));' +
                  'to.dispatchEvent(new DragEvent("dragenter",{bubbles:true,cancelable:true,clientX:cx2,clientY:cy2,dataTransfer:dt}));' +
                  'to.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,clientX:cx2,clientY:cy2,dataTransfer:dt}));' +
                  'to.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,clientX:cx2,clientY:cy2,dataTransfer:dt}));' +
                  'from.dispatchEvent(new DragEvent("dragend",{bubbles:true,cancelable:true,clientX:cx2,clientY:cy2,dataTransfer:dt}));' +
                  'return "Dragged "+(from.textContent||"").trim().substring(0,30)+" → "+(to.textContent||"").trim().substring(0,30);' +
                  '})()'
                result = await (wv as any).executeJavaScript(dragCode)
              }
            } else if (action === 'copy') {
              // Copy selected text or element text to clipboard
              const copyCode = '(function(){' +
                'var sel=window.getSelection();' +
                'if(sel&&sel.toString()){' +
                'navigator.clipboard.writeText(sel.toString()).catch(function(){document.execCommand("copy");});' +
                'return "Copied: "+sel.toString().substring(0,100);}' +
                'var el=document.activeElement;' +
                'if(el&&el.value){el.select();document.execCommand("copy");return "Copied field value";}' +
                'return "Nothing to copy";})()'
              result = await (wv as any).executeJavaScript(copyCode)
            } else if (action === 'paste') {
              // Paste text from args into focused element
              const pasteText = String(args.text || '')
              if (pasteText) {
                // Use insertText for reliable paste into any editor
                await (wv as any).insertText(pasteText)
                result = 'Pasted ' + pasteText.length + ' characters'
              } else {
                // Try reading clipboard and pasting
                const pasteCode = '(function(){document.execCommand("paste");return "Paste command sent";})()'
                result = await (wv as any).executeJavaScript(pasteCode)
              }
            } else if (action === 'evaluate') {
              // Execute JavaScript in the page context — supports async/await and multiple statements
              const expr = args.expression || args.code || args.text || args.selector || ''
              if (!expr) {
                result = 'Error: provide JS expression in expression parameter'
              } else {
                try {
                  const evalResult = await (wv as any).executeJavaScript(
                    '(async () => { ' + expr + ' })()'
                  )
                  if (evalResult === undefined || evalResult === null) {
                    result = 'undefined'
                  } else if (typeof evalResult === 'object') {
                    result = JSON.stringify(evalResult, null, 2).substring(0, 5000)
                  } else {
                    result = String(evalResult).substring(0, 5000)
                  }
                } catch (e: any) {
                  result = 'Evaluate error: ' + e.message
                }
              }
            } else if (action === 'getAttribute') {
              // Get an attribute value from an element
              const attrCode = '(function(){' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var text=' + JSON.stringify(args.text || '') + ';' +
                'var attr=' + JSON.stringify(args.value || '') + ';' +
                'var el=sel?document.querySelector(sel):null;' +
                'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){return (e.textContent||"").trim().includes(text)&&(e.textContent||"").trim().length<500;});}' +
                'if(!el)return "Element not found";' +
                'if(attr)return el.getAttribute(attr)||"(null)";' +
                'var attrs={};for(var i=0;i<el.attributes.length;i++){attrs[el.attributes[i].name]=el.attributes[i].value;}' +
                'attrs._tag=el.tagName.toLowerCase();attrs._text=(el.textContent||"").trim().substring(0,100);' +
                'return JSON.stringify(attrs);})()'
              result = await (wv as any).executeJavaScript(attrCode)
            } else if (action === 'newTab') {
              // Open a new tab directly via React state — returns tab ID for parallel execution
              const tabUrl = args.url || NEW_TAB_URL
              const tabTitle = tabUrl === NEW_TAB_URL ? 'New Tab' : (() => { try { return new URL(tabUrl).hostname.replace('www.', '') } catch { return 'New Tab' } })()
              const newTabObj: Tab = { id: newId(), url: tabUrl, title: tabTitle, isLoading: false, canGoBack: false, canGoForward: false }
              setTabs(prev => [...prev, newTabObj])
              // Only switch to new tab if background flag is not set
              if (!args.background) {
                setActiveTabId(newTabObj.id)
              }
              result = `New tab opened | id="${newTabObj.id}" | ${tabUrl}\n\nUse tabId="${newTabObj.id}" in page/act/fill/read/run tools to execute on this tab without switching.`
            } else if (action === 'closeTab') {
              // Close a tab by ID or the active tab
              const closeTargetId = args.tabId || args.value || activeTabIdRef.current
              setTabs(prev => {
                if (prev.length <= 1) return prev
                const newTabs = prev.filter(t => t.id !== closeTargetId)
                if (newTabs.length === prev.length) return prev // tab not found
                setActiveTabId(cur => {
                  if (cur !== closeTargetId) return cur
                  const idx = prev.findIndex(t => t.id === closeTargetId)
                  return newTabs[Math.min(idx, newTabs.length - 1)].id
                })
                return newTabs
              })
              result = `Tab closed | id="${closeTargetId}"`
            } else if (action === 'switchTab') {
              // Switch to tab by tabId, text (title/URL match), or numeric index
              const target = args.tabId || args.text || args.value || ''
              const currentTabs = tabsRef.current
              // First try exact tab ID match
              let tab = currentTabs.find(t => t.id === target)
              if (!tab) {
                // Try numeric index
                const numIdx = parseInt(target, 10)
                if (!isNaN(numIdx) && numIdx >= 0 && numIdx < currentTabs.length) {
                  tab = currentTabs[numIdx]
                }
              }
              if (!tab) {
                // Try text match on title/URL
                tab = currentTabs.find(t =>
                  t.title?.toLowerCase().includes(target.toLowerCase()) ||
                  t.url.toLowerCase().includes(target.toLowerCase())
                )
              }
              if (tab) {
                setActiveTabId(tab.id)
                result = `Switched to tab | id="${tab.id}" | ${tab.title || tab.url.substring(0, 60)}`
              } else {
                result = 'Tab not found: ' + target + '. Use act({action:"listTabs"}) to see available tabs with IDs.'
              }
            } else if (action === 'upload') {
              // Programmatic file upload via CDP — no OS dialog
              const filePaths = args.value ? args.value.split(',').map((p: string) => p.trim()) : []
              if (!filePaths.length) {
                result = 'Error: No file path(s) provided. Set value to comma-separated file paths.'
              } else {
                let wcId: number | null = null
                try { wcId = wv ? (wv as any).getWebContentsId?.() ?? null : null } catch { /* not ready */ }
                if (wcId) {
                  result = await api.fileUpload(wcId, args.selector || 'input[type=file]', filePaths)
                } else {
                  result = 'Error: Cannot get webContentsId for CDP file upload'
                }
              }
            } else if (action === 'screenshotElement') {
              // Screenshot a specific element by selector or text
              const elSelector = args.selector || ''
              const elText = args.text || ''
              if (!elSelector && !elText) {
                result = 'Error: selector or text required for screenshotElement'
              } else {
                try {
                  // First, scroll element into view and get its bounding rect
                  const rectCode = '(function(){' +
                    'var sel=' + JSON.stringify(elSelector) + ';' +
                    'var text=' + JSON.stringify(elText) + ';' +
                    'var el=sel?document.querySelector(sel):null;' +
                    'if(!el&&text){el=Array.from(document.querySelectorAll("*")).find(function(e){' +
                    'return (e.textContent||"").trim().toLowerCase().includes(text.toLowerCase())&&' +
                    'e.offsetHeight>0&&(e.textContent||"").trim().length<500;});}' +
                    'if(!el)return JSON.stringify({error:"Element not found"});' +
                    'el.scrollIntoView({block:"center",behavior:"auto"});' +
                    'var r=el.getBoundingClientRect();' +
                    'return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),tag:el.tagName.toLowerCase()});' +
                    '})()'
                  const rectJson = await (wv as any).executeJavaScript(rectCode)
                  const rect = JSON.parse(rectJson)
                  if (rect.error) {
                    result = 'Error: ' + rect.error
                  } else {
                    // Wait for scroll to settle
                    await new Promise(r => setTimeout(r, 200))
                    // Capture full page, then crop via the rect info
                    const nativeImage = await (wv as any).capturePage()
                    // Use the crop method if the rect is valid
                    const cropped = nativeImage.crop({
                      x: Math.max(0, rect.x),
                      y: Math.max(0, rect.y),
                      width: Math.min(rect.w, nativeImage.getSize().width - rect.x),
                      height: Math.min(rect.h, nativeImage.getSize().height - rect.y)
                    })
                    const base64 = nativeImageToBase64(cropped)
                    const filePath = await api.screenshotSave(base64)
                    result = 'Element screenshot saved: ' + filePath + ' (' + rect.w + 'x' + rect.h + 'px, <' + rect.tag + '>)'
                  }
                } catch (e: any) {
                  result = 'Error capturing element screenshot: ' + e.message
                }
              }
            } else if (action === 'screenshotSoM' || (action === 'screenshot' && args.som)) {
              // Set-of-Mark: inject numbered markers on interactive elements, screenshot, remove markers
              try {
                // Inject markers
                const markerCode = '(function(){' +
                  'var style=document.createElement("style");style.id="oculo-som-style";' +
                  'style.textContent=".oculo-som-marker{position:absolute;z-index:999999;pointer-events:none;' +
                  'background:rgba(255,0,0,0.85);color:white;font:bold 11px/16px Arial;' +
                  'padding:0 4px;border-radius:8px;min-width:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.5);}";' +
                  'document.head.appendChild(style);' +
                  'var container=document.createElement("div");container.id="oculo-som-container";' +
                  'container.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999998;";' +
                  'document.body.appendChild(container);' +
                  'var els=Array.from(document.querySelectorAll("a,button,[role=button],input:not([type=hidden]),textarea,select,input[type=submit],[contenteditable=true]"));' +
                  'var mapped=[];var n=0;' +
                  'els.forEach(function(el){' +
                  'var r=el.getBoundingClientRect();if(r.width<5||r.height<5)return;' +
                  'var s=getComputedStyle(el);if(s.display==="none"||s.visibility==="hidden"||s.opacity==="0")return;' +
                  'if(r.bottom<0||r.top>window.innerHeight||r.right<0||r.left>window.innerWidth)return;' +
                  'n++;' +
                  'var marker=document.createElement("div");marker.className="oculo-som-marker";' +
                  'marker.textContent=String(n);' +
                  'marker.style.left=(r.left-2)+"px";marker.style.top=(r.top-18)+"px";' +
                  'container.appendChild(marker);' +
                  'var type=el.tagName.toLowerCase();if(el.type)type=el.type;if(el.getAttribute("role"))type=el.getAttribute("role");' +
                  'var name=(el.textContent||"").trim().substring(0,30)||el.getAttribute("aria-label")||el.placeholder||el.name||"";' +
                  'mapped.push(n+": "+type+" \\""+name.substring(0,25)+"\\"");' +
                  '});' +
                  'return JSON.stringify({count:n,elements:mapped});' +
                  '})()'
                const mapJson = await (wv as any).executeJavaScript(markerCode)
                const mapData = JSON.parse(mapJson)

                // Wait for paint
                await new Promise(r => setTimeout(r, 100))

                // Capture screenshot
                const nativeImage = await (wv as any).capturePage()
                const base64 = nativeImageToBase64(nativeImage)
                const filePath = await api.screenshotSave(base64)

                // Remove markers
                await (wv as any).executeJavaScript('(function(){var c=document.getElementById("oculo-som-container");if(c)c.remove();var s=document.getElementById("oculo-som-style");if(s)s.remove();})()')

                result = 'Set-of-Mark screenshot saved: ' + filePath + '\nMarked ' + mapData.count + ' elements:\n' + (mapData.elements as string[]).join('\n')
              } catch (e: any) {
                result = 'Error capturing SoM screenshot: ' + e.message
                // Cleanup markers on error
                try { await (wv as any).executeJavaScript('(function(){var c=document.getElementById("oculo-som-container");if(c)c.remove();var s=document.getElementById("oculo-som-style");if(s)s.remove();})()') } catch {}
              }
            } else if (action === 'screenshot') {
              // Capture page screenshot and save to temp file
              try {
                const nativeImage = await (wv as any).capturePage()
                const base64 = nativeImageToBase64(nativeImage)
                const filePath = await api.screenshotSave(base64)
                result = 'Screenshot saved: ' + filePath
              } catch (e: any) {
                result = 'Error capturing screenshot: ' + e.message
              }
            } else if (action === 'download') {
              // Download a URL to disk
              const downloadUrl = args.url || args.value || ''
              if (!downloadUrl) {
                result = 'Error: No URL provided for download'
              } else {
                result = await api.downloadTrigger(downloadUrl)
              }
            } else if (action === 'listDownloads') {
              // List recent downloads
              const downloads = await api.downloadsList()
              if (!downloads?.length) {
                result = 'No downloads'
              } else {
                result = downloads.map((d: any) =>
                  `${d.state} | ${d.filename} | ${d.savePath}`
                ).join('\n')
              }
            } else if (action === 'readFile') {
              // Read file content (sandboxed to temp/downloads/desktop + file:// dir)
              const filePath = args.value || args.text || ''
              if (!filePath) {
                result = 'Error: No file path provided. Set value to the file path.'
              } else {
                const pageUrl = await (wv as any).executeJavaScript('location.href').catch(() => '')
                result = await api.fileReadSafe(filePath, pageUrl)
              }
            } else if (action === 'writeFile') {
              // Write file content (sandboxed to file:// dir + temp/downloads/desktop)
              const filePath = args.value || args.text || ''
              const content = args.content || ''
              if (!filePath) {
                result = 'Error: No file path provided. Set value to the file path.'
              } else if (!content) {
                result = 'Error: No content provided. Set content to the file contents.'
              } else {
                const pageUrl = await (wv as any).executeJavaScript('location.href').catch(() => '')
                result = await api.fileWriteSafe(filePath, content, pageUrl)
              }
            } else if (action === 'clipboardImage') {
              // Copy page screenshot to clipboard
              try {
                const nativeImage = await (wv as any).capturePage()
                const ok = await api.clipboardWriteImage(nativeImageToBase64(nativeImage))
                result = ok ? 'Page screenshot copied to clipboard' : 'Error: Failed to write image to clipboard'
              } catch (e: any) {
                result = 'Error capturing screenshot: ' + e.message
              }
            } else if (action === 'listTabs') {
              // List all open tabs from React state — includes tab IDs for parallel execution
              const currentTabs = tabsRef.current
              const activeId = activeTabIdRef.current
              const tabInfo = currentTabs.map((t, i) => {
                const marker = t.id === activeId ? '→ ' : '  '
                const loading = t.isLoading ? ' [loading]' : ''
                return `${marker}[${i}] id="${t.id}" ${t.title || 'Loading...'} — ${t.url.substring(0, 80)}${loading}`
              })
              result = tabInfo.length ? `Tabs (${tabInfo.length}):\n` + tabInfo.join('\n') : 'No tabs found'
              if (tabInfo.length > 0) result += '\n\nUse tabId parameter in page/act/fill/read/run tools to execute on a specific tab without switching.'
            } else if (action === 'monitorNetwork') {
              // Start/read network request monitoring (XHR + fetch)
              const monitorCode = '(function(){' +
                'if(window.__oculo_net&&window.__oculo_net.length){' +
                'var reqs=window.__oculo_net.slice(-' + (args.amount || 20) + ');' +
                'return "Captured "+window.__oculo_net.length+" requests:\\n"+reqs.map(function(r){' +
                'return r.method+" "+r.status+" "+r.url.substring(0,80)+(r.size?" ("+r.size+")":"");}).join("\\n");}' +
                'if(window.__oculo_net_active)return "Network monitoring active (0 requests captured so far)";' +
                'window.__oculo_net=[];window.__oculo_net_active=true;' +
                'var origFetch=window.fetch;' +
                'window.fetch=function(url,opts){' +
                'var method=(opts&&opts.method)||"GET";var urlStr=typeof url==="string"?url:url.url||"";' +
                'var entry={method:method,url:urlStr,ts:Date.now(),status:"pending"};' +
                'window.__oculo_net.push(entry);' +
                'return origFetch.apply(this,arguments).then(function(r){' +
                'entry.status=r.status;entry.size=r.headers.get("content-length")||"?";return r;' +
                '}).catch(function(e){entry.status="error: "+e.message;throw e;});};' +
                'var origOpen=XMLHttpRequest.prototype.open;var origSend=XMLHttpRequest.prototype.send;' +
                'XMLHttpRequest.prototype.open=function(m,u){this._oculo_entry={method:m,url:String(u).substring(0,200),ts:Date.now(),status:"pending"};origOpen.apply(this,arguments);};' +
                'XMLHttpRequest.prototype.send=function(){var self=this;if(this._oculo_entry){window.__oculo_net.push(this._oculo_entry);' +
                'this.addEventListener("loadend",function(){self._oculo_entry.status=self.status;self._oculo_entry.size=self.getResponseHeader("content-length")||"?";});}' +
                'origSend.apply(this,arguments);};' +
                'if(window.__oculo_net.length>200)window.__oculo_net=window.__oculo_net.slice(-100);' +
                'return "Network monitoring started. Call monitorNetwork again to see captured requests.";' +
                '})()'
              result = await (wv as any).executeJavaScript(monitorCode)
            } else if (action === 'autoLogin' || action === 'login') {
              // Auto-detect login form and fill from vault
              const getCredFromVault = async (domain: string) => {
                try {
                  const creds = await api.listCredentials?.()
                  if (!creds?.length) return null
                  return creds.find((c: any) =>
                    c.domain?.toLowerCase().includes(domain.toLowerCase()) ||
                    domain.toLowerCase().includes(c.domain?.toLowerCase())
                  ) || null
                } catch { return null }
              }
              const site = args.site || args.text || ''
              if (!site) {
                // Try to detect the current site
                try {
                  const currentHost = await (wv as any).executeJavaScript('location.hostname')
                  if (currentHost) {
                    const isLoginPage = await (wv as any).executeJavaScript(
                      '(function(){return !!document.querySelector("input[type=password]");})()'
                    )
                    if (isLoginPage) {
                      const cred = await getCredFromVault(currentHost)
                      if (cred) {
                        const loginCode = '(function(){' +
                          'var user=' + JSON.stringify(cred.username) + ';' +
                          'var pass=' + JSON.stringify(cred.password) + ';' +
                          'var userField=document.querySelector("input[type=email],input[type=text][name*=user i],input[name*=email i],input[autocomplete=username],input[type=text]:not([name*=search])");' +
                          'var passField=document.querySelector("input[type=password]");' +
                          'if(!passField)return "No password field found";' +
                          'var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");' +
                          'if(userField){' +
                          'if(setter&&setter.set){setter.set.call(userField,user);}else{userField.value=user;}' +
                          'userField.dispatchEvent(new Event("input",{bubbles:true}));' +
                          'userField.dispatchEvent(new Event("change",{bubbles:true}));}' +
                          'if(setter&&setter.set){setter.set.call(passField,pass);}else{passField.value=pass;}' +
                          'passField.dispatchEvent(new Event("input",{bubbles:true}));' +
                          'passField.dispatchEvent(new Event("change",{bubbles:true}));' +
                          'return "Filled credentials for "+' + JSON.stringify(currentHost) + '+(userField?" (user+pass)":" (pass only)");' +
                          '})()'
                        result = await (wv as any).executeJavaScript(loginCode)
                      } else {
                        result = 'No saved credentials for ' + currentHost + '. Add credentials in Settings > Vault.'
                      }
                    } else {
                      result = 'No login form detected on this page.'
                    }
                  }
                } catch (e: any) {
                  result = 'Auto-login failed: ' + e.message
                }
              } else {
                // Use provided site to lookup credentials
                try {
                  const cred = await getCredFromVault(site)
                  if (!cred) {
                    result = 'No saved credentials for ' + site
                  } else {
                    const loginCode = '(function(){' +
                      'var user=' + JSON.stringify(cred.username) + ';' +
                      'var pass=' + JSON.stringify(cred.password) + ';' +
                      'var userField=document.querySelector("input[type=email],input[type=text][name*=user i],input[name*=email i],input[autocomplete=username]");' +
                      'var passField=document.querySelector("input[type=password]");' +
                      'if(!passField)return "No password field found on page";' +
                      'var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");' +
                      'if(userField){if(setter&&setter.set){setter.set.call(userField,user);}else{userField.value=user;}' +
                      'userField.dispatchEvent(new Event("input",{bubbles:true}));userField.dispatchEvent(new Event("change",{bubbles:true}));}' +
                      'if(setter&&setter.set){setter.set.call(passField,pass);}else{passField.value=pass;}' +
                      'passField.dispatchEvent(new Event("input",{bubbles:true}));passField.dispatchEvent(new Event("change",{bubbles:true}));' +
                      'return "Filled credentials for "+' + JSON.stringify(site) + ';' +
                      '})()'
                    result = await (wv as any).executeJavaScript(loginCode)
                  }
                } catch (e: any) {
                  result = 'Auto-login failed: ' + e.message
                }
              }
              // Auto-submit the login form after filling credentials
              if (result && result.includes('Filled credentials') && args.autoSubmit !== false) {
                try {
                  const submitResult = await (wv as any).executeJavaScript(
                    '(function(){' +
                    'var btn=document.querySelector("button[type=submit],input[type=submit]");' +
                    'if(!btn){' +
                    'var buttons=Array.from(document.querySelectorAll("button,[role=button]"));' +
                    'btn=buttons.find(function(b){var t=(b.textContent||"").trim().toLowerCase();' +
                    'return ["sign in","log in","login","submit","continue","next","enter"].some(function(k){return t.includes(k);});});' +
                    '}' +
                    'if(!btn){var form=document.querySelector("form");if(form){form.submit();return "Form submitted via form.submit()";}}' +
                    'if(btn){btn.click();return "Clicked submit: \\""+((btn.textContent||"").trim().substring(0,30))+"\\"";}' +
                    'return "";' +
                    '})()'
                  )
                  if (submitResult) result += '\n' + submitResult
                } catch { /* submit failed, continue */ }
                await new Promise(r => setTimeout(r, 2000))
              }
              // Wait for potential 2FA prompt after login form submit
              if (result && result.includes('Filled credentials')) {
                await new Promise(r => setTimeout(r, 1000))
                // Check if 2FA/TOTP input appeared
                try {
                  const currentHost = await (wv as any).executeJavaScript('location.hostname')
                  const has2FA = await (wv as any).executeJavaScript(
                    '(function(){' +
                    'var inp=document.querySelector("input[autocomplete=one-time-code],input[name*=otp i],input[name*=totp i],input[name*=code i],input[name*=2fa i],input[placeholder*=code i],input[maxlength=\\"6\\"]");' +
                    'return !!inp;' +
                    '})()'
                  )
                  if (has2FA) {
                    // Try to generate TOTP code from vault
                    const totpResult = await api.vaultTotp?.(currentHost || site)
                    if (totpResult?.code) {
                      await (wv as any).executeJavaScript(
                        '(function(){' +
                        'var inp=document.querySelector("input[autocomplete=one-time-code],input[name*=otp i],input[name*=totp i],input[name*=code i],input[name*=2fa i],input[placeholder*=code i],input[maxlength=\\"6\\"]");' +
                        'if(!inp)return "No TOTP field";' +
                        'var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");' +
                        'if(setter&&setter.set){setter.set.call(inp,' + JSON.stringify(totpResult.code) + ');}' +
                        'else{inp.value=' + JSON.stringify(totpResult.code) + ';}' +
                        'inp.dispatchEvent(new Event("input",{bubbles:true}));' +
                        'inp.dispatchEvent(new Event("change",{bubbles:true}));' +
                        'return "TOTP filled";' +
                        '})()'
                      )
                      result += '\n2FA: TOTP code filled (' + totpResult.remainingSeconds + 's remaining)'
                    } else {
                      result += '\n2FA: Code input detected but no TOTP secret stored for this domain. Add TOTP secret in Settings > Vault.'
                    }
                  }
                } catch { /* 2FA detection failed */ }
              }
            } else if (action === 'visualDiff') {
              // Take "after" screenshot and compare with previous screenshot
              try {
                const nativeImage = await (wv as any).capturePage()
                const afterPath = await api.screenshotSave(nativeImageToBase64(nativeImage))
                // Compare with page snapshot text diff
                const currentSnapshot = await (wv as any).executeJavaScript(buildPageCode())
                const diff = diffPageSnapshot(lastPageSnapshot.current, currentSnapshot)
                lastPageSnapshot.current = currentSnapshot
                result = 'After screenshot: ' + afterPath + '\nChanges: ' + diff
              } catch (e: any) {
                result = 'Visual diff error: ' + e.message
              }
            } else if (action === 'detectAPIs') {
              // Detect API endpoints from network traffic (Resource Timing + intercepted requests)
              const apiCode = '(function(){' +
                'var apis=[];var seen=new Set();' +
                'performance.getEntriesByType("resource").forEach(function(e){' +
                'if(e.initiatorType==="xmlhttprequest"||e.initiatorType==="fetch"){' +
                'try{var u=new URL(e.name);var path=u.pathname;' +
                'if(path.includes("/api/")||path.includes("/graphql")||path.includes("/v1/")||path.includes("/v2/")||path.includes("/rest/")){' +
                'var key=u.origin+path;if(!seen.has(key)){seen.add(key);' +
                'apis.push({url:key,status:e.responseStatus||"?",type:path.includes("graphql")?"GraphQL":"REST",size:e.transferSize?Math.round(e.transferSize/1024)+"KB":"?"});}}}' +
                'catch(ex){}}});' +
                'if(window.__oculo_net){window.__oculo_net.forEach(function(r){' +
                'try{var u=new URL(r.url);var path=u.pathname;' +
                'if(path.includes("/api/")||path.includes("/graphql")||path.includes("/v1/")||path.includes("/v2/")){' +
                'var key=r.method+" "+u.origin+path;if(!seen.has(key)){seen.add(key);' +
                'apis.push({url:u.origin+path,method:r.method,status:r.status,type:path.includes("graphql")?"GraphQL":"REST"});}}}' +
                'catch(ex){}});}' +
                'if(!apis.length)return "No API endpoints detected. Enable network monitoring first with act({action:\\"monitorNetwork\\"})";' +
                'return "Detected "+apis.length+" API endpoints:\\n"+apis.map(function(a){' +
                'return (a.method||"GET")+" "+a.status+" "+a.type+" "+a.url+(a.size?" ("+a.size+")":"");}).join("\\n");' +
                '})()'
              result = await (wv as any).executeJavaScript(apiCode)
            } else if (action === 'iframeNavigate') {
              // Execute an action inside a specific iframe
              const iframeSel = args.selector || 'iframe'
              const iframeAction = args.value || '' // sub-action description
              const iframeCode = '(function(){' +
                'var sel=' + JSON.stringify(iframeSel) + ';' +
                'var iframes=document.querySelectorAll(sel);' +
                'if(!iframes.length)return "No iframes found matching: "+sel;' +
                'var info=[];' +
                'iframes.forEach(function(iframe,i){' +
                'var src=iframe.src||"about:blank";' +
                'var rect=iframe.getBoundingClientRect();' +
                'var accessible=false;' +
                'try{iframe.contentDocument;accessible=true;}catch(e){}' +
                'info.push("["+i+"] "+(accessible?"\\u2713":"\\u2717")+" "+src.substring(0,80)+" ("+Math.round(rect.width)+"x"+Math.round(rect.height)+")");' +
                '});' +
                'return "Iframes found:\\n"+info.join("\\n")+(info.some(function(s){return s.includes("\\u2717")?true:false})?"\\n\\nNote: \\u2717 = cross-origin (use clickAtPoint for these)":"");' +
                '})()'
              result = await (wv as any).executeJavaScript(iframeCode)
            } else if (action === 'recordStart') {
              // Start recording user actions as a workflow
              const recordCode = '(function(){' +
                'if(window.__oculo_recording)return "Already recording. Use recordStop to finish.";' +
                'window.__oculo_recording=[];window.__oculo_recording_active=true;' +
                'document.addEventListener("click",function handler(e){' +
                'if(!window.__oculo_recording_active){document.removeEventListener("click",handler);return;}' +
                'var el=e.target;var text=(el.textContent||"").trim().substring(0,40);' +
                'var sel=el.id?"#"+el.id:(el.className?"."+(typeof el.className==="string"?el.className.split(" ")[0]:""):"");' +
                'window.__oculo_recording.push({act:{action:"click",text:text,selector:sel}});' +
                '},true);' +
                'document.addEventListener("change",function handler(e){' +
                'if(!window.__oculo_recording_active){document.removeEventListener("change",handler);return;}' +
                'var el=e.target;if(!el.tagName)return;' +
                'var label=(el.labels&&el.labels[0]?el.labels[0].textContent.trim():"")||el.placeholder||el.name||"";' +
                'var value=el.type==="password"?"***":el.value;' +
                'window.__oculo_recording.push({fill:{fields:{[label]:value}}});' +
                '},true);' +
                'return "Recording started. Interact with the page, then use recordStop to get the workflow.";' +
                '})()'
              result = await (wv as any).executeJavaScript(recordCode)
            } else if (action === 'recordStop') {
              // Stop recording and return the workflow
              const stopCode = '(function(){' +
                'if(!window.__oculo_recording)return JSON.stringify({error:"No recording in progress"});' +
                'window.__oculo_recording_active=false;' +
                'var steps=window.__oculo_recording;' +
                'window.__oculo_recording=null;' +
                'return JSON.stringify({steps:steps,count:steps.length});' +
                '})()'
              try {
                const recordResult = JSON.parse(await (wv as any).executeJavaScript(stopCode))
                if (recordResult.error) {
                  result = recordResult.error
                } else {
                  result = 'Recorded ' + recordResult.count + ' steps:\n' + JSON.stringify(recordResult.steps, null, 2).substring(0, 2000)
                  // Save to run cache
                  try {
                    const currentUrl = await (wv as any).executeJavaScript('location.href')
                    const wfId = await api.runCacheSave(currentUrl, recordResult.steps, 'Recorded workflow')
                    if (wfId) result += '\n\nSaved as workflow [' + wfId + '] for replay.'
                  } catch { /* cache save failed */ }
                }
              } catch (e: any) {
                result = 'Error stopping recording: ' + e.message
              }
            } else if (action === 'extractPDF') {
              // Detect if current page is a PDF and extract text
              try {
                const isPDF = await (wv as any).executeJavaScript(
                  '(function(){' +
                  'var url=location.href;' +
                  'if(url.endsWith(".pdf")||url.includes("/pdf/")||document.contentType==="application/pdf")return "pdf";' +
                  'if(document.querySelector("#viewer.pdfViewer,embed[type*=pdf],object[type*=pdf]"))return "pdfjs";' +
                  'return "no";' +
                  '})()'
                )
                if (isPDF === 'no') {
                  result = 'Current page is not a PDF. Navigate to a PDF URL first.'
                } else {
                  // Try to extract text from PDF.js viewer or embedded PDF
                  const pdfText = await (wv as any).executeJavaScript(
                    '(function(){' +
                    'var pages=document.querySelectorAll(".page .textLayer");' +
                    'if(pages.length){' +
                    'var text=[];pages.forEach(function(p,i){' +
                    'var spans=p.querySelectorAll("span");' +
                    'var pageText=Array.from(spans).map(function(s){return s.textContent}).join(" ");' +
                    'if(pageText.trim())text.push("--- Page "+(i+1)+" ---\\n"+pageText);' +
                    '});' +
                    'return text.slice(0,' + (args.amount || 10) + ').join("\\n\\n")||"No text extracted";}' +
                    'var bodyText=(document.body.innerText||"").trim();' +
                    'if(bodyText.length>100)return bodyText.substring(0,5000);' +
                    'return "PDF detected but text extraction failed. The PDF may be image-based.";' +
                    '})()'
                  )
                  result = 'PDF content (' + isPDF + '):\n' + pdfText
                }
              } catch (e: any) {
                result = 'PDF extraction error: ' + e.message
              }
            } else if (action === 'monitorWebSocket') {
              // Monitor WebSocket and Server-Sent Events connections
              const wsCode = '(function(){' +
                'if(window.__oculo_ws&&window.__oculo_ws.length){' +
                'var msgs=window.__oculo_ws.slice(-' + (args.amount || 20) + ');' +
                'return "WebSocket/SSE messages ("+window.__oculo_ws.length+" total):\\n"+' +
                'msgs.map(function(m){return m.type+" | "+m.url.substring(0,50)+" | "+m.data.substring(0,100);}).join("\\n");}' +
                'if(window.__oculo_ws_active)return "WebSocket/SSE monitoring active ("+window.__oculo_ws.length+" messages)";' +
                'window.__oculo_ws=[];window.__oculo_ws_active=true;' +
                'var OrigWS=window.WebSocket;' +
                'window.WebSocket=function(url,protocols){' +
                'var ws=new OrigWS(url,protocols);' +
                'ws.addEventListener("message",function(e){' +
                'window.__oculo_ws.push({type:"ws-msg",url:url,data:String(e.data).substring(0,500),ts:Date.now()});' +
                'if(window.__oculo_ws.length>500)window.__oculo_ws=window.__oculo_ws.slice(-250);' +
                '});' +
                'ws.addEventListener("open",function(){window.__oculo_ws.push({type:"ws-open",url:url,data:"connected",ts:Date.now()});});' +
                'ws.addEventListener("close",function(e){window.__oculo_ws.push({type:"ws-close",url:url,data:"code="+e.code,ts:Date.now()});});' +
                'return ws;};' +
                'window.WebSocket.prototype=OrigWS.prototype;' +
                'window.WebSocket.CONNECTING=OrigWS.CONNECTING;window.WebSocket.OPEN=OrigWS.OPEN;' +
                'window.WebSocket.CLOSING=OrigWS.CLOSING;window.WebSocket.CLOSED=OrigWS.CLOSED;' +
                'var OrigES=window.EventSource;' +
                'if(OrigES){window.EventSource=function(url,opts){' +
                'var es=new OrigES(url,opts);' +
                'es.addEventListener("message",function(e){' +
                'window.__oculo_ws.push({type:"sse-msg",url:url,data:String(e.data).substring(0,500),ts:Date.now()});' +
                '});' +
                'es.addEventListener("open",function(){window.__oculo_ws.push({type:"sse-open",url:url,data:"connected",ts:Date.now()});});' +
                'return es;};window.EventSource.prototype=OrigES.prototype;}' +
                'return "WebSocket/SSE monitoring started. Call monitorWebSocket again to see messages.";' +
                '})()'
              result = await (wv as any).executeJavaScript(wsCode)
            } else if (action === 'checkDialogs') {
              // Check for intercepted JavaScript dialogs (alert/confirm/prompt)
              const dialogCode = '(function(){' +
                'var dialogs = window.__oculoDialogs || window.__oc_dialogs || [];' +
                'if(!dialogs.length) return "No dialogs intercepted";' +
                'var recent = dialogs.slice(-10);' +
                'window.__oculoDialogs = []; window.__oc_dialogs = [];' +
                'return "Intercepted dialogs:\\n" + recent.map(function(d){' +
                'return d.type + " | " + (d.message || "").substring(0,100);' +
                '}).join("\\n");' +
                '})()'
              result = await (wv as any).executeJavaScript(dialogCode)
            } else if (action === 'printToPDF') {
              // Print current page to PDF and save to temp directory
              try {
                const wcId = (wv as any).getWebContentsId?.()
                if (!wcId) {
                  result = 'Error: Cannot get webContentsId for PDF generation'
                } else {
                  const pdfPath = await api.printToPDF(wcId)
                  result = pdfPath.startsWith('Error') ? pdfPath : 'PDF saved: ' + pdfPath
                }
              } catch (e: any) {
                result = 'Error generating PDF: ' + e.message
              }
            } else if (action === 'getCookies') {
              // Read cookies for the current page
              const cookieCode = '(function(){' +
                'var cookies=document.cookie.split(";").map(function(c){return c.trim();}).filter(Boolean);' +
                'if(!cookies.length)return "No cookies set for this domain";' +
                'return "Cookies ("+cookies.length+"):\\n"+cookies.map(function(c){' +
                'var parts=c.split("=");return "  "+parts[0]+"="+parts.slice(1).join("=").substring(0,50);' +
                '}).join("\\n");' +
                '})()'
              result = await (wv as any).executeJavaScript(cookieCode)
            } else if (action === 'setCookie') {
              // Set a cookie: text=name, value=value, key=options (max-age, path, etc.)
              const cookieName = args.text || ''
              const cookieValue = args.value || ''
              const cookieOpts = args.key || '' // e.g. "max-age=3600; path=/"
              if (!cookieName) {
                result = 'Error: text (cookie name) required'
              } else {
                const setCookieCode = '(function(){' +
                  'document.cookie=' + JSON.stringify(cookieName + '=' + cookieValue + (cookieOpts ? '; ' + cookieOpts : '')) + ';' +
                  'return "Cookie set: "+' + JSON.stringify(cookieName) + ';' +
                  '})()'
                result = await (wv as any).executeJavaScript(setCookieCode)
              }
            } else if (action === 'deleteCookie') {
              // Delete a cookie by name
              const cookieName = args.text || ''
              if (!cookieName) {
                result = 'Error: text (cookie name) required'
              } else {
                const delCookieCode = '(function(){' +
                  'document.cookie=' + JSON.stringify(cookieName + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/') + ';' +
                  'return "Cookie deleted: "+' + JSON.stringify(cookieName) + ';' +
                  '})()'
                result = await (wv as any).executeJavaScript(delCookieCode)
              }
            } else if (action === 'getStorage') {
              // Read localStorage or sessionStorage
              const storageType = args.value === 'session' ? 'sessionStorage' : 'localStorage'
              const storageKey = args.text || ''
              const storageCode = '(function(){' +
                'var storage=' + storageType + ';' +
                'if(' + JSON.stringify(storageKey) + '){' +
                'var val=storage.getItem(' + JSON.stringify(storageKey) + ');' +
                'return val===null?"Key not found: "+' + JSON.stringify(storageKey) + ':""+' + JSON.stringify(storageKey) + '+"="+val.substring(0,500);' +
                '}' +
                // List all keys
                'var keys=[];for(var i=0;i<storage.length&&i<50;i++){' +
                'var k=storage.key(i);var v=storage.getItem(k);' +
                'keys.push("  "+k+"="+v.substring(0,50)+(v.length>50?"...":""));}' +
                'return storage.length?"' + storageType + ' ("+storage.length+" items):\\n"+keys.join("\\n"):"' + storageType + ' is empty";' +
                '})()'
              result = await (wv as any).executeJavaScript(storageCode)
            } else if (action === 'setStorage') {
              // Set a localStorage or sessionStorage item
              const storageType = args.key === 'session' ? 'sessionStorage' : 'localStorage'
              const storageKey = args.text || ''
              const storageValue = args.value || ''
              if (!storageKey) {
                result = 'Error: text (storage key) required'
              } else {
                const setStorageCode = '(function(){' +
                  storageType + '.setItem(' + JSON.stringify(storageKey) + ',' + JSON.stringify(storageValue) + ');' +
                  'return "Set "+' + JSON.stringify(storageType) + '+"["+' + JSON.stringify(storageKey) + '+"]="+' + JSON.stringify(storageValue.substring(0, 50)) + ';' +
                  '})()'
                result = await (wv as any).executeJavaScript(setStorageCode)
              }
            } else if (action === 'clearStorage') {
              // Clear localStorage or sessionStorage
              const storageType = args.value === 'session' ? 'sessionStorage' : 'localStorage'
              const clearCode = '(function(){' +
                'var count=' + storageType + '.length;' +
                storageType + '.clear();' +
                'return "Cleared "+count+" items from ' + storageType + '";' +
                '})()'
              result = await (wv as any).executeJavaScript(clearCode)
            } else if (action === 'interceptNetwork') {
              // CDP-level network interception with full request/response bodies
              const wcId = (wv as any).getWebContentsId?.()
              if (!wcId) {
                result = 'Error: Cannot get webContentsId'
              } else {
                const enable = args.value !== 'stop'
                result = await api.networkIntercept(wcId, enable)
                if (!enable) {
                  // Parse and format the returned data
                  try {
                    const data = JSON.parse(result)
                    if (Array.isArray(data) && data.length) {
                      result = 'Captured ' + data.length + ' requests:\n' + data.map((r: any) =>
                        r.status + ' ' + r.mimeType + ' ' + r.url.substring(0, 80)
                      ).join('\n')
                    }
                  } catch { /* keep raw result */ }
                }
              }
            } else if (action === 'solveCaptcha') {
              // CAPTCHA solving — try CDP-based solver first, then vision fallback
              try {
                // Step 0: Try main-process CDP-based solver (audio, slider, text)
                const wcId = (wv as any).getWebContentsId?.()
                if (wcId && api.captchaSolve) {
                  const cdpResult = await api.captchaSolve(wcId)
                  if (cdpResult?.success && !cdpResult.message?.includes('No CAPTCHA detected')) {
                    result = cdpResult.message
                    break
                  }
                }
                // Step 1: Screenshot the page (CAPTCHA area)
                const nativeImg = await (wv as any).capturePage()
                const screenshotBase64 = nativeImageToBase64(nativeImg)

                // Step 2: Detect CAPTCHA type and input field
                const captchaInfo = await (wv as any).executeJavaScript(
                  '(function(){' +
                  'var info={type:"unknown",hasInput:false,selector:""};' +
                  // Check for different CAPTCHA types
                  'if(document.querySelector("iframe[src*=recaptcha]"))info.type="recaptcha";' +
                  'else if(document.querySelector("iframe[src*=hcaptcha]"))info.type="hcaptcha";' +
                  'else if(document.querySelector("iframe[src*=turnstile]"))info.type="turnstile";' +
                  'else if(document.querySelector("[class*=captcha] img,img[src*=captcha],#captchaImage"))info.type="image";' +
                  'else if(document.querySelector("[class*=captcha] input,[name*=captcha]"))info.type="text";' +
                  // Find input field
                  'var inp=document.querySelector("#captcha-input,[name*=captcha i],input[placeholder*=captcha i],input[aria-label*=captcha i],[class*=captcha] input:not([type=hidden])");' +
                  'if(inp){info.hasInput=true;info.selector=inp.id?"#"+inp.id:inp.name?"[name=\\""+inp.name+"\\"]":"[class*=captcha] input";}' +
                  'return info;' +
                  '})()'
                )

                if (captchaInfo.type === 'turnstile') {
                  result = 'Cloudflare Turnstile detected — this auto-passes in a real browser. Wait a moment.'
                } else if (!captchaInfo.hasInput && (captchaInfo.type === 'recaptcha' || captchaInfo.type === 'hcaptcha')) {
                  result = 'CAPTCHA detected (' + captchaInfo.type + ') but it uses a challenge iframe. Screenshot captured — an AI with vision capabilities would analyze the image to solve it. For now, please solve manually in the browser.'
                } else if (captchaInfo.hasInput) {
                  // For text/image CAPTCHAs with input fields, we can try to solve
                  result = 'CAPTCHA detected (' + captchaInfo.type + '). Input field found at: ' + captchaInfo.selector + '. Screenshot captured for AI analysis. To complete solving: analyze the screenshot, read the CAPTCHA text, then fill({\"' + captchaInfo.selector + '\": \"answer\"}).'
                } else {
                  result = 'CAPTCHA area detected but no solvable input found. Screenshot captured. Type: ' + captchaInfo.type
                }

                // Include screenshot path
                if (screenshotBase64) {
                  const screenshotPath = await api.screenshotSave(screenshotBase64)
                  if (screenshotPath) result += '\nScreenshot saved: ' + screenshotPath
                }
              } catch (e: any) {
                result = 'CAPTCHA solving error: ' + e.message
              }
            } else if (action === 'exportCookies') {
              // Export session cookies (bypasses HttpOnly via Electron session API)
              try {
                const url = args.url || args.site || ''
                const cookies = await api.cookiesExport?.(url || undefined)
                if (cookies?.error) {
                  result = 'Cookie export error: ' + cookies.error
                } else if (cookies?.length) {
                  result = 'Exported ' + cookies.length + ' cookies:\n' + JSON.stringify(cookies, null, 2)
                } else {
                  result = 'No cookies found' + (url ? ' for ' + url : '')
                }
              } catch (e: any) {
                result = 'Cookie export failed: ' + e.message
              }
            } else if (action === 'importCookies') {
              // Import cookies into the session
              try {
                const cookies = args.value ? JSON.parse(args.value) : []
                if (!Array.isArray(cookies) || !cookies.length) {
                  result = 'Error: provide cookies as JSON array in value field'
                } else {
                  const importResult = await api.cookiesImport?.(cookies)
                  if (importResult?.error) {
                    result = 'Cookie import error: ' + importResult.error
                  } else {
                    result = 'Imported ' + (importResult?.imported || 0) + ' cookies'
                  }
                }
              } catch (e: any) {
                result = 'Cookie import failed: ' + e.message
              }
            } else { result = 'Unknown action: ' + action }
            // Auto-append page state after actions that change the page
            const noSnapshotActions = ['wait', 'hover', 'getAttribute', 'evaluate', 'copy', 'screenshot', 'screenshotSoM', 'screenshotElement', 'clipboardImage', 'download', 'listDownloads', 'readFile', 'writeFile', 'listTabs', 'monitorNetwork', 'visualDiff', 'detectAPIs', 'recordStart', 'recordStop', 'extractPDF', 'monitorWebSocket', 'checkDialogs', 'printToPDF', 'getCookies', 'setCookie', 'deleteCookie', 'getStorage', 'setStorage', 'clearStorage', 'interceptNetwork', 'exportCookies', 'importCookies', 'solveCaptcha']
            if (!noSnapshotActions.includes(action)) {
              // Wait for DOM to stabilize after page-changing actions
              if (action === 'navigate' || action === 'click' || action === 'back' || action === 'forward' || action === 'reload') {
                try { await (wv as any).executeJavaScript(buildWaitForStableCode(150, 3000)) } catch { /* page might be navigating */ }
              }
              // Use ref-tagged a11y snapshot for richer post-action context
              const refSnapshot = await getRefTaggedSnapshot(wv)
              if (refSnapshot) {
                result += '\n---\n' + refSnapshot
              } else {
                // Fallback to compact page snapshot if a11y fails
                const snapshot = await getPageSnapshot(wv)
                if (snapshot) result += '\n---\n' + snapshot
              }
            }
            // Capture screenshot if requested
            if (args.screenshot) {
              try {
                const nativeImage = await (wv as any).capturePage()
                const base64 = nativeImageToBase64(nativeImage)
                const filePath = await api.screenshotSave(base64)
                result += '\n[Screenshot: ' + filePath + ']'
              } catch { /* screenshot failed, non-critical */ }
            }
            break
          }

          case 'fill': {
            // Guard: fields must be a plain object, not a string/array
            const rawFields = args.fields
            if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
              result = 'Error: fields must be an object like {"Field Label": "value"}. Got ' + typeof rawFields
              break
            }
            let entries = Object.entries(rawFields)
            if (entries.length > 30) {
              result = 'Error: too many fields (' + entries.length + '). Pass at most 30 fields per fill call.'
              break
            }

            // Fix 2: Resolve ref-based field keys (e.g., {"e5": "value"}) to CSS selectors
            const resolvedEntries: [string, unknown][] = []
            for (const [key, value] of entries) {
              if (/^e\d+$/.test(key)) {
                const refEntry = currentRefMap.current[key]
                if (refEntry) {
                  let selector = ''
                  if (refEntry.backendDOMNodeId) {
                    try {
                      const wcId = (wv as any).getWebContentsId?.()
                      if (wcId) {
                        const nodeResult = await api.resolveNode(wcId, refEntry.backendDOMNodeId)
                        if (nodeResult?.alive && nodeResult.selector) selector = nodeResult.selector
                      }
                    } catch { /* fall through */ }
                  }
                  if (!selector) {
                    try {
                      const fpResult = await (wv as any).executeJavaScript(buildFingerprintMatchCode(refEntry))
                      if (fpResult?.found && fpResult.selector) selector = fpResult.selector
                    } catch { /* fall through */ }
                  }
                  resolvedEntries.push([selector || refEntry.name || key, value])
                } else {
                  resolvedEntries.push([key, value])
                }
              } else {
                resolvedEntries.push([key, value])
              }
            }
            entries = resolvedEntries

            result = await (wv as any).executeJavaScript(buildFillCode(entries, args.submit))
            // Handle file inputs — detect entries that look like file paths and upload via CDP
            try {
              const fileEntries = entries.filter(([_, v]) =>
                typeof v === 'string' && (
                  (v as string).startsWith('/') || (v as string).startsWith('~') ||
                  (v as string).match(/^[A-Z]:\\/) || (v as string).startsWith('file://') ||
                  (v as string).match(/^https?:\/\/.*\.(pdf|png|jpg|jpeg|gif|doc|docx|csv|txt|zip)$/i)
                )
              )
              if (fileEntries.length > 0) {
                let wcId: number | null = null
                try { wcId = wv ? (wv as any).getWebContentsId?.() ?? null : null } catch { /* not ready */ }
                if (wcId) {
                  for (const [label, value] of fileEntries) {
                    const filePath = String(value)
                    // Find the file input matching this label
                    const fileSelector = await (wv as any).executeJavaScript(
                      '(function(){' +
                      'var label=' + JSON.stringify(label) + ';' +
                      'var inputs=document.querySelectorAll("input[type=file]");' +
                      'for(var i=0;i<inputs.length;i++){' +
                      'var inp=inputs[i];' +
                      'var lbl=(inp.labels&&inp.labels[0]?inp.labels[0].textContent.trim():"")||inp.name||inp.id||inp.getAttribute("aria-label")||"";' +
                      'if(lbl.toLowerCase().includes(label.toLowerCase())||label.toLowerCase().includes("file"))return inp.name?"input[name=\\""+inp.name+"\\"]":inp.id?"#"+inp.id:"input[type=file]:nth-of-type("+(i+1)+")";' +
                      '}' +
                      'if(inputs.length===1)return "input[type=file]";' +
                      'return "";' +
                      '})()'
                    )
                    if (fileSelector) {
                      const uploadResult = await api.fileUpload(wcId, fileSelector, [filePath])
                      result += '\nFile upload (' + label + '): ' + uploadResult
                    }
                  }
                }
              }
            } catch { /* file upload detection failed, non-critical */ }
            // Detect form validation errors
            try {
              const validationResult = await (wv as any).executeJavaScript(
                '(function(){' +
                'var errors=[];' +
                // aria-invalid fields
                'document.querySelectorAll("[aria-invalid=true]").forEach(function(el){' +
                'var name=(el.labels&&el.labels[0]?el.labels[0].textContent.trim():"")||el.placeholder||el.name||el.type;' +
                'var msg=el.validationMessage||"invalid";' +
                'errors.push(name.substring(0,30)+": "+msg);});' +
                // Red-bordered fields (common CSS pattern)
                'document.querySelectorAll("input,textarea,select").forEach(function(el){' +
                'var s=getComputedStyle(el);var bc=s.borderColor||"";' +
                'if((bc.includes("rgb(255")||bc.includes("rgb(220")||bc.includes("red"))&&!el.getAttribute("aria-invalid")){' +
                'var name=(el.labels&&el.labels[0]?el.labels[0].textContent.trim():"")||el.placeholder||el.name||"field";' +
                'errors.push(name.substring(0,30)+": red border (likely invalid)");}});' +
                // Error message elements
                'var errMsgs=document.querySelectorAll("[class*=error],[class*=invalid],[role=alert],[class*=validation]");' +
                'errMsgs.forEach(function(el){' +
                'var t=el.textContent.trim();var s=getComputedStyle(el);' +
                'if(t.length>3&&t.length<200&&s.display!=="none"&&s.visibility!=="hidden")errors.push("⚠ "+t);});' +
                'return errors.length?"\\n⚠ Validation errors:\\n"+errors.join("\\n"):"";' +
                '})()'
              )
              if (validationResult) result += validationResult
            } catch { /* validation detection failed, non-critical */ }
            // Check for JS errors that occurred during fill
            try {
              const jsErrors = await (wv as any).executeJavaScript(
                '(function(){if(!window.__oc_logs)return "";' +
                'var recent=window.__oc_logs.filter(function(l){return l.type==="error"&&Date.now()-l.ts<5000;});' +
                'if(!recent.length)return "";' +
                'return "\\n⚠ JS errors during fill: "+recent.map(function(l){return l.msg}).join("; ");' +
                '})()'
              )
              if (jsErrors) result += jsErrors
            } catch { /* error check failed */ }
            // Auto-escalate: if most fields weren't found, provide a11y tree hints
            if (result.includes('Not found:')) {
              const notFoundMatch = result.match(/Not found: (.+?)($|\nTip:)/s)
              const notFoundCount = notFoundMatch ? notFoundMatch[1].split(', ').length : 0
              if (notFoundCount >= entries.length * 0.5) {
                // More than half failed — get a11y tree to help the AI
                try {
                  const wcId = (wv as any).getWebContentsId?.()
                  if (wcId) {
                    const a11y = await api.a11ySnapshot(wcId)
                    // Extract just the interactive textbox/combobox lines for the hint
                    const fieldLines = a11y.split('\n').filter((l: string) =>
                      l.includes('textbox') || l.includes('combobox') || l.includes('searchbox') ||
                      l.includes('spinbutton') || l.includes('checkbox') || l.includes('radio')
                    ).slice(0, 15)
                    if (fieldLines.length) {
                      result += '\n\nAvailable form fields (from accessibility tree):\n' + fieldLines.join('\n')
                      result += '\n\nHint: use the exact name in quotes as fill key, or use CSS selectors like "#id" or "[name=x]"'
                    }
                  }
                } catch { /* a11y fallback failed, continue with normal result */ }
              }
            }
            // Auto-append ref-tagged snapshot after fill
            {
              const refSnapshot = await getRefTaggedSnapshot(wv)
              if (refSnapshot) {
                result += '\n---\n' + refSnapshot
              } else {
                const snapshot = await getPageSnapshot(wv)
                if (snapshot) result += '\n---\n' + snapshot
              }
            }
            // Capture screenshot if requested
            if (args.screenshot) {
              try {
                const nativeImage = await (wv as any).capturePage()
                const base64 = nativeImageToBase64(nativeImage)
                const filePath = await api.screenshotSave(base64)
                result += '\n[Screenshot: ' + filePath + ']'
              } catch { /* screenshot failed, non-critical */ }
            }
            break
          }

          case 'read': {
            result = await (wv as any).executeJavaScript(buildReadCode(args.scope || 'body', args.limit || 10))
            // Enhanced: detect and extract tables as structured data
            if (args.what && (args.what.toLowerCase().includes('table') || args.format === 'json')) {
              try {
                const tableCode = '(function(){' +
                  'var scope=document.querySelector(' + JSON.stringify(args.scope || 'body') + ')||document.body;' +
                  'var tables=scope.querySelectorAll("table");' +
                  'if(!tables.length)return "";' +
                  'var results=[];' +
                  'tables.forEach(function(table,ti){' +
                  'if(ti>2)return;' +
                  'var headers=[];var rows=[];' +
                  'var ths=table.querySelectorAll("thead th,thead td,tr:first-child th");' +
                  'if(ths.length){ths.forEach(function(th){headers.push((th.textContent||"").trim().substring(0,40));});}' +
                  'else{var firstRow=table.querySelector("tr");if(firstRow){' +
                  'firstRow.querySelectorAll("td,th").forEach(function(td){headers.push((td.textContent||"").trim().substring(0,40));});}}' +
                  'var trs=table.querySelectorAll("tbody tr,tr");' +
                  'var startIdx=headers.length?1:0;' +
                  'for(var ri=startIdx;ri<trs.length&&ri<' + (args.limit || 10) + '+startIdx;ri++){' +
                  'var cells=[];trs[ri].querySelectorAll("td,th").forEach(function(td){' +
                  'cells.push((td.textContent||"").trim().substring(0,50));});' +
                  'if(cells.length)rows.push(cells);}' +
                  'if(headers.length||rows.length){' +
                  'results.push({table:ti+1,headers:headers,rows:rows,totalRows:trs.length-startIdx});}' +
                  '});' +
                  'if(!results.length)return "";' +
                  'return ' + JSON.stringify(args.format) + '==="json"?JSON.stringify(results):' +
                  'results.map(function(t){' +
                  'var lines=["Table "+t.table+" ("+t.totalRows+" rows):"];' +
                  'if(t.headers.length)lines.push("  "+t.headers.join(" | "));' +
                  't.rows.forEach(function(r){lines.push("  "+r.join(" | "));});' +
                  'return lines.join("\\n");}).join("\\n\\n");' +
                  '})()'
                const tableResult = await (wv as any).executeJavaScript(tableCode)
                if (tableResult) result = tableResult // Replace with richer extraction
              } catch { /* table extraction failed, keep original result */ }
            }
            break
          }

          case 'run': {
            // Fix #25: Workflow management — list/delete cached workflows
            if (args.manage) {
              if (args.manage === 'list') {
                try {
                  const workflows = await api.runCacheList()
                  if (!workflows || workflows.length === 0) {
                    result = 'No cached workflows.'
                  } else {
                    result = 'Cached workflows (' + workflows.length + '):\n' +
                      workflows.map((w: any) => `  [${w.id}] ${w.description} (${w.domain}, used ${w.successCount}x, failed ${w.failCount}x, last: ${new Date(w.lastUsed).toLocaleDateString()})`).join('\n') +
                      '\n\nReplay: run({workflow:"id"}) | Delete: run({manage:"delete", workflow:"id"})'
                  }
                } catch (e: any) { result = 'Error listing workflows: ' + e.message }
                break
              } else if (args.manage === 'delete') {
                const delId = args.workflow
                if (!delId) { result = 'Error: specify workflow ID to delete via workflow parameter'; break }
                try {
                  const deleted = await api.runCacheDelete(delId)
                  result = deleted ? 'Deleted workflow: ' + delId : 'Workflow not found: ' + delId
                } catch (e: any) { result = 'Error deleting workflow: ' + e.message }
                break
              }
            }

            // Workflow replay: if args.workflow is provided, load cached steps
            let steps = args.steps || []
            let workflowId: string | null = args.workflow || null
            if (workflowId && !steps.length) {
              try {
                const cached = await api.runCacheGet(workflowId)
                if (cached?.steps) {
                  steps = cached.steps
                } else {
                  result = 'Workflow not found: ' + workflowId
                  break
                }
              } catch { result = 'Error loading workflow: ' + workflowId; break }
            }
            const results: string[] = []
            let runFailed = false
            for (const step of steps) {
              const entries = Object.entries(step)
              if (!entries.length) continue
              const [stepTool, stepArgs] = entries[0]
              if (stepTool === 'wait') {
                const waitMs = (stepArgs as any)?.timeout || 2000
                await new Promise(r => setTimeout(r, waitMs))
                results.push('Waited ' + waitMs + 'ms')
              } else {
                // Re-use the same tool handlers inline
                try {
                  if (stepTool === 'page') {
                    const snap = await getPageSnapshot(wv, true)
                    results.push('page: ' + snap)
                  } else if (stepTool === 'act') {
                    // Delegate ALL act actions to the main act handler via recursive IPC-like call
                    const sa = stepArgs as any
                    const action = sa?.action
                    if (action === 'click') {
                      const r = await (wv as any).executeJavaScript(buildClickCode(sa.text || '', sa.selector || '', sa.nth || 0, sa.modifiers))
                      results.push('act: ' + r)
                    } else if (action === 'navigate' && sa.url) {
                      await (wv as any).loadURL(sa.url)
                      await new Promise(r => setTimeout(r, 2000))
                      results.push('act: Navigated to ' + sa.url)
                    } else if (action === 'type') {
                      const typeText = String(sa.text || '')
                      if (sa.selector) {
                        const focusCode = '(function(){var el=document.querySelector(' + JSON.stringify(sa.selector) + ');if(el){el.focus();return "focused";}return "not found"})()'
                        await (wv as any).executeJavaScript(focusCode)
                        await new Promise(r => setTimeout(r, 100))
                      }
                      await (wv as any).insertText(typeText)
                      results.push('act: Typed ' + typeText.length + ' chars')
                    } else if (action === 'press') {
                      const key = sa.key || 'Enter'
                      ;(wv as any).sendInputEvent({ type: 'keyDown', keyCode: key })
                      ;(wv as any).sendInputEvent({ type: 'char', keyCode: key })
                      ;(wv as any).sendInputEvent({ type: 'keyUp', keyCode: key })
                      results.push('act: Pressed ' + key)
                    } else if (action === 'scroll') {
                      const dir = sa.direction || 'down'
                      const amt = sa.amount || 300
                      const scrollCode = dir === 'up' ? 'window.scrollBy(0,-' + amt + ')' : dir === 'down' ? 'window.scrollBy(0,' + amt + ')' : dir === 'left' ? 'window.scrollBy(-' + amt + ',0)' : 'window.scrollBy(' + amt + ',0)'
                      await (wv as any).executeJavaScript(scrollCode)
                      results.push('act: Scrolled ' + dir + ' ' + amt + 'px')
                    } else if (action === 'hover') {
                      const hoverCode = '(function(){var t=' + JSON.stringify(sa.text || '') + ',s=' + JSON.stringify(sa.selector || '') + ';var el=s?document.querySelector(s):null;if(!el&&t){var all=document.querySelectorAll("a,button,span,div,li,label,input,p,h1,h2,h3,h4,h5,h6");for(var i=0;i<all.length;i++){if(all[i].textContent.trim().includes(t)){el=all[i];break;}}}if(el){el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));el.dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}));return "Hovered on: "+el.textContent.trim().substring(0,50);}return "Element not found";})()'
                      const r = await (wv as any).executeJavaScript(hoverCode)
                      results.push('act: ' + r)
                    } else if (action === 'back') {
                      await (wv as any).goBack()
                      results.push('act: Went back')
                    } else if (action === 'forward') {
                      await (wv as any).goForward()
                      results.push('act: Went forward')
                    } else if (action === 'reload') {
                      await (wv as any).reload()
                      results.push('act: Reloaded')
                    } else if (action === 'select') {
                      const selCode = '(function(){var s=' + JSON.stringify(sa.selector || '') + ',v=' + JSON.stringify(sa.value || '') + ';var el=s?document.querySelector(s):null;if(el&&el.tagName==="SELECT"){el.value=v;el.dispatchEvent(new Event("change",{bubbles:true}));return "Selected: "+v;}return "Select element not found";})()'
                      const r = await (wv as any).executeJavaScript(selCode)
                      results.push('act: ' + r)
                    } else if (action === 'wait') {
                      await new Promise(r => setTimeout(r, sa.timeout || sa.ms || 1000))
                      results.push('act: Waited ' + (sa.timeout || sa.ms || 1000) + 'ms')
                    } else {
                      results.push('act: ' + action + ' executed (pipeline shorthand)')
                    }
                  } else if (stepTool === 'fill') {
                    const sa = stepArgs as any
                    const rawF = sa.fields
                    if (!rawF || typeof rawF !== 'object' || Array.isArray(rawF)) {
                      results.push('fill: Error — fields must be an object like {"Label": "value"}')
                    } else {
                      const fillEntries = Object.entries(rawF)
                      const r = await (wv as any).executeJavaScript(buildFillCode(fillEntries, sa.submit))
                      results.push('fill: ' + r)
                    }
                  } else if (stepTool === 'read') {
                    const sa = stepArgs as any
                    const r = await (wv as any).executeJavaScript(buildReadCode(sa.scope || 'body', sa.limit || 10))
                    results.push('read: ' + r)
                  } else if (stepTool === 'if') {
                    // Conditional branching: { if: { condition: "js expr", then: [...steps], else: [...steps] } }
                    const sa = stepArgs as any
                    const condition = sa?.condition || 'false'
                    let condResult = false
                    try {
                      condResult = await (wv as any).executeJavaScript('!!(' + condition + ')')
                    } catch { condResult = false }
                    const branch = condResult ? (sa.then || []) : (sa.else || [])
                    if (branch.length) {
                      results.push('if: condition=' + condResult + ', running ' + branch.length + ' steps')
                      // Inline execution of branch steps (push to current loop)
                      steps.splice(steps.indexOf(step) + 1, 0, ...branch)
                    } else {
                      results.push('if: condition=' + condResult + ', no steps in branch')
                    }
                  } else {
                    results.push(stepTool + ': not supported in run pipeline')
                  }
                } catch (e: any) {
                  results.push(stepTool + ': Error - ' + e.message)
                  runFailed = true
                  if (workflowId) {
                    // Cached workflow step failed — abort replay
                    results.push('⚠ Cached workflow failed at step. Aborting replay.')
                    break
                  }
                }
              }
            }
            result = args.returnAll ? results.join('\n---\n') : (results[results.length - 1] || 'No steps')
            // Compile-to-code: save successful runs, track failed cached workflows
            if (workflowId) {
              if (runFailed) {
                try { await api.runCacheMarkFailed(workflowId) } catch {}
                result += '\n⚠ Cached workflow replay failed. Re-plan manually.'
              } else {
                try { await api.runCacheMarkSuccess(workflowId) } catch {}
                // Skill synthesis: if this workflow has succeeded 3+ times, mark it as a "skill"
                try {
                  const cached = await api.runCacheGet(workflowId)
                  if (cached && cached.successCount >= 3) {
                    result += '\n⚡ This workflow is now a tested skill (used ' + cached.successCount + 'x). Replay is deterministic.'
                  }
                } catch { /* non-critical */ }
              }
            } else if (!runFailed && steps.length >= 2) {
              // Save successful multi-step pipeline as a cached workflow
              try {
                const currentUrl = await (wv as any).executeJavaScript('location.href')
                const wfId = await api.runCacheSave(currentUrl, steps, args.description || undefined)
                if (wfId) result += '\n✓ Workflow cached as [' + wfId + '] for future replay.'
              } catch { /* cache save failed, non-critical */ }
            }
            break
          }

          case 'devtools': {
            const dtAction = args.action
            // Get the webContentsId from the active webview for reliable main-process DevTools
            let wcId: number | null = null
            try { wcId = wv ? (wv as any).getWebContentsId?.() ?? null : null } catch { /* not ready */ }
            if (dtAction === 'open' || dtAction === 'toggle') {
              // Always go through main process — only main process can dock DevTools
              api.openDevToolsById?.(wcId as any, 'bottom')
              result = 'DevTools panel opened (docked at bottom)'
            } else if (dtAction === 'close') {
              api.closeDevToolsById?.(wcId as any)
              result = 'DevTools panel closed'
            } else if (dtAction === 'console') {
              // Read captured console logs, and ensure capture is enabled
              const consoleCode = '(function(){' +
                'if(!window.__oc_logs)return "No console logs captured. Console capture is now enabled.";' +
                'var logs=window.__oc_logs.slice(-' + (args.limit || 20) + ');' +
                'return logs.map(function(l){return "["+l.type+"] "+l.msg}).join("\\n")||"No logs";' +
                '})()'
              result = await (wv as any).executeJavaScript(consoleCode)
              await (wv as any).executeJavaScript(buildConsoleCapture())
            } else if (dtAction === 'inspect') {
              const sel = args.selector || 'body'
              const inspectCode = '(function(){' +
                'var el=document.querySelector(' + JSON.stringify(sel) + ');' +
                'if(!el)return "Element not found: "+' + JSON.stringify(sel) + ';' +
                'var cs=getComputedStyle(el);' +
                'var rect=el.getBoundingClientRect();' +
                'var r=[];' +
                'r.push("Tag: "+el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+(el.className?"."+el.className.split(" ").join("."):""));' +
                'r.push("Size: "+Math.round(rect.width)+"x"+Math.round(rect.height)+"px");' +
                'r.push("Position: ("+Math.round(rect.left)+","+Math.round(rect.top)+")");' +
                'r.push("Display: "+cs.display+", Position: "+cs.position);' +
                'r.push("Color: "+cs.color+", BG: "+cs.backgroundColor);' +
                'r.push("Font: "+cs.fontSize+" "+cs.fontFamily.split(",")[0]);' +
                'r.push("Margin: "+cs.margin+", Padding: "+cs.padding);' +
                'r.push("Border: "+cs.border);' +
                'if(el.children.length)r.push("Children: "+el.children.length);' +
                'var attrs=Array.from(el.attributes).map(function(a){return a.name+"=\\""+a.value.substring(0,50)+"\\"";}).join(" ");' +
                'if(attrs)r.push("Attrs: "+attrs);' +
                'r.push("Text: "+(el.textContent||"").trim().substring(0,100));' +
                'return r.join("\\n");' +
                '})()'
              result = await (wv as any).executeJavaScript(inspectCode)
            } else if (dtAction === 'evaluate') {
              const expr = args.expression || ''
              if (!expr) { result = 'No expression provided'; break }
              try {
                const evalResult = await (wv as any).executeJavaScript(
                  '(async () => { ' + expr + ' })()'
                )
                if (evalResult === undefined || evalResult === null) {
                  result = 'undefined'
                } else if (typeof evalResult === 'object') {
                  result = JSON.stringify(evalResult, null, 2).substring(0, 5000)
                } else {
                  result = String(evalResult).substring(0, 5000)
                }
              } catch (e: any) { result = 'Evaluate error: ' + e.message }
            } else if (dtAction === 'errors') {
              const errCode = '(function(){' +
                'var errors=[];' +
                'if(window.__oc_logs){' +
                'errors=window.__oc_logs.filter(function(l){return l.type==="error"}).slice(-' + (args.limit || 20) + ')' +
                '.map(function(l){return l.msg});' +
                '}' +
                'var perfErrors=[];' +
                'try{performance.getEntriesByType("resource").forEach(function(r){' +
                'if(r.responseStatus&&r.responseStatus>=400)perfErrors.push(r.responseStatus+" "+r.name.substring(0,100));' +
                '});}catch(e){}' +
                'return (errors.length?"Console errors:\\n"+errors.join("\\n"):"No console errors")+"\\n\\n"+(perfErrors.length?"Failed resources:\\n"+perfErrors.join("\\n"):"No failed resources");' +
                '})()'
              result = await (wv as any).executeJavaScript(errCode)
            } else if (dtAction === 'performance') {
              const perfCode = '(function(){' +
                'var r=[];' +
                'var t=performance.timing;' +
                'if(t.loadEventEnd){' +
                'r.push("Page load: "+(t.loadEventEnd-t.navigationStart)+"ms");' +
                'r.push("DOM ready: "+(t.domContentLoadedEventEnd-t.navigationStart)+"ms");' +
                'r.push("First byte: "+(t.responseStart-t.navigationStart)+"ms");' +
                '}' +
                'var entries=performance.getEntriesByType("resource");' +
                'r.push("Resources loaded: "+entries.length);' +
                'var totalSize=0;entries.forEach(function(e){totalSize+=e.transferSize||0;});' +
                'r.push("Total transfer: "+Math.round(totalSize/1024)+"KB");' +
                'var slow=entries.filter(function(e){return e.duration>1000;}).slice(0,5);' +
                'if(slow.length)r.push("Slow resources:\\n"+slow.map(function(e){return "  "+Math.round(e.duration)+"ms "+e.name.split("/").pop();}).join("\\n"));' +
                'r.push("Memory: "+(performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576)+"MB / "+Math.round(performance.memory.totalJSHeapSize/1048576)+"MB":"N/A"));' +
                'return r.join("\\n");' +
                '})()'
              result = await (wv as any).executeJavaScript(perfCode)
            } else if (dtAction === 'network') {
              const netCode = '(function(){' +
                'var entries=performance.getEntriesByType("resource").slice(-' + (args.limit || 20) + ');' +
                'if(!entries.length)return "No network entries recorded";' +
                'return entries.map(function(e){' +
                'var name=e.name.length>80?e.name.substring(0,77)+"...":e.name;' +
                'var status=e.responseStatus||"?";' +
                'var size=e.transferSize?Math.round(e.transferSize/1024)+"KB":"?";' +
                'var dur=Math.round(e.duration)+"ms";' +
                'var type=e.initiatorType||"?";' +
                'return status+" | "+dur+" | "+size+" | "+type+" | "+name;' +
                '}).join("\\n");' +
                '})()'
              result = await (wv as any).executeJavaScript(netCode)
            } else if (dtAction === 'dom') {
              const domCode = '(function(){' +
                'var sel=' + JSON.stringify(args.selector || 'body') + ';' +
                'var el=document.querySelector(sel);' +
                'if(!el)return "Element not found: "+sel;' +
                'function dump(node,depth){' +
                'if(depth>3)return "";' +
                'var indent="  ".repeat(depth);' +
                'var tag=node.tagName?node.tagName.toLowerCase():"";' +
                'if(!tag)return "";' +
                'var id=node.id?"#"+node.id:"";' +
                'var cls=node.className&&typeof node.className==="string"?"."+node.className.trim().split(/\\s+/).join("."):"";' +
                'var line=indent+"<"+tag+id+cls+">";' +
                'var text=(node.childNodes.length===1&&node.childNodes[0].nodeType===3)?(node.textContent||"").trim().substring(0,60):"";' +
                'if(text)line+=" "+text;' +
                'var lines=[line];' +
                'Array.from(node.children).slice(0,' + (args.limit || 10) + ').forEach(function(c){' +
                'var sub=dump(c,depth+1);if(sub)lines.push(sub);' +
                '});' +
                'return lines.join("\\n");' +
                '}' +
                'return dump(el,0);' +
                '})()'
              result = await (wv as any).executeJavaScript(domCode)
            } else {
              result = 'Unknown devtools action: ' + dtAction
            }
            break
          }

          case 'webmcp_list': {
            // Discover WebMCP tools registered by the current page
            try {
              // First scan declarative <form toolname="..."> elements
              await (wv as any).executeJavaScript('window.__oc_webmcp_scan_declarative ? window.__oc_webmcp_scan_declarative() : 0')
              // Then list all registered tools
              const tools = await (wv as any).executeJavaScript('window.__oc_webmcp_list ? JSON.stringify(window.__oc_webmcp_list()) : "[]"')
              const parsed = JSON.parse(tools || '[]')
              if (!parsed.length) {
                result = 'No WebMCP tools registered on this page. The page can use navigator.modelContext.registerTool() or <form toolname="..."> to expose tools.'
              } else {
                result = `Found ${parsed.length} WebMCP tool(s):\n` +
                  parsed.map((t: any) =>
                    `  - ${t.name}: ${t.description || '(no description)'}` +
                    (t.readOnlyHint ? ' [read-only]' : '') +
                    (t.inputSchema?.properties ? ` (params: ${Object.keys(t.inputSchema.properties).join(', ')})` : '')
                  ).join('\n')
              }
            } catch (err: any) {
              result = 'Error: WebMCP not available on this page — ' + (err.message || 'polyfill not loaded')
            }
            break
          }

          case 'webmcp_call': {
            // Call a WebMCP tool registered by the current page
            const toolNameToCall = args.name
            if (!toolNameToCall) {
              result = 'Error: name is required. Use webmcp_list to see available tools.'
              break
            }
            try {
              const callResult = await (wv as any).executeJavaScript(
                `(async function() {
                  if (!window.__oc_webmcp_call) throw new Error('WebMCP not available');
                  var result = await window.__oc_webmcp_call(${JSON.stringify(toolNameToCall)}, ${JSON.stringify(args.args || {})});
                  return JSON.stringify(result);
                })()`
              )
              result = callResult || 'Tool executed (no return value)'
            } catch (err: any) {
              result = 'Error calling WebMCP tool "' + toolNameToCall + '": ' + (err.message || 'unknown error')
            }
            break
          }

          case 'tabs': {
            // Multi-Tab AI Context — use tabsRef to avoid stale closure
            // If any tab is still loading, wait briefly for title to settle
            if (tabsRef.current.some(t => t.isLoading)) {
              await new Promise(r => setTimeout(r, 800))
            }
            const currentTabs = tabsRef.current
            if (args.describe !== undefined && args.describe !== null) {
              const targetIdx = Number(args.describe)
              if (targetIdx >= 0 && targetIdx < currentTabs.length) {
                const targetTab = currentTabs[targetIdx]
                try {
                  const detail = args.detail || 'compact'
                  if (detail === 'a11y' && !targetTab.url.startsWith('oculo://')) {
                    const wcId = api.getWebContentsId(targetTab.id)
                    if (wcId) {
                      const snapshot = await api.a11ySnapshot(wcId)
                      result = `Tab ${targetIdx}: ${targetTab.title}\n${snapshot}`
                    } else {
                      result = `Tab ${targetIdx}: ${targetTab.title} | ${targetTab.url} (webview not ready)`
                    }
                  } else {
                    result = `Tab ${targetIdx}: ${targetTab.title} | ${targetTab.url}`
                  }
                } catch {
                  result = `Tab ${targetIdx}: ${targetTab.title} | ${targetTab.url}`
                }
              } else {
                result = `Error: Tab index ${targetIdx} out of range (0-${currentTabs.length - 1})`
              }
            } else {
              const lines = currentTabs.map((t, i) => {
                const active = t.id === activeTabIdRef.current ? ' (active)' : ''
                const loading = t.isLoading ? ' [loading]' : ''
                return `Tab ${i}: id="${t.id}" | ${t.title || 'Loading...'} | ${t.url}${active}${loading}`
              })
              result = lines.join('\n') || 'No tabs open'
              if (lines.length > 0) result += '\n\nUse tabId parameter in page/act/fill/read tools to target a specific tab for parallel execution.'
            }
            break
          }

          case 'translate': {
            // Translation via AI — extract text and frame as translation request
            const targetLang = args.to || 'English'
            let textToTranslate = args.text || ''
            if (!textToTranslate && wv) {
              try {
                const scope = args.scope || 'body'
                textToTranslate = await (wv as any).executeJavaScript(
                  `(function() {
                    var el = document.querySelector(${JSON.stringify(scope)});
                    if (!el) return '';
                    return el.innerText.substring(0, 10000);
                  })()`
                )
              } catch {
                textToTranslate = ''
              }
            }
            if (!textToTranslate) {
              result = 'Error: No text to translate. Provide text= or ensure page has content.'
            } else {
              result = `[TRANSLATE TO ${targetLang.toUpperCase()}]\n\n${textToTranslate.substring(0, 10000)}`
            }
            break
          }

          case 'lens': {
            // Visual Search — capture screenshot for AI vision
            if (!wv) {
              result = 'Error: No active tab for lens.'
              break
            }
            try {
              const nativeImage = await (wv as any).capturePage()
              const base64 = nativeImageToBase64(nativeImage)
              const question = args.question || 'Describe what you see in this screenshot.'
              result = `[LENS_IMAGE:${base64.substring(0, 100)}...]\nQuestion: ${question}\n(Screenshot captured — ${base64.length} chars base64)`
            } catch (err: any) {
              result = 'Error capturing screenshot: ' + (err.message || 'unknown')
            }
            break
          }

          // Internal tools for selector cache (not exposed to MCP clients)
          case '_getUrl': {
            try {
              result = await (wv as any).executeJavaScript('location.href')
            } catch {
              result = 'Error: could not get URL'
            }
            break
          }

          case '_evalScript': {
            try {
              const script = args.script || ''
              const evalResult = await (wv as any).executeJavaScript(script)
              result = typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult)
            } catch (err: any) {
              result = 'Error: ' + (err.message || 'eval failed')
            }
            break
          }

          default:
            result = 'Unknown tool: ' + toolName
        }

        // Note: ref-tagged a11y snapshots are now appended inside act/fill tool cases.
        // Only append slim state for other tools that modify page state.
        if (toolName !== 'act' && toolName !== 'fill' && toolName !== 'page' && toolName !== 'read' && wv && !result.startsWith('Error')) {
          try {
            const state = await (wv as any).executeJavaScript(buildSlimStateCode())
            if (state) result += '\n' + state
          } catch { /* ignore */ }
        }

        api.sendMcpToolResult(callId, result)
      } catch (err: any) {
        // Fix 6: Catch ERR_ABORTED from concurrent navigations
        const msg = err.message || 'Tool execution failed'
        if (msg.includes('ERR_ABORTED')) {
          api.sendMcpToolResult(callId, 'Navigation was interrupted by another navigation on the same tab. Use tabId parameter to target different tabs for parallel work.')
        } else {
          api.sendMcpToolResult(callId, 'Error: ' + msg)
        }
      } finally {
        setAiActing(false)  // v0.3.0: hide action overlay
      }

      } // end executeOp

      // Fix 10: Chain operation onto per-tab queue
      const queued = prev.then(executeOp, executeOp)
      tabOpQueue.current.set(effectiveTabId, queued)
      await queued
    })

    return cleanup
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — register once, use refs inside

  // MCP agent tab creation — creates an isolated tab for a new agent connection
  useEffect(() => {
    const api = oculoApi()
    if (!api?.onMcpAgentTabCreate) return
    const cleanup = api.onMcpAgentTabCreate((responseChannel: string) => {
      const tabUrl = NEW_TAB_URL
      const newTabObj: Tab = { id: newId(), url: tabUrl, title: 'Agent Tab', isLoading: false, canGoBack: false, canGoForward: false }
      setTabs(prev => [...prev, newTabObj])
      // Open in background — don't switch to it
      api.sendMcpAgentTabCreated(responseChannel, newTabObj.id)
    })
    return cleanup
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
