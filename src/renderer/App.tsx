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
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
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
  const lastA11ySnapshot = useRef('')

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
        // Click by ref number: text="#3" → click window.__oculoRefs[2]
        'if(text.match(/^#\\d+$/)&&window.__oculoRefs){' +
        'var idx=parseInt(text.substring(1))-1;' +
        'var ref=window.__oculoRefs[idx];' +
        'if(ref){ref.scrollIntoView({block:"center"});' +
        'var r0=ref.getBoundingClientRect();var cx0=r0.left+r0.width/2+Math.random()*4-2,cy0=r0.top+r0.height/2+Math.random()*4-2;' +
        'ref.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,clientX:cx0,clientY:cy0}));' +
        'ref.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:cx0,clientY:cy0}));' +
        'ref.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,clientX:cx0,clientY:cy0}));' +
        'ref.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:cx0,clientY:cy0}));' +
        'return "Clicked #"+(idx+1)+" \\""+((ref.textContent||"").trim().substring(0,40))+"\\""}' +
        'return "Ref "+text+" not found ("+window.__oculoRefs.length+" refs available)";}' +
        // Visibility helper
        'function vis(el){if(!el)return false;var r=el.getBoundingClientRect();' +
        'if(r.width<2||r.height<2)return false;' +
        'var s=getComputedStyle(el);' +
        'return s.display!=="none"&&s.visibility!=="hidden"&&s.opacity!=="0";}' +
        'var els=[];' +
        // Search main document — only visible elements
        'if(sel)els=Array.from(document.querySelectorAll(sel)).filter(vis);' +
        'else if(text){' +
        'var all=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span[onclick],div[role=button],li[onclick]")).filter(vis);' +
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
        // Search shadow DOMs
        'if(!els.length){' +
        'function searchShadow(root){' +
        'var all=root.querySelectorAll("*");' +
        'for(var i=0;i<all.length;i++){' +
        'if(!all[i].shadowRoot)continue;' +
        'var sr=all[i].shadowRoot;' +
        'if(sel){var found=Array.from(sr.querySelectorAll(sel));if(found.length){els=found;return;}}' +
        'else if(text){var sAll=Array.from(sr.querySelectorAll("a,button,[role=button],input[type=submit]"));' +
        'var match=sAll.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();return t.includes(text.toLowerCase());});' +
        'if(match.length){els=match;return;}}' +
        'searchShadow(sr);}}' +
        'try{searchShadow(document);}catch(e){}}' +
        // Not found among visible — try ALL elements (including scrolled-out-of-view in modals)
        'if(!els.length){' +
        'if(sel)els=Array.from(document.querySelectorAll(sel));' +
        'else if(text){' +
        'var all3=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span[onclick],div[role=button],li[onclick]"));' +
        'els=all3.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();var aria=(el.getAttribute("aria-label")||"").toLowerCase();return t===text.toLowerCase()||aria===text.toLowerCase();});' +
        'if(!els.length)els=all3.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();var aria=(el.getAttribute("aria-label")||"").toLowerCase();return t.includes(text.toLowerCase())||aria.includes(text.toLowerCase());});' +
        '}' +
        // Found in DOM but was scrolled out — scroll into view and click
        'if(els.length){' +
        'var el2=els[nth]||els[0];el2.scrollIntoView({block:"center",behavior:"smooth"});' +
        'setTimeout(function(){' +
        'var r2=el2.getBoundingClientRect();var cx2=r2.left+r2.width/2+Math.random()*4-2,cy2=r2.top+r2.height/2+Math.random()*4-2;' +
        'el2.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,clientX:cx2,clientY:cy2}));' +
        'el2.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:cx2,clientY:cy2}));' +
        'el2.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,clientX:cx2,clientY:cy2}));' +
        'el2.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:cx2,clientY:cy2}));' +
        '},300);' +
        'return "Scrolled to and clicked \\""+((el2.textContent||"").trim().substring(0,50))+"\\" (was out of view)";}' +
        '}' +
        // Truly not found — return candidates
        'if(!els.length){' +
        'var candidates=[];' +
        'if(text){' +
        'var allClickable=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit]"));' +
        'allClickable.forEach(function(el){' +
        'var t=(el.textContent||"").trim().substring(0,40);' +
        'if(t)candidates.push(t);' +
        '});' +
        '}' +
        'return "Element not found: "+(text||sel)+(candidates.length?"\\nAll clickable elements on page: "+candidates.slice(0,10).join(" | "):"");' +
        '}' +
        // Multiple matches — click best, report others
        'var el=els[nth]||els[0];' +
        'el.scrollIntoView({block:"center"});' +
        'var r1=el.getBoundingClientRect();var cx1=r1.left+r1.width/2+Math.random()*4-2,cy1=r1.top+r1.height/2+Math.random()*4-2;' +
        'el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,clientX:cx1,clientY:cy1}));' +
        'el.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:cx1,clientY:cy1}));' +
        'el.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,clientX:cx1,clientY:cy1}));' +
        'el.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:cx1,clientY:cy1}));' +
        'var clicked=(el.textContent||"").trim().substring(0,50);' +
        'var r="Clicked \\""+clicked+"\\"";' +
        'if(els.length>1)r+=" ("+els.length+" matches — use nth:N to pick another)";' +
        'return r;' +
        '})()'
    }

    // Helper: build fill form JS code (searches main doc + iframes)
    // Matching priority:
    //   1. CSS selector — if label starts with # or . or [, use querySelector
    //   2. Exact ID/name — if field id or name equals label exactly
    //   3. <label> text — label.textContent includes the search text
    //   4. Attributes — placeholder, name, aria-label (case-insensitive includes)
    //   5. Nearby text — preceding sibling/parent text that describes the field
    //   6. Contenteditable — aria-label or placeholder on editable divs
    function buildFillCode(entries: [string, unknown][], submit: any): string {
      let code = '(function(){' +
        'var entries=' + JSON.stringify(entries) + ';' +
        'var filled=[];var mismatched=[];' +
        // Count fields before filling (for dynamic re-scan)
        'var fieldsBefore=document.querySelectorAll("input:not([type=hidden]),textarea,select").length;' +
        // Build list of documents to search (main + iframe docs)
        'var docs=[document];' +
        'var iframes=document.querySelectorAll("iframe");' +
        'for(var fi=0;fi<iframes.length;fi++){' +
        'try{var d=iframes[fi].contentDocument||iframes[fi].contentWindow.document;if(d)docs.push(d);}catch(e){}}' +
        // Also collect shadow DOM documents
        'function collectShadowDocs(root){' +
        'var all=root.querySelectorAll("*");' +
        'for(var si=0;si<all.length;si++){' +
        'if(all[si].shadowRoot)docs.push(all[si].shadowRoot);collectShadowDocs(all[si].shadowRoot);}' +
        '}' +
        'try{collectShadowDocs(document);}catch(e){}' +
        // Helper: get visible text near a field (preceding label text, parent text)
        'function nearbyText(el){' +
        'var texts=[];' +
        'if(el.id){var lb=document.querySelector("label[for=\\""+el.id+"\\"]");if(lb)texts.push(lb.textContent.trim());}' +
        'var wl=el.closest("label");if(wl)texts.push(wl.textContent.trim());' +
        'var prev=el.previousElementSibling;' +
        'if(prev){var pt=prev.textContent.trim();if(pt.length>1&&pt.length<200)texts.push(pt);}' +
        'var par=el.parentElement;' +
        'if(par){var kids=Array.from(par.children);var idx=kids.indexOf(el);' +
        'for(var k=Math.max(0,idx-2);k<idx;k++){var kt=kids[k].textContent.trim();if(kt.length>1&&kt.length<200)texts.push(kt);}}' +
        'var descId=el.getAttribute("aria-describedby");' +
        'if(descId){var dEl=document.getElementById(descId);if(dEl)texts.push(dEl.textContent.trim());}' +
        'return texts;}' +
        // Helper: fuzzy match — checks if strings share significant tokens
        'function fuzzyMatch(a,b){' +
        'a=a.toLowerCase();b=b.toLowerCase();' +
        'if(a===b||a.includes(b)||b.includes(a))return true;' +
        // Token overlap: split by spaces/punctuation, check overlap
        'var ta=a.split(/[\\s\\-_\\/]+/).filter(function(t){return t.length>2;});' +
        'var tb=b.split(/[\\s\\-_\\/]+/).filter(function(t){return t.length>2;});' +
        'if(!ta.length||!tb.length)return false;' +
        'var matches=0;for(var i=0;i<ta.length;i++){for(var j=0;j<tb.length;j++){if(ta[i]===tb[j])matches++;}}' +
        'return matches>=Math.min(ta.length,tb.length)*0.5;}' +
        // Main loop
        'for(var i=0;i<entries.length;i++){' +
        'var label=entries[i][0],value=entries[i][1];' +
        'var input=null;' +
        'for(var di=0;di<docs.length&&!input;di++){' +
        'var doc=docs[di];' +
        // 1. CSS selector
        'if(label.match(/^[#.\\[]/)){try{input=doc.querySelector(label);}catch(e){}}' +
        // 2. Exact ID/name match
        'if(!input){try{input=doc.getElementById(label);}catch(e){}}' +
        'if(!input){var byName=doc.querySelectorAll("[name=\\""+label+"\\"]");if(byName.length===1)input=byName[0];}' +
        // 3. <label> text matching (includes + fuzzy)
        'if(!input){' +
        'var labels=Array.from(doc.querySelectorAll("label"));' +
        'for(var j=0;j<labels.length;j++){' +
        'var lt=labels[j].textContent?labels[j].textContent.trim():"";' +
        'if(lt&&fuzzyMatch(lt,label)){' +
        'if(labels[j].htmlFor)input=doc.getElementById(labels[j].htmlFor);' +
        'if(!input)input=labels[j].querySelector("input,textarea,select");' +
        'break;}}}' +
        // 4. Attributes — placeholder, aria-label
        'if(!input){' +
        'var safeLabel=label.replace(/["\\\\]/g,"");' +
        'if(safeLabel.length>0&&safeLabel.length<100){' +
        'try{input=doc.querySelector(' +
          '"input[placeholder*=\\""+safeLabel+"\\" i],' +
          'input[aria-label*=\\""+safeLabel+"\\" i],' +
          'textarea[placeholder*=\\""+safeLabel+"\\" i],' +
          'textarea[aria-label*=\\""+safeLabel+"\\" i],' +
          'select[aria-label*=\\""+safeLabel+"\\" i],' +
          '[data-placeholder*=\\""+safeLabel+"\\" i],' +
          '[aria-placeholder*=\\""+safeLabel+"\\" i]"' +
        ');}catch(e){}}}' +
        // 5. Nearby text — walk all inputs, check with fuzzy matching
        'if(!input){' +
        'var allInputs=Array.from(doc.querySelectorAll("input:not([type=hidden]),textarea,select"));' +
        'for(var ai=0;ai<allInputs.length;ai++){' +
        'var nt=nearbyText(allInputs[ai]);' +
        'for(var ni=0;ni<nt.length;ni++){' +
        'if(fuzzyMatch(nt[ni],label)){input=allInputs[ai];break;}}' +
        'if(input)break;}}' +
        // 6. Contenteditable elements (DraftJS, ProseMirror, etc.)
        'if(!input){var ce=doc.querySelectorAll("[contenteditable=true],[role=textbox]");' +
        'for(var ci=0;ci<ce.length;ci++){' +
        'var ar=ce[ci].getAttribute("aria-label")||ce[ci].getAttribute("placeholder")||ce[ci].getAttribute("data-placeholder")||ce[ci].getAttribute("aria-placeholder")||"";' +
        'if(fuzzyMatch(ar,label)){input=ce[ci];break;}}}' +
        '}' +
        // Set value and verify
        'if(input){' +
        'if(input.type==="checkbox"){' +
        'input.checked=!!value;input.dispatchEvent(new Event("change",{bubbles:true}));' +
        'var ok=input.checked===!!value;filled.push(label+(ok?"":"⚠"));if(!ok)mismatched.push(label);}' +
        'else if(input.tagName==="SELECT"){' +
        'input.value=String(value);input.dispatchEvent(new Event("change",{bubbles:true}));' +
        'var ok2=input.value===String(value);filled.push(label+(ok2?"":"⚠"));if(!ok2)mismatched.push(label);}' +
        'else if(input.contentEditable==="true"||input.getAttribute("role")==="textbox"){' +
        'input.focus();document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);document.execCommand("insertText",false,String(value));' +
        'filled.push(label);}' +
        'else{' +
        'var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");' +
        'if(!nativeSetter)nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");' +
        'if(nativeSetter&&nativeSetter.set){nativeSetter.set.call(input,String(value));}else{input.value=String(value);}' +
        'input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));' +
        // Verify: read back the value after a microtask (React setState is async)
        'var expected=String(value).substring(0,30);var actual=(input.value||"").substring(0,30);' +
        'if(actual===expected||actual.length>0){filled.push(label);}' +
        'else{filled.push(label+"⚠");mismatched.push(label);}}' +
        '}}'
      if (submit) {
        code += 'var btns=null;' +
          'for(var di=0;di<docs.length&&!btns;di++){' +
          'var b=Array.from(docs[di].querySelectorAll("button[type=submit],input[type=submit],button"));' +
          'if(b.length)btns=b;}' +
          'if(btns&&btns[0]){btns[0].click();filled.push("[submitted]");}'
      }
      // Build result message
      code += 'var notFound=entries.filter(function(e){return filled.indexOf(e[0])===-1&&filled.indexOf(e[0]+"⚠")===-1;}).map(function(e){return e[0];});' +
        'var msg=filled.length?"Filled: "+filled.join(", "):"No fields matched";' +
        'if(mismatched.length)msg+="\\n⚠ Value mismatch (React may have overridden): "+mismatched.join(", ")+"\\nTip: use act type with CSS selector for these fields";' +
        'if(notFound.length)msg+="\\nNot found: "+notFound.join(", ")+"\\nTip: use page({detail:\\"a11y\\"}) to see field names, or act type with CSS selector";' +
        // Dynamic form re-scan: check if new fields appeared after filling
        'var fieldsAfter=document.querySelectorAll("input:not([type=hidden]),textarea,select").length;' +
        'if(fieldsAfter>fieldsBefore)msg+="\\n🔄 "+String(fieldsAfter-fieldsBefore)+" new field(s) appeared after filling (conditional form). Call page to see them.";' +
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

    // Helper: wait for DOM to stabilize (MutationObserver-based)
    // Returns when no DOM changes for debounceMs, or after timeoutMs
    function buildWaitForStableCode(debounceMs = 150, timeoutMs = 5000): string {
      return '(function(){return new Promise(function(resolve){' +
        'var timer=null;var done=false;' +
        'var obs=new MutationObserver(function(){' +
        'if(done)return;if(timer)clearTimeout(timer);' +
        'timer=setTimeout(function(){done=true;obs.disconnect();resolve("stable");},'+debounceMs+');});' +
        'obs.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});' +
        // Start the initial timer (in case no mutations happen at all)
        'timer=setTimeout(function(){done=true;obs.disconnect();resolve("stable (no changes)");},'+debounceMs+');' +
        // Hard timeout
        'setTimeout(function(){if(!done){done=true;obs.disconnect();resolve("timeout");}},'+timeoutMs+');' +
        '});})()'
    }

    // Helper: inject console capture into webview (called once per page load)
    function buildConsoleCapture(): string {
      return '(function(){if(window.__oculo_logs)return "already";window.__oculo_logs=[];' +
        'var orig={log:console.log,warn:console.warn,error:console.error,info:console.info};' +
        '["log","warn","error","info"].forEach(function(t){' +
        'console[t]=function(){' +
        'window.__oculo_logs.push({type:t,msg:Array.from(arguments).map(function(a){try{return typeof a==="object"?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(" "),ts:Date.now()});' +
        'if(window.__oculo_logs.length>200)window.__oculo_logs.shift();' +
        'orig[t].apply(console,arguments);};});' +
        'window.addEventListener("error",function(e){' +
        'window.__oculo_logs.push({type:"error",msg:"Uncaught: "+(e.message||"")+" at "+(e.filename||"")+":"+(e.lineno||""),ts:Date.now()});});' +
        'window.addEventListener("unhandledrejection",function(e){' +
        'window.__oculo_logs.push({type:"error",msg:"Unhandled promise rejection: "+String(e.reason),ts:Date.now()});});' +
        'return "injected";})()'
    }

    // Helper: gaussian-distributed delay for human-like timing
    async function gaussianDelay(minMs = 200, maxMs = 800): Promise<void> {
      // Box-Muller transform for gaussian distribution
      const u1 = Math.random()
      const u2 = Math.random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      const mean = (minMs + maxMs) / 2
      const stddev = (maxMs - minMs) / 6
      const delay = Math.max(minMs, Math.min(maxMs, mean + z * stddev))
      await new Promise(r => setTimeout(r, delay))
    }

    // Helper: build slim page state (appended after every action, ~50-80 tokens)
    function buildSlimStateCode(): string {
      return '(function(){' +
        'function vis(el){if(!el)return false;var r=el.getBoundingClientRect();return r.width>2&&r.height>2&&getComputedStyle(el).display!=="none";}' +
        'var f=Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis).slice(0,8).map(function(el){' +
        'var n=(el.labels&&el.labels[0]?el.labels[0].textContent.trim():"")||el.placeholder||el.name||el.type;' +
        'var v=el.value?el.value.substring(0,15):"";return n.substring(0,15)+(v?"=\\""+v+"\\"":"");}).join(", ");' +
        'var b=Array.from(document.querySelectorAll("button,[role=button]")).filter(vis).slice(0,6).map(function(el){' +
        'return ((el.textContent||"").trim()||el.getAttribute("aria-label")||"").substring(0,20);}).filter(Boolean).join(", ");' +
        'return "State: "+location.href.substring(0,60)+(f?" | Fields: "+f:"")+(b?" | Buttons: "+b:"");' +
        '})()'
    }

    // Helper: build page description JS code (with numbered element refs)
    function buildPageCode(): string {
      return '(function(){' +
        'var p=[];window.__oculoRefs=[];var refN=0;' +
        // Visibility helper
        'function vis(el){if(!el)return false;var r=el.getBoundingClientRect();' +
        'if(r.width<2||r.height<2)return false;var s=getComputedStyle(el);' +
        'if(s.display==="none"||s.visibility==="hidden"||s.opacity==="0")return false;' +
        'if(r.bottom<0||r.top>window.innerHeight+100)return false;return true;}' +
        // URL and title
        'p.push("URL: "+location.href);' +
        'p.push("Title: "+document.title);' +
        // Headings
        'var h=Array.from(document.querySelectorAll("h1,h2,h3")).filter(vis);' +
        'if(h.length){p.push("\\nHeadings:");h.slice(0,5).forEach(function(x){' +
        'var t=x.textContent.trim().substring(0,50);if(t)p.push("  "+x.tagName+": "+t);});}' +
        // Form fields — find human-readable label for each field
        'var allInp=Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis);' +
        'var iframes=document.querySelectorAll("iframe");' +
        'for(var fi=0;fi<iframes.length;fi++){try{var idoc=iframes[fi].contentDocument;if(idoc){var iinp=Array.from(idoc.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis);allInp=allInp.concat(iinp);};}catch(e){}}' +
        // Collect from shadow DOMs
        'function shadowInputs(root){' +
        'var all=root.querySelectorAll("*");' +
        'for(var si=0;si<all.length;si++){' +
        'if(!all[si].shadowRoot)continue;' +
        'var sr=all[si].shadowRoot;' +
        'var si2=Array.from(sr.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis);' +
        'allInp=allInp.concat(si2);shadowInputs(sr);}}' +
        'try{shadowInputs(document);}catch(e){}' +
        'if(allInp.length){p.push("\\nForm fields:");' +
        'allInp.slice(0,15).forEach(function(el){' +
          // Get human-readable label: associated <label>, aria-label, placeholder, then nearby text
          'var label="";' +
          'if(el.labels&&el.labels[0])label=el.labels[0].textContent.trim();' +
          'if(!label&&el.id){var lb=document.querySelector("label[for=\\""+el.id+"\\"]");if(lb)label=lb.textContent.trim();}' +
          'if(!label)label=el.getAttribute("aria-label")||"";' +
          'if(!label)label=el.placeholder||"";' +
          // If still no label, check preceding sibling or parent text (common in React forms)
          'if(!label){' +
          'var prev=el.previousElementSibling;' +
          'if(prev){var pt=prev.textContent.trim();if(pt.length>1&&pt.length<100)label=pt;}' +
          '}' +
          'if(!label){' +
          'var par=el.parentElement;' +
          'if(par){var kids=Array.from(par.children);var idx=kids.indexOf(el);' +
          'for(var k=Math.max(0,idx-2);k<idx;k++){var kt=kids[k].textContent.trim();if(kt.length>1&&kt.length<100){label=kt;break;}}}}' +
          // Last resort: name (skip hex/generated IDs), then type
          'if(!label){var nm=el.name||"";if(nm&&nm.length<30&&!/^[0-9a-f]{10,}$/i.test(nm))label=nm;}' +
          'if(!label)label=el.type||"input";' +
          // Truncate long labels
          'label=label.substring(0,80);' +
          // Show selector for CSS targeting
          'var sel=el.id&&el.id.length<30?"#"+el.id:(el.name&&el.name.length<30?"[name=\\""+el.name+"\\"]":"");' +
          'var val=el.value?el.value.substring(0,30):"";' +
          'p.push("  "+label+(sel?" ("+sel+")":"")+(val?" = \\""+val+"\\"":""));' +
        '});}' +
        // Editable areas
        'var ce=Array.from(document.querySelectorAll("[contenteditable=true],div[role=textbox]")).filter(vis);' +
        'if(ce.length){p.push("\\nEditable areas:");ce.slice(0,3).forEach(function(el){' +
        'p.push("  "+(el.getAttribute("aria-label")||"textbox"));});}' +
        // Numbered interactive elements — buttons and links combined
        'var actions=[];' +
        'Array.from(document.querySelectorAll("button,[role=button],input[type=submit]")).filter(vis).forEach(function(b){' +
        'var t=((b.textContent||"").trim()||b.value||b.getAttribute("aria-label")||"").substring(0,30);' +
        'if(!t)return;' +
        'var ctx="";if(t.length<10){var par=b.parentElement;' +
        'while(par&&par!==document.body){var pt=(par.textContent||"").trim().replace(/\\s+/g," ").substring(0,80);' +
        'if(pt.length>t.length+5&&pt!==t){ctx=" — \\""+pt.substring(0,50)+"\\"";break;}par=par.parentElement;}}' +
        'actions.push({el:b,text:"button: "+t+ctx});});' +
        'Array.from(document.querySelectorAll("a[href]")).filter(vis).slice(0,10).forEach(function(a){' +
        'var t=(a.textContent||"").trim().substring(0,30);' +
        'if(t)actions.push({el:a,text:"link: "+t});});' +
        'if(actions.length){p.push("\\nClickable (#N to click):");actions.forEach(function(a){' +
        'refN++;window.__oculoRefs.push(a.el);p.push("  #"+refN+" "+a.text);});}' +
        // Cross-origin iframes
        'var iframes2=document.querySelectorAll("iframe");' +
        'for(var fi=0;fi<iframes2.length;fi++){' +
        'var iframe=iframes2[fi];var src=iframe.src||"";' +
        'var rect=iframe.getBoundingClientRect();' +
        'if(rect.width<10||rect.height<10||rect.top>window.innerHeight||rect.bottom<0)continue;' +
        'try{iframe.contentDocument;continue;}catch(e){}' +
        'if(src.includes("accounts.google.com")||src.includes("gsi/button"))p.push("\\nGoogle Sign-In at x="+Math.round(rect.left+rect.width/2)+",y="+Math.round(rect.top+rect.height/2)+" — use clickAtPoint");' +
        'else if(src.includes("recaptcha")||src.includes("hcaptcha"))p.push("\\nCAPTCHA detected");' +
        'else p.push("\\nIframe: "+src.substring(0,60));' +
        '}' +
        // VOIX tag detection — emerging standard for agent-readable web
        'var voixTools=document.querySelectorAll("tool");' +
        'var voixCtx=document.querySelectorAll("context");' +
        'if(voixTools.length||voixCtx.length){' +
        'p.push("\\nVOIX Agent Interface:");' +
        'Array.from(voixTools).slice(0,10).forEach(function(t){' +
        'var name=t.getAttribute("name")||"";var desc=t.getAttribute("description")||t.textContent.trim().substring(0,60);' +
        'if(name)p.push("  tool: "+name+(desc?" — "+desc:""));});' +
        'Array.from(voixCtx).slice(0,5).forEach(function(c){' +
        'var key=c.getAttribute("key")||"";var val=c.textContent.trim().substring(0,80);' +
        'if(key||val)p.push("  context: "+(key?key+": ":"")+val);});}' +
        // High-level page pattern detection
        'var patterns=[];' +
        // Search form: input[type=search] or input near a search button
        'var searchInput=document.querySelector("input[type=search],input[name*=search i],input[placeholder*=search i],input[aria-label*=search i]");' +
        'if(searchInput&&vis(searchInput))patterns.push("search(query) — type in search box and submit");' +
        // Login form: username + password fields
        'var passField=document.querySelector("input[type=password]");' +
        'if(passField&&vis(passField)){' +
        'var userField=document.querySelector("input[type=email],input[type=text][name*=user i],input[name*=email i],input[autocomplete=username]");' +
        'if(userField&&vis(userField))patterns.push("login(user, pass) — fill credentials and submit");}' +
        // Pagination
        'var nextBtn=document.querySelector("[aria-label*=next i],a:has(> [class*=next]),button:has(> [class*=next]),.pagination a:last-child,.next");' +
        'if(!nextBtn){var btns=Array.from(document.querySelectorAll("a,button")).filter(vis);' +
        'nextBtn=btns.find(function(b){var t=(b.textContent||"").trim().toLowerCase();return t==="next"||t==="next page"||t==="›"||t==="»";});}' +
        'if(nextBtn&&vis(nextBtn))patterns.push("nextPage() — click next/pagination button");' +
        // Filter/sort controls
        'var sortSelect=document.querySelector("select[name*=sort i],select[aria-label*=sort i]");' +
        'if(sortSelect&&vis(sortSelect))patterns.push("sort(option) — use sort dropdown");' +
        'var filterInputs=document.querySelectorAll("input[name*=filter i],select[name*=filter i],[role=listbox][aria-label*=filter i]");' +
        'if(filterInputs.length)patterns.push("filter(field, value) — use filter controls");' +
        'if(patterns.length){p.push("\\nPage actions (use run for efficiency):");' +
        'patterns.forEach(function(pa){p.push("  "+pa);});}' +
        'return p.join("\\n");' +
        '})()'
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
      try {
        let wv = findActiveWebview()

        // No webview exists (newtab) — for navigate, update state and return immediately.
        // React will render a WebViewContainer, the user will see the page load.
        if (!wv && toolName === 'act' && args?.action === 'navigate' && args?.url) {
          setTabs(prev => prev.map(t => t.id === activeTabIdRef.current ? { ...t, url: args.url, isLoading: true } : t))
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
            const detail = args.detail || args.mode || ''
            if (detail === 'a11y' || detail === 'full' || detail === 'interactive') {
              // Use CDP accessibility tree for detailed view
              try {
                const wcId = (wv as any).getWebContentsId?.()
                if (wcId) {
                  result = await api.a11ySnapshot(wcId)
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
                const pngBuffer = nativeImage.toPNG()
                const bytes = new Uint8Array(pngBuffer)
                let binary = ''
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                const base64 = btoa(binary)
                const filePath = await api.screenshotSave(base64)
                result += '\n[Screenshot: ' + filePath + ']'
              } catch { /* screenshot failed, non-critical */ }
            }
            break
          }

          case 'act': {
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
              result = await (wv as any).executeJavaScript(buildClickCode(args.text || '', args.selector || '', args.nth || 0))
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
              const textToType = args.text || ''
              const shouldClear = !!args.clear
              if (!textToType) {
                result = 'Error: text parameter required for type action'
              } else {
                try {
                  // Resolve element: selector → label → placeholder/data-placeholder → first visible editable
                  const resolveCode = '(function(){' +
                    'function isVisible(el){if(!el)return false;var s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&parseFloat(s.opacity)>0;}' +
                    'var sel=' + JSON.stringify(args.selector || '') + ';' +
                    'var label=' + JSON.stringify(args.label || '') + ';' +
                    'var ph=' + JSON.stringify(args.placeholder || '') + ';' +
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
                    // 3. Placeholder / data-placeholder
                    'if(!el&&ph){' +
                    'var lower=ph.toLowerCase();' +
                    'var inputs=document.querySelectorAll("input[placeholder],textarea[placeholder]");' +
                    'for(var i=0;i<inputs.length;i++){if(inputs[i].getAttribute("placeholder").toLowerCase().includes(lower)&&isVisible(inputs[i])){el=inputs[i];break;}}' +
                    'if(!el){var ceEls=document.querySelectorAll("[data-placeholder],[aria-placeholder]");' +
                    'for(var i=0;i<ceEls.length;i++){var p=(ceEls[i].getAttribute("data-placeholder")||ceEls[i].getAttribute("aria-placeholder")||"").toLowerCase();' +
                    'if(p.includes(lower)&&isVisible(ceEls[i])){el=ceEls[i];break;}}}}' +
                    // 4. First visible editable (fallback)
                    'if(!el&&!sel&&!label&&!ph){' +
                    'el=document.querySelector("[contenteditable=true]:not([aria-hidden=true]),[role=textbox]:not([aria-hidden=true])");' +
                    'if(!el)el=document.querySelector("textarea,input[type=text],input:not([type])");' +
                    '}' +
                    'if(!el)return "not_found";' +
                    'el.scrollIntoView({behavior:"smooth",block:"center"});' +
                    'el.focus();el.click();' +
                    // For regular inputs/textareas — use native setter (React compatible)
                    'if(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT"){' +
                    'var proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;' +
                    'var setter=Object.getOwnPropertyDescriptor(proto,"value");' +
                    (shouldClear ?
                      'if(setter&&setter.set){setter.set.call(el,"");}else{el.value="";}' +
                      'el.dispatchEvent(new Event("input",{bubbles:true}));' : '') +
                    'var newVal=' + (shouldClear ? '' : '(el.value||"")+') + JSON.stringify(textToType) + ';' +
                    'if(setter&&setter.set){setter.set.call(el,newVal);}' +
                    'else{el.value=newVal;}' +
                    'el.dispatchEvent(new Event("input",{bubbles:true}));' +
                    'el.dispatchEvent(new Event("change",{bubbles:true}));' +
                    'return "set:"+el.value.length;}' +
                    // For contenteditable/rich text — use execCommand
                    'if(el.contentEditable==="true"||el.getAttribute("role")==="textbox"){' +
                    'return "editable";}' +
                    'return "unknown";})()'
                  const typeResult = await (wv as any).executeJavaScript(resolveCode)
                  if (typeResult === 'not_found') {
                    result = 'Error: element not found' + (args.selector ? ': ' + args.selector : args.label ? ' by label: ' + args.label : args.placeholder ? ' by placeholder: ' + args.placeholder : '')
                  } else if (typeResult === 'editable') {
                    // For contenteditable, use Selection API + execCommand (DraftJS/ProseMirror compatible)
                    if (shouldClear) {
                      await (wv as any).executeJavaScript('document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);')
                      await new Promise(r => setTimeout(r, 100))
                    }
                    await (wv as any).executeJavaScript('document.execCommand("insertText",false,' + JSON.stringify(textToType) + ')')
                    await new Promise(r => setTimeout(r, 200))
                    result = 'Typed ' + textToType.length + ' chars into editable area'
                  } else if (typeResult.startsWith('set:')) {
                    const len = typeResult.split(':')[1]
                    result = 'Typed ' + textToType.length + ' chars (field has ' + len + ' chars)'
                  } else {
                    // Unknown element — try execCommand as fallback
                    if (shouldClear) {
                      await (wv as any).executeJavaScript('document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);')
                      await new Promise(r => setTimeout(r, 100))
                    }
                    await (wv as any).executeJavaScript('document.execCommand("insertText",false,' + JSON.stringify(textToType) + ')')
                    await new Promise(r => setTimeout(r, 200))
                    result = 'Typed ' + textToType.length + ' chars'
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
              // Try to find and switch to the tab
              const allWvs = document.querySelectorAll('webview')
              let found = false
              allWvs.forEach((wvEl: any, i: number) => {
                try {
                  const wvTitle = wvEl.getTitle?.() || ''
                  const wvUrl = wvEl.getURL?.() || ''
                  if ((!isNaN(idx) && i === idx) ||
                      (target && (wvTitle.toLowerCase().includes(target.toLowerCase()) ||
                                   wvUrl.toLowerCase().includes(target.toLowerCase())))) {
                    // Get the tab container's tab-id
                    const container = wvEl.closest('[data-tab-id]')
                    if (container) {
                      const tabId = container.getAttribute('data-tab-id')
                      if (tabId) {
                        // Dispatch a custom event or directly update
                        found = true
                        result = 'Switched to tab [' + i + ']: ' + wvTitle + ' — ' + wvUrl.substring(0, 60)
                      }
                    }
                  }
                } catch { /* skip */ }
              })
              if (!found) result = 'Tab not found: ' + target + '. Use listTabs to see available tabs.'
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
                    const pngBuffer = cropped.toPNG()
                    const bytes = new Uint8Array(pngBuffer)
                    let binary = ''
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                    const base64 = btoa(binary)
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
                const pngBuffer = nativeImage.toPNG()
                const bytes = new Uint8Array(pngBuffer)
                let binary = ''
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                const base64 = btoa(binary)
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
            } else if (action === 'listTabs') {
              // List all open tabs with their URLs and titles
              try {
                const allWebviews = document.querySelectorAll('webview')
                const tabInfo: string[] = []
                let activeIndex = -1
                allWebviews.forEach((wvEl: any, i: number) => {
                  try {
                    const url = wvEl.getURL?.() || 'about:blank'
                    const title = wvEl.getTitle?.() || 'Untitled'
                    const parent = wvEl.closest('div')
                    const isActive = parent && !parent.classList.contains('hidden')
                    if (isActive) activeIndex = i
                    tabInfo.push(`${isActive ? '→ ' : '  '}[${i}] ${title} — ${url.substring(0, 80)}`)
                  } catch { tabInfo.push(`  [${i}] (not ready)`) }
                })
                result = tabInfo.length ? `Tabs (${tabInfo.length}):\n` + tabInfo.join('\n') : 'No tabs found'
                if (tabInfo.length > 1) result += '\n\nTip: Switch between tabs with act({action:"switchTab", text:"tab title or index"})'
              } catch (e: any) {
                result = 'Error listing tabs: ' + e.message
              }
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
              // Wait for potential 2FA prompt after login form submit
              if (result && result.includes('Filled credentials')) {
                await new Promise(r => setTimeout(r, 2000))
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
                const pngBuffer = nativeImage.toPNG()
                const bytes = new Uint8Array(pngBuffer)
                let binary = ''
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                const base64After = btoa(binary)
                const afterPath = await api.screenshotSave(base64After)
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
                'if(!window.__oculo_dialogs||!window.__oculo_dialogs.length)return "No dialogs intercepted";' +
                'var recent=window.__oculo_dialogs.slice(-10);' +
                'window.__oculo_dialogs=[];' +
                'return "Intercepted dialogs:\\n"+recent.map(function(d){' +
                'return d.type+" | "+d.message.substring(0,100)+" | response: "+d.response;' +
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
            } else { result = 'Unknown action: ' + action }
            // Auto-append page state after actions that change the page
            const noSnapshotActions = ['wait', 'hover', 'getAttribute', 'evaluate', 'copy', 'screenshot', 'screenshotSoM', 'screenshotElement', 'clipboardImage', 'download', 'listDownloads', 'readFile', 'listTabs', 'monitorNetwork', 'visualDiff', 'detectAPIs', 'recordStart', 'recordStop', 'extractPDF', 'monitorWebSocket', 'checkDialogs', 'printToPDF', 'getCookies', 'setCookie', 'deleteCookie', 'getStorage', 'setStorage', 'clearStorage', 'interceptNetwork']
            if (!noSnapshotActions.includes(action)) {
              // Wait for DOM to stabilize after page-changing actions
              if (action === 'navigate' || action === 'click' || action === 'back' || action === 'forward' || action === 'reload') {
                try { await (wv as any).executeJavaScript(buildWaitForStableCode(150, 3000)) } catch { /* page might be navigating */ }
              }
              const snapshot = await getPageSnapshot(wv)
              if (snapshot) result += '\n---\n' + snapshot
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
            const entries = Object.entries(rawFields)
            if (entries.length > 30) {
              result = 'Error: too many fields (' + entries.length + '). Pass at most 30 fields per fill call.'
              break
            }
            result = await (wv as any).executeJavaScript(buildFillCode(entries, args.submit))
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
                '(function(){if(!window.__oculo_logs)return "";' +
                'var recent=window.__oculo_logs.filter(function(l){return l.type==="error"&&Date.now()-l.ts<5000;});' +
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
            // Auto-append page state after fill
            const snapshot = await getPageSnapshot(wv)
            if (snapshot) result += '\n---\n' + snapshot
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

        // Auto-append slim page state after actions so the AI always knows current state
        if ((toolName === 'act' || toolName === 'fill') && wv && !result.startsWith('Error')) {
          try {
            const state = await (wv as any).executeJavaScript(buildSlimStateCode())
            if (state) result += '\n' + state
          } catch { /* ignore */ }
        }

        api.sendMcpToolResult(callId, result)
      } catch (err: any) {
        api.sendMcpToolResult(callId, 'Error: ' + (err.message || 'Tool execution failed'))
      }
    })

    return cleanup
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — register once, use activeTabIdRef inside

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
