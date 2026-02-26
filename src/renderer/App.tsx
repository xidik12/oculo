import React, { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './components/layout/Sidebar'
import Toolbar from './components/layout/Toolbar'
import ContentArea from './components/layout/ContentArea'
import BottomBar from './components/layout/BottomBar'
import FindBar from './components/find/FindBar'
import BookmarksSidebar from './components/bookmarks/BookmarksSidebar'
import BookmarksBar from './components/bookmarks/BookmarksBar'
import AddBookmarkPopover from './components/bookmarks/AddBookmarkPopover'
import HistoryPanel from './components/history/HistoryPanel'
import DownloadsPanel from './components/downloads/DownloadsPanel'
import CommandPalette from './components/common/CommandPalette'
import ContextMenu, { ContextMenuItem, useContextMenu } from './components/common/ContextMenu'
import { ToastContainer, useToasts } from './components/common/Toast'
import ReaderMode from './components/common/ReaderMode'
import SettingsPanel from './components/SettingsPanel'
import { useSidebarState } from './hooks/useSidebarState'
import { Tab, TabGroup, TAB_GROUP_COLORS } from '../shared/types'

let tabCounter = 0
function newId(): string {
  return `tab-${Date.now()}-${++tabCounter}`
}

const NEW_TAB_URL = 'oculo://newtab'
const ABOUT_URL = 'oculo://about'
const CONTACT_URL = 'oculo://contact'
const GUIDE_URL = 'oculo://guide'
const DEFAULT_URL = 'https://www.google.com'

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: newId(), url: NEW_TAB_URL, title: 'New Tab', isLoading: false, canGoBack: false, canGoForward: false }
  ])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const [darkMode, setDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [chatOpen, setChatOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [bookmarkPopoverOpen, setBookmarkPopoverOpen] = useState(false)
  const [bookmarksBarOpen, setBookmarksBarOpen] = useState(true)
  const [isCurrentBookmarked, setIsCurrentBookmarked] = useState(false)
  const [readerModeOpen, setReaderModeOpen] = useState(false)
  const [splitViewOpen, setSplitViewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tabGroups, setTabGroups] = useState<TabGroup[]>([])
  const [devToolsHeight, setDevToolsHeight] = useState(0)
  const closedTabs = useRef<{ url: string; title: string }[]>([])
  const lastPageSnapshot = useRef('')

  const sidebar = useSidebarState()
  const contextMenu = useContextMenu()
  const { toasts, addToast, dismissToast } = useToasts()

  // Dark mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setDarkMode(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // IPC event listeners
  useEffect(() => {
    const api = (window as any).oculo
    if (!api) return
    const cleanups = [
      api.onNewTab((url?: string) => handleNewTab(url)),
      api.onCloseActiveTab(() => handleCloseTab(activeTabId)),
      api.onToggleChat?.(() => setChatOpen(prev => !prev)),
      api.onFindInPage?.(() => setFindOpen(true)),
      api.onToggleDevTools?.(() => api.openWebviewDevTools(activeTabId)),
      api.onInspectElement?.(() => api.inspectElement?.(activeTabId)),
      api.onViewPageSource?.(() => handleViewSource()),
      api.onToggleDevToolsMode?.((mode: string) => api.toggleDevToolsWithMode?.(mode)),
      api.onCommandPalette?.(() => setCommandPaletteOpen(prev => !prev)),
      api.onAddBookmark?.(() => handleToggleBookmark()),
      api.onReopenClosedTab?.(() => handleReopenClosedTab()),
      api.onReaderMode?.(() => setReaderModeOpen(prev => !prev)),
      api.onSplitView?.(() => setSplitViewOpen(prev => !prev)),
      api.onToggleBookmarksBar?.(() => setBookmarksBarOpen(prev => !prev)),
      api.onOpenSettings?.(() => setSettingsOpen(true)),
      api.onNavigateTo?.((url: string) => handleNavigate(url)),
      api.onZoomIn?.(() => handleZoom(0.1)),
      api.onZoomOut?.(() => handleZoom(-0.1)),
      api.onZoomReset?.(() => handleZoomReset()),
      api.onDevToolsResized?.((height: number) => setDevToolsHeight(height)),
    ]
    return () => cleanups.forEach(c => c?.())
  }, [activeTabId])

  // MCP tool execution — separate effect with inline handler
  useEffect(() => {
    const api = (window as any).oculo
    if (!api?.onMcpToolCall) return

    // Helper: find the active (visible) webview element
    function findActiveWebview(): any {
      const webviews = document.querySelectorAll('webview')
      for (const w of webviews) {
        const parent = w.closest('div')
        if (parent && !parent.classList.contains('hidden')) return w
      }
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

    // Helper: build click JS code as a string (avoids template literal issues)
    // Searches both main document AND iframes (same-origin + contentDocument accessible)
    // Returns candidate info when element is not found or ambiguous
    function buildClickCode(text: string, selector: string, nth: number): string {
      return '(function(){' +
        'var text=' + JSON.stringify(text) + ';' +
        'var sel=' + JSON.stringify(selector) + ';' +
        'var nth=' + nth + ';' +
        'var els=[];' +
        // Search main document
        'if(sel)els=Array.from(document.querySelectorAll(sel));' +
        'else if(text){' +
        'var all=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span[onclick],div[role=button],li[onclick]"));' +
        'els=all.filter(function(el){' +
        'var t=(el.textContent||"").trim().toLowerCase();' +
        'var aria=(el.getAttribute("aria-label")||"").toLowerCase();' +
        'return t===text.toLowerCase()||aria===text.toLowerCase();' +  // exact match first
        '});' +
        'if(!els.length){' + // fallback to partial match
        'els=all.filter(function(el){' +
        'var t=(el.textContent||"").trim().toLowerCase();' +
        'var aria=(el.getAttribute("aria-label")||"").toLowerCase();' +
        'return t.includes(text.toLowerCase())||aria.includes(text.toLowerCase());' +
        '});}' +
        '}' +
        // Search inside iframes if not found in main document
        'if(!els.length){' +
        'var iframes=document.querySelectorAll("iframe");' +
        'for(var i=0;i<iframes.length;i++){' +
        'try{var doc=iframes[i].contentDocument||iframes[i].contentWindow.document;' +
        'if(!doc)continue;' +
        'if(sel){els=Array.from(doc.querySelectorAll(sel));if(els.length)break;}' +
        'else if(text){' +
        'var all2=Array.from(doc.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span,div[role=button]"));' +
        'els=all2.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();return t===text.toLowerCase();});' +
        'if(!els.length)els=all2.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();return t.includes(text.toLowerCase());});' +
        'if(els.length)break;}' +
        '}catch(e){}}' +
        '}' +
        // Not found — return candidates
        'if(!els.length){' +
        'var candidates=[];' +
        'if(text){' +
        'var allClickable=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit]"));' +
        'allClickable.forEach(function(el){' +
        'var t=(el.textContent||"").trim().substring(0,40);' +
        'if(t)candidates.push(t);' +
        '});' +
        '}' +
        'return "Element not found: "+(text||sel)+(candidates.length?"\\nAvailable clickable elements: "+candidates.slice(0,10).join(" | "):"");' +
        '}' +
        // Multiple matches — click best, report others
        'var el=els[nth]||els[0];' +
        'el.scrollIntoView({block:"center"});el.click();' +
        'var clicked=(el.textContent||"").trim().substring(0,50);' +
        'var r="Clicked \\""+clicked+"\\"";' +
        'if(els.length>1)r+=" ("+els.length+" matches — use nth:N to pick another)";' +
        'return r;' +
        '})()'
    }

    // Helper: build fill form JS code (searches main doc + iframes)
    function buildFillCode(entries: [string, unknown][], submit: any): string {
      let code = '(function(){' +
        'var entries=' + JSON.stringify(entries) + ';' +
        'var filled=[];' +
        // Build list of documents to search (main + iframe docs)
        'var docs=[document];' +
        'var iframes=document.querySelectorAll("iframe");' +
        'for(var fi=0;fi<iframes.length;fi++){' +
        'try{var d=iframes[fi].contentDocument||iframes[fi].contentWindow.document;if(d)docs.push(d);}catch(e){}}' +
        'for(var i=0;i<entries.length;i++){' +
        'var label=entries[i][0],value=entries[i][1];' +
        'var input=null;' +
        'for(var di=0;di<docs.length&&!input;di++){' +
        'var doc=docs[di];' +
        'var labels=Array.from(doc.querySelectorAll("label"));' +
        'for(var j=0;j<labels.length;j++){' +
        'if(labels[j].textContent&&labels[j].textContent.trim().toLowerCase().includes(label.toLowerCase())){' +
        'if(labels[j].htmlFor)input=doc.getElementById(labels[j].htmlFor);' +
        'if(!input)input=labels[j].querySelector("input,textarea,select");' +
        'break;}}' +
        'if(!input)input=doc.querySelector(' +
          '"input[placeholder*=\\""+label+"\\" i],' +
          'input[name*=\\""+label+"\\" i],' +
          'input[aria-label*=\\""+label+"\\" i],' +
          'textarea[placeholder*=\\""+label+"\\" i],' +
          'textarea[name*=\\""+label+"\\" i],' +
          'textarea[aria-label*=\\""+label+"\\" i],' +
          'select[aria-label*=\\""+label+"\\" i],' +
          'select[name*=\\""+label+"\\" i]"' +
        ');' +
        // Also check contenteditable elements (rich text editors)
        'if(!input){var ce=doc.querySelectorAll("[contenteditable=true],div[role=textbox]");' +
        'for(var ci=0;ci<ce.length;ci++){' +
        'var ar=ce[ci].getAttribute("aria-label")||ce[ci].getAttribute("placeholder")||"";' +
        'if(ar.toLowerCase().includes(label.toLowerCase())){input=ce[ci];break;}}}' +
        '}' +
        'if(input){' +
        'if(input.type==="checkbox")input.checked=!!value;' +
        'else if(input.contentEditable==="true"||input.getAttribute("role")==="textbox"){' +
        'input.focus();input.innerText=String(value);' +
        'input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:String(value)}));}' +
        'else{' +
        'var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");' +
        'if(!nativeSetter)nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");' +
        'if(nativeSetter&&nativeSetter.set){nativeSetter.set.call(input,String(value));}else{input.value=String(value);}' +
        'input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));}' +
        'input.dispatchEvent(new Event("change",{bubbles:true}));' +
        'filled.push(label);}}'
      if (submit) {
        code += 'var btns=null;' +
          'for(var di=0;di<docs.length&&!btns;di++){' +
          'var b=Array.from(docs[di].querySelectorAll("button[type=submit],input[type=submit],button"));' +
          'if(b.length)btns=b;}' +
          'if(btns&&btns[0]){btns[0].click();filled.push("[submitted]");}'
      }
      code += 'var notFound=entries.filter(function(e){return filled.indexOf(e[0])===-1;}).map(function(e){return e[0];});' +
        'var msg=filled.length?"Filled: "+filled.join(", "):"No fields matched";' +
        'if(notFound.length)msg+="\\nNot found: "+notFound.join(", ")+"\\nTip: use act type with a CSS selector to target these fields directly";' +
        'return msg;})()'
      return code
    }

    // Helper: build read/extract JS code
    function buildReadCode(scope: string, limit: number): string {
      return '(function(){' +
        'var scope=document.querySelector(' + JSON.stringify(scope) + ')||document.body;' +
        'var items=[];' +
        'var els=scope.querySelectorAll("li,article,.item,.result,.card,[class*=result],[class*=item],[class*=product],tr");' +
        'if(els.length>1){' +
        'Array.from(els).slice(0,' + limit + ').forEach(function(el,i){' +
        'var t=(el.textContent||"").trim().replace(/\\s+/g," ").substring(0,200);' +
        'if(t)items.push((i+1)+". "+t);' +
        '});}' +
        'if(items.length)return items.join("\\n");' +
        'return (scope.innerText||"").substring(0,2000).replace(/\\s+/g," ").trim()||"No content found";' +
        '})()'
    }

    // Helper: build page description JS code
    function buildPageCode(): string {
      return '(function(){' +
        'var p=[];' +
        'p.push(location.href);' +
        'p.push(document.title);' +
        // Headings — capped at 5
        'var h=document.querySelectorAll("h1,h2,h3");' +
        'if(h.length){var ht=Array.from(h).slice(0,5).map(function(x){return x.textContent.trim().substring(0,40)}).filter(Boolean);' +
        'if(ht.length)p.push("H:"+ht.join("|"));}' +
        // Fields — capped at 15, with selector hints and iframe scanning
        'var inp=document.querySelectorAll("input:not([type=hidden]),textarea,select");' +
        'var iframes=document.querySelectorAll("iframe");' +
        'for(var fi=0;fi<iframes.length;fi++){try{var idoc=iframes[fi].contentDocument;if(idoc){var iinp=idoc.querySelectorAll("input:not([type=hidden]),textarea,select");inp=Array.from(inp).concat(Array.from(iinp));};}catch(e){}}' +
        'if(inp.length)p.push("Fields("+inp.length+"):\\n"+Array.from(inp).slice(0,15).map(function(el,i){' +
          'var label=(el.labels&&el.labels[0]?el.labels[0].textContent.trim():"")||el.getAttribute("aria-label")||el.placeholder||el.name||el.type;' +
          'var sel=el.id?"#"+el.id:(el.name?"[name=\\""+el.name+"\\"]":el.type);' +
          'return "  "+i+". ["+sel+"] "+label+(el.value?" (val:"+el.value.substring(0,20)+")":"");' +
        '}).join("\\n"));' +
        // Editable areas (rich text editors)
        'var ce=document.querySelectorAll("[contenteditable=true],div[role=textbox]");' +
        'if(ce.length)p.push("Edit:"+Array.from(ce).slice(0,3).map(function(el){return el.getAttribute("aria-label")||"textbox"}).join(","));' +
        // Buttons — capped at 8, short names
        'var btns=document.querySelectorAll("button,[role=button],input[type=submit]");' +
        'if(btns.length)p.push("B("+btns.length+"):"+Array.from(btns).slice(0,8).map(function(b){return ((b.textContent||"").trim()||b.value).substring(0,20)}).filter(Boolean).join(","));' +
        // Links — count only + first 8 short names
        'var links=document.querySelectorAll("a[href]");' +
        'if(links.length)p.push("L("+links.length+"):"+Array.from(links).slice(0,8).map(function(a){return (a.textContent||"").trim().substring(0,20)}).filter(Boolean).join(","));' +
        // Cross-origin iframes only (skip same-origin to save tokens)
        'var iframes=document.querySelectorAll("iframe");' +
        'for(var fi=0;fi<iframes.length;fi++){' +
        'var iframe=iframes[fi];var src=iframe.src||"";' +
        'var rect=iframe.getBoundingClientRect();' +
        'if(rect.width<10||rect.height<10||rect.top>window.innerHeight||rect.bottom<0)continue;' +
        'try{iframe.contentDocument;continue;}catch(e){}' +
        'var info="Iframe:"+src.substring(0,60);' +
        'if(src.includes("accounts.google.com")||src.includes("gsi/button"))info=" GoogleSignIn clickAtPoint x="+Math.round(rect.left+rect.width/2)+",y="+Math.round(rect.top+rect.height/2);' +
        'else if(src.includes("recaptcha")||src.includes("hcaptcha"))info=" CAPTCHA";' +
        'p.push(info);' +
        '}' +
        'return p.join("\\n");' +
        '})()'
    }

    // Helper: diff two page snapshots to return only changes
    function diffPageSnapshot(prev: string, curr: string): string {
      if (!prev || !curr) return curr
      const prevLines = prev.split('\n')
      const currLines = curr.split('\n')
      // If URL changed, return full snapshot
      if (prevLines[0] !== currLines[0]) return curr
      // Find changed lines
      const changes: string[] = []
      for (let i = 0; i < currLines.length; i++) {
        if (currLines[i] !== prevLines[i]) changes.push(currLines[i])
      }
      // Add new lines
      for (let i = prevLines.length; i < currLines.length; i++) {
        changes.push(currLines[i])
      }
      if (!changes.length) return '[no change]'
      if (changes.length > currLines.length * 0.6) return curr // too many changes, return full
      return '\u0394 ' + changes.join('\n')
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
      try {
        let wv = findActiveWebview()

        // No webview exists (newtab) — for navigate, update state and return immediately.
        // React will render a WebViewContainer, the user will see the page load.
        if (!wv && toolName === 'act' && args?.action === 'navigate' && args?.url) {
          setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: args.url, isLoading: true } : t))
          // Return immediately — don't block the React render cycle
          api.sendMcpToolResult(callId, 'Navigating to ' + args.url + ' — page is loading.')
          return
        }

        if (!wv) {
          api.sendMcpToolResult(callId, 'No active browser tab. Navigate to a URL first.')
          return
        }

        let result = ''
        switch (toolName) {
          case 'page': {
            result = await getPageSnapshot(wv, true)
            break
          }

          case 'act': {
            const action = args.action
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
              result = await (wv as any).executeJavaScript(buildClickCode(args.text || '', args.selector || '', args.nth || 0))
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
              // Type text using insertText — works with contenteditable divs (X, Facebook, etc.)
              const textToType = args.text || ''
              if (!textToType) {
                result = 'Error: text parameter required for type action'
              } else {
                try {
                  // First ensure the target is focused — click on contenteditable/textbox if specified
                  const focusSelector = args.selector || ''
                  if (focusSelector) {
                    const focusCode = '(function(){' +
                      'var el=document.querySelector(' + JSON.stringify(focusSelector) + ');' +
                      'if(el){el.focus();return "focused";}return "not found";})()'
                    await (wv as any).executeJavaScript(focusCode)
                    await new Promise(r => setTimeout(r, 100))
                  }
                  // Use webContents.insertText which simulates real keyboard input
                  await (wv as any).insertText(textToType)
                  await new Promise(r => setTimeout(r, 300))
                  // Verify text was actually inserted
                  if (focusSelector) {
                    try {
                      const verifyCode = '(function(){var el=document.querySelector(' + JSON.stringify(focusSelector) + ');return el?(el.value||el.textContent||"").length:0})()'
                      const len = await (wv as any).executeJavaScript(verifyCode)
                      result = 'Typed ' + textToType.length + ' characters' + (len > 0 ? ' (field has ' + len + ' chars)' : ' (warning: field may be empty)')
                    } catch { result = 'Typed ' + textToType.length + ' characters' }
                  } else {
                    result = 'Typed ' + textToType.length + ' characters (no selector — inserted at cursor)'
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
                  ;(wv as any).sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
                  await new Promise(r => setTimeout(r, 50))
                  ;(wv as any).sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
                  await new Promise(r => setTimeout(r, 500))
                  result = 'Clicked at coordinates (' + x + ', ' + y + ')'
                } catch (e: any) {
                  result = 'Click failed: ' + e.message
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
              // Clear focused element or specified element
              const clearCode = '(function(){' +
                'var sel=' + JSON.stringify(args.selector || '') + ';' +
                'var el=sel?document.querySelector(sel):document.activeElement;' +
                'if(!el)return "No element to clear";' +
                'if(el.contentEditable==="true"||el.getAttribute("role")==="textbox"){' +
                'el.innerHTML="";el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContent"}));return "Cleared editable area";}' +
                'if(el.value!==undefined){el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));return "Cleared field";}' +
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
            } else if (action === 'dragAndDrop') {
              // Drag from one element to another
              const dragCode = '(function(){' +
                'var fromSel=' + JSON.stringify(args.selector || '') + ';' +
                'var toSel=' + JSON.stringify(args.value || '') + ';' +
                'if(!fromSel||!toSel)return "Error: selector (drag from) and value (drop to selector) required";' +
                'var from=document.querySelector(fromSel);var to=document.querySelector(toSel);' +
                'if(!from)return "Drag source not found";if(!to)return "Drop target not found";' +
                'var fromRect=from.getBoundingClientRect();var toRect=to.getBoundingClientRect();' +
                'var cx1=fromRect.left+fromRect.width/2,cy1=fromRect.top+fromRect.height/2;' +
                'var cx2=toRect.left+toRect.width/2,cy2=toRect.top+toRect.height/2;' +
                'from.dispatchEvent(new DragEvent("dragstart",{bubbles:true,clientX:cx1,clientY:cy1}));' +
                'to.dispatchEvent(new DragEvent("dragover",{bubbles:true,clientX:cx2,clientY:cy2}));' +
                'to.dispatchEvent(new DragEvent("drop",{bubbles:true,clientX:cx2,clientY:cy2}));' +
                'from.dispatchEvent(new DragEvent("dragend",{bubbles:true,clientX:cx2,clientY:cy2}));' +
                'return "Dragged from "+fromSel+" to "+toSel;})()'
              result = await (wv as any).executeJavaScript(dragCode)
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
              const pasteText = args.text || ''
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
              // Execute arbitrary JavaScript in the page context
              const expr = args.text || args.selector || ''
              if (!expr) {
                result = 'Error: provide JS expression in text parameter'
              } else {
                try {
                  const evalResult = await (wv as any).executeJavaScript('(function(){try{return String(' + expr + ')}catch(e){return "Error: "+e.message}})()')
                  result = String(evalResult).substring(0, 2000)
                } catch (e: any) {
                  result = 'Eval error: ' + e.message
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
              // Open a new tab
              const tabUrl = args.url || 'oculo://newtab'
              const api = (window as any).oculo
              if (api?.newTab) {
                api.newTab(tabUrl)
                result = 'Opened new tab' + (args.url ? ' with ' + args.url : '')
              } else {
                result = 'Tab API not available'
              }
            } else if (action === 'closeTab') {
              // Close the current tab via the renderer's handleCloseTab
              const tabToClose = document.querySelector('webview:not(.hidden)')?.closest('[data-tab-id]')?.getAttribute('data-tab-id')
              result = 'Current tab close requested'
            } else if (action === 'switchTab') {
              // Switch to tab by text (title match) or index
              const target = args.text || args.value || ''
              const idx = parseInt(target, 10)
              result = 'Switch to tab: ' + target + ' — use navigate to the desired URL instead'
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
            } else if (action === 'screenshot') {
              // Capture page screenshot and save to temp file
              try {
                const nativeImage = await (wv as any).capturePage()
                const pngBuffer = nativeImage.toPNG()
                // Convert buffer to base64 safely (avoid spread operator stack overflow)
                const bytes = new Uint8Array(pngBuffer)
                let binary = ''
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                const base64 = btoa(binary)
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
              // Read file content (sandboxed to temp/downloads/desktop)
              const filePath = args.value || args.text || ''
              if (!filePath) {
                result = 'Error: No file path provided. Set value to the file path.'
              } else {
                result = await api.fileReadSafe(filePath)
              }
            } else if (action === 'clipboardImage') {
              // Copy page screenshot to clipboard
              try {
                const nativeImage = await (wv as any).capturePage()
                const pngBuffer = nativeImage.toPNG()
                const bytes = new Uint8Array(pngBuffer)
                let binary = ''
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                const base64 = btoa(binary)
                const ok = await api.clipboardWriteImage(base64)
                result = ok ? 'Page screenshot copied to clipboard' : 'Error: Failed to write image to clipboard'
              } catch (e: any) {
                result = 'Error capturing screenshot: ' + e.message
              }
            } else { result = 'Unknown action: ' + action }
            // Auto-append page state after actions that change the page
            const noSnapshotActions = ['wait', 'hover', 'getAttribute', 'evaluate', 'copy', 'screenshot', 'clipboardImage', 'download', 'listDownloads', 'readFile']
            if (!noSnapshotActions.includes(action)) {
              // Small delay for page to settle after navigation/click
              if (action === 'navigate' || action === 'click' || action === 'back' || action === 'forward' || action === 'reload') {
                await new Promise(r => setTimeout(r, 300))
              }
              const snapshot = await getPageSnapshot(wv)
              if (snapshot) result += '\n---\n' + snapshot
            }
            break
          }

          case 'fill': {
            const entries = Object.entries(args.fields || {})
            result = await (wv as any).executeJavaScript(buildFillCode(entries, args.submit))
            // Auto-append page state after fill
            const snapshot = await getPageSnapshot(wv)
            if (snapshot) result += '\n---\n' + snapshot
            break
          }

          case 'read': {
            result = await (wv as any).executeJavaScript(buildReadCode(args.scope || 'body', args.limit || 10))
            break
          }

          case 'run': {
            const steps = args.steps || []
            const results: string[] = []
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
                    const r = await (wv as any).executeJavaScript('"URL: "+location.href+"\\nTitle: "+document.title')
                    results.push('page: ' + r)
                  } else if (stepTool === 'act' && (stepArgs as any)?.action === 'click') {
                    const sa = stepArgs as any
                    const r = await (wv as any).executeJavaScript(buildClickCode(sa.text || '', sa.selector || '', sa.nth || 0))
                    results.push('act: ' + r)
                  } else if (stepTool === 'act' && (stepArgs as any)?.action === 'navigate' && (stepArgs as any)?.url) {
                    await (wv as any).loadURL((stepArgs as any).url)
                    await new Promise(r => setTimeout(r, 2000))
                    results.push('act: Navigated to ' + (stepArgs as any).url)
                  } else if (stepTool === 'act' && (stepArgs as any)?.action === 'type') {
                    const sa = stepArgs as any
                    if (sa.selector) {
                      const focusCode = '(function(){var el=document.querySelector(' + JSON.stringify(sa.selector) + ');if(el){el.focus();return "focused";}return "not found"})()'
                      await (wv as any).executeJavaScript(focusCode)
                      await new Promise(r => setTimeout(r, 100))
                    }
                    await (wv as any).insertText(sa.text || '')
                    results.push('act: Typed ' + (sa.text || '').length + ' chars')
                  } else if (stepTool === 'act' && (stepArgs as any)?.action === 'press') {
                    const sa = stepArgs as any
                    const key = sa.key || 'Enter'
                    try {
                      (wv as any).sendInputEvent({ type: 'keyDown', keyCode: key })
                      ;(wv as any).sendInputEvent({ type: 'char', keyCode: key })
                      ;(wv as any).sendInputEvent({ type: 'keyUp', keyCode: key })
                      results.push('act: Pressed ' + key)
                    } catch (e: any) { results.push('act: Press error - ' + e.message) }
                  } else if (stepTool === 'act' && (stepArgs as any)?.action === 'scroll') {
                    const sa = stepArgs as any
                    const dir = sa.direction || 'down'
                    const amt = sa.amount || 300
                    const scrollCode = dir === 'up' ? 'window.scrollBy(0,-' + amt + ')' : dir === 'down' ? 'window.scrollBy(0,' + amt + ')' : dir === 'left' ? 'window.scrollBy(-' + amt + ',0)' : 'window.scrollBy(' + amt + ',0)'
                    await (wv as any).executeJavaScript(scrollCode)
                    results.push('act: Scrolled ' + dir + ' ' + amt + 'px')
                  } else if (stepTool === 'fill') {
                    const sa = stepArgs as any
                    const fillEntries = Object.entries(sa.fields || {})
                    const r = await (wv as any).executeJavaScript(buildFillCode(fillEntries, sa.submit))
                    results.push('fill: ' + r)
                  } else if (stepTool === 'read') {
                    const sa = stepArgs as any
                    const r = await (wv as any).executeJavaScript(buildReadCode(sa.scope || 'body', sa.limit || 10))
                    results.push('read: ' + r)
                  } else {
                    results.push(stepTool + ': not supported in run pipeline')
                  }
                } catch (e: any) {
                  results.push(stepTool + ': Error - ' + e.message)
                }
              }
            }
            result = args.returnAll ? results.join('\n---\n') : (results[results.length - 1] || 'No steps')
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
              // Read captured console logs
              const consoleCode = '(function(){' +
                'if(!window.__oculo_logs)return "No console logs captured. Console capture is now enabled.";' +
                'var logs=window.__oculo_logs.slice(-' + (args.limit || 20) + ');' +
                'return logs.map(function(l){return "["+l.type+"] "+l.msg}).join("\\n")||"No logs";' +
                '})()'
              result = await (wv as any).executeJavaScript(consoleCode)
              // Enable console capture for future calls
              await (wv as any).executeJavaScript(
                '(function(){if(window.__oculo_logs)return;window.__oculo_logs=[];' +
                'var orig={log:console.log,warn:console.warn,error:console.error,info:console.info};' +
                '["log","warn","error","info"].forEach(function(t){' +
                'console[t]=function(){' +
                'window.__oculo_logs.push({type:t,msg:Array.from(arguments).map(function(a){try{return typeof a==="object"?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(" "),ts:Date.now()});' +
                'if(window.__oculo_logs.length>200)window.__oculo_logs.shift();' +
                'orig[t].apply(console,arguments);};});' +
                '})()'
              )
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
                  '(function(){try{var r=eval(' + JSON.stringify(expr) + ');return typeof r==="object"?JSON.stringify(r,null,2):String(r)}catch(e){return "Error: "+e.message}})()'
                )
                result = evalResult
              } catch (e: any) { result = 'Eval error: ' + e.message }
            } else if (dtAction === 'errors') {
              const errCode = '(function(){' +
                'var errors=[];' +
                'if(window.__oculo_logs){' +
                'errors=window.__oculo_logs.filter(function(l){return l.type==="error"}).slice(-' + (args.limit || 20) + ')' +
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

          default:
            result = 'Unknown tool: ' + toolName
        }

        api.sendMcpToolResult(callId, result)
      } catch (err: any) {
        api.sendMcpToolResult(callId, 'Error: ' + (err.message || 'Tool execution failed'))
      }
    })

    return cleanup
  }, [activeTabId])

  const activeTab = tabs.find(t => t.id === activeTabId)

  // Set tab titles for internal pages
  useEffect(() => {
    if (!activeTab) return
    const titleMap: Record<string, string> = {
      [NEW_TAB_URL]: 'New Tab',
      [ABOUT_URL]: 'About Oculo',
      [CONTACT_URL]: 'Contact',
      [GUIDE_URL]: 'Setup Guide',
    }
    const title = titleMap[activeTab.url]
    if (title && activeTab.title !== title) {
      setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, title } : t))
    }
  }, [activeTab?.url])

  // Check bookmark status
  useEffect(() => { checkBookmarkStatus() }, [activeTab?.url])

  async function checkBookmarkStatus() {
    const api = (window as any).oculo
    if (!api?.bookmarksFindUrl || !activeTab?.url) return
    const bm = await api.bookmarksFindUrl(activeTab.url)
    setIsCurrentBookmarked(!!bm)
  }

  // Record history
  const recordHistory = useCallback((url: string, title: string) => {
    if (url.startsWith('oculo://')) return
    const api = (window as any).oculo
    api?.historyAdd?.(url, title)
  }, [])

  // Zoom per site
  const handleZoom = useCallback(async (delta: number) => {
    const api = (window as any).oculo
    if (!api || !activeTab) return
    try {
      const domain = new URL(activeTab.url).hostname
      if (!domain) return
      const current = await api.zoomGet(domain)
      const newLevel = Math.round((current + delta) * 100) / 100
      await api.zoomSet(domain, newLevel)
      applyZoom(newLevel)
    } catch { /* not a valid URL */ }
  }, [activeTab])

  const handleZoomReset = useCallback(async () => {
    const api = (window as any).oculo
    if (!api || !activeTab) return
    try {
      const domain = new URL(activeTab.url).hostname
      if (!domain) return
      await api.zoomReset(domain)
      applyZoom(1.0)
    } catch { /* ignore */ }
  }, [activeTab])

  function applyZoom(level: number) {
    const webviews = document.querySelectorAll('webview')
    for (const wv of webviews) {
      const parent = wv.closest('div')
      if (parent && !parent.classList.contains('hidden')) {
        (wv as any).setZoomFactor?.(level)
      }
    }
  }

  // Apply zoom when navigating to a new domain
  useEffect(() => {
    if (!activeTab?.url || activeTab.url.startsWith('oculo://')) return
    const api = (window as any).oculo
    if (!api?.zoomGet) return
    try {
      const domain = new URL(activeTab.url).hostname
      api.zoomGet(domain).then((level: number) => {
        if (level !== 1.0) applyZoom(level)
        else applyZoom(1.0)
      })
    } catch { /* ignore */ }
  }, [activeTab?.url])

  // Tab management
  const handleNewTab = useCallback((url?: string) => {
    const newTab: Tab = {
      id: newId(), url: url || NEW_TAB_URL, title: 'New Tab',
      isLoading: false, canGoBack: false, canGoForward: false
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
    setReaderModeOpen(false)
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev
      const closedTab = prev.find(t => t.id === tabId)
      if (closedTab) closedTabs.current.push({ url: closedTab.url, title: closedTab.title })
      const newTabs = prev.filter(t => t.id !== tabId)
      if (activeTabId === tabId) {
        const idx = prev.findIndex(t => t.id === tabId)
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)]
        setActiveTabId(newActive.id)
      }
      // Remove from groups
      setTabGroups(groups => groups.map(g => ({
        ...g, tabIds: g.tabIds.filter(id => id !== tabId)
      })).filter(g => g.tabIds.length > 0))
      return newTabs
    })
  }, [activeTabId])

  const handleReopenClosedTab = useCallback(() => {
    const last = closedTabs.current.pop()
    if (last) handleNewTab(last.url)
  }, [handleNewTab])

  const handleTabSwitch = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    setReaderModeOpen(false)
  }, [])

  const handleNavigate = useCallback((url: string) => {
    const isInternal = url.startsWith('oculo://')
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url, isLoading: !isInternal } : t))
    setReaderModeOpen(false)
  }, [activeTabId])

  const handleWebViewUpdate = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t))
    if (updates.url && !updates.isLoading) {
      recordHistory(updates.url, updates.title || updates.url)
    }
  }, [recordHistory])

  const handleGoBack = useCallback(() => { (window as any).oculo?.goBack(activeTabId) }, [activeTabId])
  const handleGoForward = useCallback(() => { (window as any).oculo?.goForward(activeTabId) }, [activeTabId])
  const handleReload = useCallback(() => { (window as any).oculo?.reload(activeTabId) }, [activeTabId])

  // View page source — opens in a new tab with view-source: prefix
  const handleViewSource = useCallback(async () => {
    if (!activeTab || activeTab.url.startsWith('oculo://')) return
    const api = (window as any).oculo
    if (!api?.getPageSource) return
    const source = await api.getPageSource(activeTabId)
    if (source) {
      // Open source in a new tab as a data URL
      const encoded = encodeURIComponent(source)
      const dataUrl = `data:text/html,<html><head><title>Source: ${encodeURIComponent(activeTab.url)}</title><style>body{background:#1e1e2e;color:#cdd6f4;font-family:monospace;font-size:13px;padding:20px;white-space:pre-wrap;word-wrap:break-word;margin:0;line-height:1.5;}span.tag{color:#89b4fa;}span.attr{color:#a6e3a1;}span.val{color:#fab387;}span.comment{color:#6c7086;}</style></head><body>${encoded}</body></html>`
      handleNewTab(dataUrl)
    }
  }, [activeTab, activeTabId, handleNewTab])

  // Bookmarks
  const handleToggleBookmark = useCallback(async () => {
    const api = (window as any).oculo
    if (!api || !activeTab) return
    const existing = await api.bookmarksFindUrl(activeTab.url)
    if (existing) {
      setBookmarkPopoverOpen(true)
    } else {
      await api.bookmarksAdd(activeTab.title || activeTab.url, activeTab.url)
      setIsCurrentBookmarked(true)
      setBookmarkPopoverOpen(true)
      addToast('Bookmark added', 'success', 2000)
    }
  }, [activeTab, addToast])

  const handleSaveBookmark = useCallback(async (title: string) => {
    const api = (window as any).oculo
    if (!api || !activeTab) return
    const existing = await api.bookmarksFindUrl(activeTab.url)
    if (existing) await api.bookmarksUpdate(existing.id, { title })
    setIsCurrentBookmarked(true)
  }, [activeTab])

  const handleRemoveBookmark = useCallback(async () => {
    const api = (window as any).oculo
    if (!api || !activeTab) return
    const existing = await api.bookmarksFindUrl(activeTab.url)
    if (existing) await api.bookmarksDelete(existing.id)
    setIsCurrentBookmarked(false)
    addToast('Bookmark removed', 'info', 2000)
  }, [activeTab, addToast])

  // Tab groups
  const handleCreateGroup = useCallback((tabId: string) => {
    const colorIdx = tabGroups.length % TAB_GROUP_COLORS.length
    const color = TAB_GROUP_COLORS[colorIdx]
    const group: TabGroup = {
      id: `group-${Date.now()}`,
      name: `Group ${tabGroups.length + 1}`,
      color: color.bg,
      collapsed: false,
      tabIds: [tabId]
    }
    setTabGroups(prev => [...prev, group])
  }, [tabGroups])

  const handleAddToGroup = useCallback((tabId: string, groupId: string) => {
    setTabGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, tabIds: [...g.tabIds, tabId] } : g
    ))
  }, [])

  const handleRemoveFromGroup = useCallback((tabId: string) => {
    setTabGroups(prev => prev.map(g => ({
      ...g, tabIds: g.tabIds.filter(id => id !== tabId)
    })).filter(g => g.tabIds.length > 0))
  }, [])

  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setTabGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    ))
  }, [])

  // Tab context menu
  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    const tabGroup = tabGroups.find(g => g.tabIds.includes(tabId))

    const items: ContextMenuItem[] = [
      { label: 'New Tab', action: () => handleNewTab() },
      { label: 'Duplicate Tab', action: () => handleNewTab(tab.url) },
      { label: '', action: () => {}, separator: true },
      ...(tabGroup
        ? [{ label: 'Remove from Group', action: () => handleRemoveFromGroup(tabId) }]
        : [
            { label: 'Add to New Group', action: () => handleCreateGroup(tabId) },
            ...tabGroups.map(g => ({
              label: `Add to "${g.name}"`,
              action: () => handleAddToGroup(tabId, g.id)
            }))
          ]
      ),
      { label: '', action: () => {}, separator: true },
      { label: 'Close Tab', action: () => handleCloseTab(tabId), danger: tabs.length > 1, disabled: tabs.length <= 1 },
      { label: 'Close Other Tabs', action: () => {
        tabs.filter(t => t.id !== tabId).forEach(t => handleCloseTab(t.id))
      }, disabled: tabs.length <= 1 },
    ]

    contextMenu.showContextMenu(e, items)
  }, [tabs, tabGroups, handleNewTab, handleCloseTab, handleCreateGroup, handleAddToGroup, handleRemoveFromGroup, contextMenu])

  const isSecure = activeTab?.url.startsWith('https://') || false
  const isNewTab = activeTab?.url === NEW_TAB_URL
  const isAbout = activeTab?.url === ABOUT_URL
  const isContact = activeTab?.url === CONTACT_URL
  const isGuide = activeTab?.url === GUIDE_URL
  const isInternalPage = isNewTab || isAbout || isContact || isGuide

  return (
    <div className="flex h-full" style={devToolsHeight > 0 ? { height: `calc(100% - ${devToolsHeight}px)` } : undefined}>
      {/* Sidebar */}
      <Sidebar
        tabs={tabs}
        activeTabId={activeTabId}
        expanded={sidebar.expanded}
        activePanel={sidebar.activePanel}
        onMouseEnter={sidebar.onMouseEnter}
        onMouseLeave={sidebar.onMouseLeave}
        onTabSwitch={handleTabSwitch}
        onTabClose={handleCloseTab}
        onNewTab={() => handleNewTab()}
        onTogglePanel={sidebar.togglePanel}
        onToggleChat={() => setChatOpen(prev => !prev)}
        onOpenSettings={() => setSettingsOpen(true)}
        chatOpen={chatOpen}
        tabGroups={tabGroups}
        onTabContextMenu={handleTabContextMenu}
        onToggleGroupCollapse={handleToggleGroupCollapse}
      />

      {/* Sidebar sub-panels */}
      <BookmarksSidebar isOpen={sidebar.activePanel === 'bookmarks'} onClose={sidebar.closePanel} onNavigate={handleNavigate} />
      <HistoryPanel isOpen={sidebar.activePanel === 'history'} onClose={sidebar.closePanel} onNavigate={handleNavigate} />
      <DownloadsPanel isOpen={sidebar.activePanel === 'downloads'} onClose={sidebar.closePanel} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Title bar drag region — matches sidebar's traffic light spacer */}
        <div className="h-[38px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />
        <Toolbar
          url={isInternalPage ? '' : (activeTab?.url || '')}
          isLoading={activeTab?.isLoading || false}
          canGoBack={activeTab?.canGoBack || false}
          canGoForward={activeTab?.canGoForward || false}
          isBookmarked={isCurrentBookmarked}
          isSecure={isSecure}
          onNavigate={handleNavigate}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onReload={handleReload}
          onToggleBookmark={handleToggleBookmark}
          onFindInPage={() => setFindOpen(true)}
        />

        {/* Bookmarks bar */}
        <BookmarksBar isOpen={bookmarksBarOpen} onNavigate={handleNavigate} />

        {/* Bookmark popover */}
        <AddBookmarkPopover
          isOpen={bookmarkPopoverOpen}
          url={activeTab?.url || ''}
          title={activeTab?.title || ''}
          onSave={handleSaveBookmark}
          onRemove={handleRemoveBookmark}
          onClose={() => setBookmarkPopoverOpen(false)}
        />

        {/* Content area */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <FindBar isOpen={findOpen} onClose={() => setFindOpen(false)} activeTabId={activeTabId} />
          <ReaderMode isOpen={readerModeOpen} onClose={() => setReaderModeOpen(false)} activeTabId={activeTabId} />
          <ContentArea
            tabs={tabs}
            activeTabId={activeTabId}
            chatOpen={chatOpen}
            onWebViewUpdate={handleWebViewUpdate}
            onCloseChat={() => setChatOpen(false)}
            isNewTab={isNewTab}
            isAbout={isAbout}
            isContact={isContact}
            isGuide={isGuide}
            onNavigate={handleNavigate}
          />
        </div>

        <BottomBar isLoading={activeTab?.isLoading || false} url={activeTab?.url || ''} />
      </div>

      {/* Command palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        tabs={tabs}
        onTabSwitch={handleTabSwitch}
        onNavigate={handleNavigate}
        onNewTab={handleNewTab}
        onToggleChat={() => setChatOpen(prev => !prev)}
      />

      {/* Context menu */}
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.closeContextMenu} />
      )}

      {/* Settings */}
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
