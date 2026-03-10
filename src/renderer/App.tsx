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
import PipelinesPanel from './components/pipelines/PipelinesPanel'
import CommandPalette from './components/common/CommandPalette'
import ContextMenu, { ContextMenuItem, useContextMenu } from './components/common/ContextMenu'
import { ToastContainer, useToasts } from './components/common/Toast'
import ReaderMode from './components/common/ReaderMode'
import SettingsPanel from './components/SettingsPanel'
import { useSidebarState } from './hooks/useSidebarState'
import { Tab, TabGroup, TAB_GROUP_COLORS, PinnedApp, PatternSuggestion } from '../shared/types'
import { useMcpToolHandler } from './hooks/useMcpToolHandler'

let tabCounter = 0
function newId(): string {
  return `tab-${Date.now()}-${++tabCounter}`
}

function oculoApi(): any {
  return (window as any).oculo
}

const NEW_TAB_URL = 'oculo://newtab'
const ABOUT_URL = 'oculo://about'
const CONTACT_URL = 'oculo://contact'
const GUIDE_URL = 'oculo://guide'

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: newId(), url: NEW_TAB_URL, title: 'New Tab', isLoading: false, canGoBack: false, canGoForward: false }
  ])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  const [chatOpen, setChatOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [bookmarkPopoverOpen, setBookmarkPopoverOpen] = useState(false)
  const [bookmarksBarOpen, setBookmarksBarOpen] = useState(true)
  const [isCurrentBookmarked, setIsCurrentBookmarked] = useState(false)
  const [readerModeOpen, setReaderModeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tabGroups, setTabGroups] = useState<TabGroup[]>([])
  const [devToolsHeight, setDevToolsHeight] = useState(0)
  const [focusMode, setFocusMode] = useState(false)
  const [highlightPopup, setHighlightPopup] = useState<{ text: string; x: number; y: number } | null>(null)
  const [tabSuspended, setTabSuspended] = useState<Set<string>>(new Set())
  const [pinnedApps, setPinnedApps] = useState<PinnedApp[]>([])
  const [pipelineSuggestions, setPipelineSuggestions] = useState<PatternSuggestion[]>([])
  const [aiActing, setAiActing] = useState(false)  // v0.3.0: transparent action overlay
  const [linkPreview, setLinkPreview] = useState<{ x: number; y: number; url: string; summary: string } | null>(null)  // v0.3.0: hover link preview
  const linkPreviewCache = useRef<Map<string, string>>(new Map())  // v0.3.0: URL → summary cache
  const tabLastActive = useRef<Map<string, number>>(new Map())
  const closedTabs = useRef<{ url: string; title: string }[]>([])
  const lastPageSnapshot = useRef('')
  const lastA11ySnapshot = useRef('')
  const currentRefMap = useRef<Record<string, import('@shared/types').ElementFingerprint>>({})
  // Fix 10: Per-tab operation queue — serialize MCP operations within each tab
  const tabOpQueue = useRef(new Map<string, Promise<unknown>>())

  const sidebar = useSidebarState()
  const contextMenu = useContextMenu()
  const { toasts, addToast, dismissToast } = useToasts()

  // Dark mode — always on (light mode not yet implemented)
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // Load pinned sidebar apps on mount
  useEffect(() => {
    const api = oculoApi()
    if (!api?.pinnedAppList) return
    api.pinnedAppList().then((apps: PinnedApp[]) => {
      if (apps && apps.length > 0) setPinnedApps(apps)
    }).catch(() => {})
  }, [])

  // Pipeline suggestion listener
  useEffect(() => {
    const api = oculoApi()
    if (!api?.onPipelineSuggest) return
    return api.onPipelineSuggest((suggestion: PatternSuggestion) => {
      setPipelineSuggestions(prev => {
        if (prev.some(s => s.id === suggestion.id)) return prev
        return [...prev, suggestion]
      })
      addToast(`Pattern detected on ${suggestion.domain}. Open Pipelines to save.`, 'info')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // IPC event listeners
  useEffect(() => {
    const api = oculoApi()
    if (!api) return
    const cleanups = [
      api.onNewTab((url?: string, openerId?: number) => handleNewTab(url, openerId)),
      api.onCloseActiveTab(() => handleCloseTab(activeTabIdRef.current)),
      api.onToggleChat?.(() => setChatOpen(prev => !prev)),
      api.onFindInPage?.(() => setFindOpen(true)),
      api.onToggleDevTools?.(() => api.openWebviewDevTools(activeTabIdRef.current)),
      api.onInspectElement?.(() => api.inspectElement?.(activeTabIdRef.current)),
      api.onViewPageSource?.(() => handleViewSource()),
      api.onToggleDevToolsMode?.((mode: string) => api.toggleDevToolsWithMode?.(mode)),
      api.onCommandPalette?.(() => setCommandPaletteOpen(prev => !prev)),
      api.onAddBookmark?.(() => handleToggleBookmark()),
      api.onReopenClosedTab?.(() => handleReopenClosedTab()),
      api.onNavBack?.(() => api.goBack(activeTabIdRef.current)),
      api.onNavForward?.(() => api.goForward(activeTabIdRef.current)),
      api.onReaderMode?.(() => setReaderModeOpen(prev => !prev)),
      api.onSplitView?.(() => {}),
      api.onToggleBookmarksBar?.(() => setBookmarksBarOpen(prev => !prev)),
      api.onOpenSettings?.(() => setSettingsOpen(true)),
      api.onNavigateTo?.((url: string) => handleNavigate(url)),
      api.onZoomIn?.(() => handleZoom(0.1)),
      api.onZoomOut?.(() => handleZoom(-0.1)),
      api.onZoomReset?.(() => handleZoomReset()),
      api.onDevToolsResized?.((height: number) => setDevToolsHeight(height)),
      api.onFocusMode?.(() => setFocusMode(prev => !prev)),
      // v0.4.3: WebContentsView state updates from TabManager in main process
      api.onViewStateUpdate?.((tabId: string, state: any) => {
        setTabs(prev => {
          const next = prev.map(t => {
            if (t.id !== tabId) return t
            return {
              ...t,
              ...(state.url !== undefined && { url: state.url }),
              ...(state.title !== undefined && { title: state.title }),
              ...(state.originalTitle !== undefined && { originalTitle: state.originalTitle }),
              ...(state.isLoading !== undefined && { isLoading: state.isLoading }),
              ...(state.canGoBack !== undefined && { canGoBack: state.canGoBack }),
              ...(state.canGoForward !== undefined && { canGoForward: state.canGoForward }),
            }
          })
          // Record history when title arrives (matches handleWebViewUpdate behavior)
          if (state.title && state.title !== '[OAuth Complete]') {
            const tab = next.find(t => t.id === tabId)
            if (tab && tab.url && !tab.url.startsWith('oculo://')) {
              recordHistory(tab.url, state.title)
            }
          }
          return next
        })
        // Auto-close OAuth popup tabs when flow completes
        if (state.title === '[OAuth Complete]') {
          setTimeout(() => handleCloseTab(tabId), 500)
        }
      }),
      // v0.4.3: Handle tab creation from main process (window.open → new tab in TabManager)
      api.onViewTabCreate?.((url: string, openerId: number, tabId: string) => {
        const newTab: Tab = {
          id: tabId, url, title: 'New Tab', isLoading: true,
          canGoBack: false, canGoForward: false, openerId,
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(tabId)
      }),
      api.onCloseTabByUrl?.((urlPrefix: string) => {
        setTabs(prev => {
          const match = prev.find(t => t.url.startsWith(urlPrefix))
          if (!match || prev.length <= 1) return prev
          const newTabs = prev.filter(t => t.id !== match.id)
          setActiveTabId(cur => {
            if (cur !== match.id) return cur
            const idx = prev.findIndex(t => t.id === match.id)
            return newTabs[Math.min(idx, newTabs.length - 1)].id
          })
          return newTabs
        })
      }),
    ]
    return () => cleanups.forEach(c => c?.())
  }, [activeTabId])

  // MCP tool execution (extracted to hook)
  useMcpToolHandler({
    activeTabIdRef, tabsRef, lastPageSnapshot, lastA11ySnapshot,
    currentRefMap, tabOpQueue, setTabs, setActiveTabId, setAiActing, setChatOpen
  })


  // === Hover Link Preview (v0.3.0) ===
  useEffect(() => {
    const api = oculoApi()
    if (!api) return

    const injectLinkPreviewListener = () => {
      setTimeout(() => {
        const wv = document.querySelector('webview:not([style*="display: none"])')
        if (!wv) return
        ;(wv as any).executeJavaScript?.(`
          if (!window.__oculoLinkPreview) {
            window.__oculoLinkPreview = true;
            document.addEventListener('mouseover', function(e) {
              if (!e.shiftKey) return;
              var a = e.target.closest('a[href]');
              if (!a) return;
              var rect = a.getBoundingClientRect();
              window.__oculoLinkHover = { url: a.href, x: rect.left + rect.width/2, y: rect.top };
            });
            document.addEventListener('mouseout', function(e) {
              if (e.target.closest('a[href]')) window.__oculoLinkHover = null;
            });
          }
        `).catch(() => {})
      }, 1000)
    }

    // Re-inject on every page load (dom-ready fires on navigation)
    const wv = document.querySelector('webview:not([style*="display: none"])')
    const domReadyHandler = () => injectLinkPreviewListener()
    if (wv) {
      wv.addEventListener('dom-ready', domReadyHandler)
      injectLinkPreviewListener() // inject for current page too
    }

    // Set up polling for link hover events from webview
    const pollInterval = setInterval(async () => {
      const currentWv = document.querySelector('webview:not([style*="display: none"])') as any
      if (!currentWv) { setLinkPreview(null); return }
      try {
        const hover = await currentWv.executeJavaScript('window.__oculoLinkHover || null')
        if (!hover) { setLinkPreview(null); return }
        // Translate webview-relative coords to window-relative by adding webview offset
        const wvRect = currentWv.getBoundingClientRect()
        const windowX = hover.x + wvRect.left
        const windowY = hover.y + wvRect.top
        const cached = linkPreviewCache.current.get(hover.url)
        if (cached) {
          setLinkPreview({ x: windowX, y: windowY, url: hover.url, summary: cached })
        } else {
          setLinkPreview({ x: windowX, y: windowY, url: hover.url, summary: 'Loading...' })
          const summary = await api.aiQuickComplete(`Summarize this URL in 10 words: ${hover.url}`, 30)
          if (summary) {
            linkPreviewCache.current.set(hover.url, summary)
            setLinkPreview(prev => prev && prev.url === hover.url ? { x: prev.x, y: prev.y, url: prev.url, summary } : prev)
          }
        }
      } catch { /* webview not ready */ }
    }, 800)

    return () => {
      clearInterval(pollInterval)
      if (wv) wv.removeEventListener('dom-ready', domReadyHandler)
    }
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

  const checkBookmarkStatus = useCallback(async () => {
    const api = oculoApi()
    if (!api?.bookmarksFindUrl || !activeTab?.url) return
    const bm = await api.bookmarksFindUrl(activeTab.url)
    setIsCurrentBookmarked(!!bm)
  }, [activeTab?.url])

  // Check bookmark status
  useEffect(() => { checkBookmarkStatus() }, [checkBookmarkStatus])

  // Record history
  const recordHistory = useCallback((url: string, title: string) => {
    if (url.startsWith('oculo://')) return
    const api = oculoApi()
    api?.historyAdd?.(url, title)
  }, [])

  // Zoom per site
  const handleZoom = useCallback(async (delta: number) => {
    const api = oculoApi()
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
    const api = oculoApi()
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
    const api = oculoApi()
    if (!api?.zoomGet) return
    try {
      const domain = new URL(activeTab.url).hostname
      api.zoomGet(domain).then((level: number) => {
        applyZoom(level)
      })
    } catch { /* ignore */ }
  }, [activeTab?.url])

  // Tab management
  const handleNewTab = useCallback((url?: string, openerId?: number) => {
    const api = oculoApi()
    const tabId = newId()
    const tabUrl = url || NEW_TAB_URL
    const newTab: Tab = {
      id: tabId, url: tabUrl, title: 'New Tab',
      isLoading: !!url && !tabUrl.startsWith('oculo://'), canGoBack: false, canGoForward: false,
      ...(openerId ? { openerId } : {})
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(tabId)
    setReaderModeOpen(false)
    // v0.4.3: Create WebContentsView in main process for non-internal URLs
    if (tabUrl && !tabUrl.startsWith('oculo://') && api?.viewCreate) {
      api.viewCreate(tabId, tabUrl).then((wcId: number) => {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, webContentsId: wcId } : t))
      }).catch(() => { /* view creation failed */ })
    }
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    const api = oculoApi()
    setTabs(prev => {
      if (prev.length <= 1) return prev
      const closedTab = prev.find(t => t.id === tabId)
      if (closedTab) closedTabs.current.push({ url: closedTab.url, title: closedTab.title })
      const newTabs = prev.filter(t => t.id !== tabId)
      setActiveTabId(currentActiveId => {
        if (currentActiveId === tabId) {
          const idx = prev.findIndex(t => t.id === tabId)
          return newTabs[Math.min(idx, newTabs.length - 1)].id
        }
        return currentActiveId
      })
      // Remove from groups
      setTabGroups(groups => groups.map(g => ({
        ...g, tabIds: g.tabIds.filter(id => id !== tabId)
      })).filter(g => g.tabIds.length > 0))
      return newTabs
    })
    // v0.4.3: Close WebContentsView in main process
    api?.viewClose?.(tabId)?.catch?.(() => {})
  }, [])

  const handleReopenClosedTab = useCallback(() => {
    const last = closedTabs.current.pop()
    if (last) handleNewTab(last.url)
  }, [handleNewTab])

  const handleTabSwitch = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    setReaderModeOpen(false)
    // v0.4.3: Activate WebContentsView in main process
    oculoApi()?.viewActivate?.(tabId)
    // Clear stale snapshots so the next page/a11y call gets fresh data for the new tab
    lastPageSnapshot.current = ''
    lastA11ySnapshot.current = ''
  }, [])

  const handleNavigate = useCallback((url: string) => {
    const api = oculoApi()
    const isInternal = url.startsWith('oculo://')
    const currentTabId = activeTabIdRef.current
    setTabs(prev => prev.map(t => t.id === currentTabId ? { ...t, url, isLoading: !isInternal } : t))
    setReaderModeOpen(false)
    // v0.4.3: Navigate the WebContentsView, or create one if tab doesn't have a view yet
    if (!isInternal) {
      const tab = tabsRef.current.find(t => t.id === currentTabId)
      if (tab?.webContentsId) {
        api?.viewNavigate?.(currentTabId, url)
      } else if (api?.viewCreate) {
        api.viewCreate(currentTabId, url).then((wcId: number) => {
          setTabs(prev => prev.map(t => t.id === currentTabId ? { ...t, webContentsId: wcId } : t))
        }).catch(() => {})
      }
    }
  }, [])

  const handleWebViewUpdate = useCallback((tabId: string, updates: Partial<Tab>): void => {
    setTabs(prev => {
      const next = prev.map(t => t.id === tabId ? { ...t, ...updates } : t)
      // Record history when title arrives (not on navigation, where title is still empty)
      if (updates.title && updates.title !== '[OAuth Complete]') {
        const tab = next.find(t => t.id === tabId)
        if (tab && tab.url && !tab.url.startsWith('oculo://')) {
          recordHistory(tab.url, updates.title)
        }
      }
      return next
    })
    // Auto-close OAuth popup tabs when flow completes
    if (updates.title === '[OAuth Complete]') {
      setTimeout(() => handleCloseTab(tabId), 500)
    }
  }, [recordHistory, handleCloseTab])

  const handleGoBack = useCallback(() => { oculoApi()?.goBack(activeTabId) }, [activeTabId])
  const handleGoForward = useCallback(() => { oculoApi()?.goForward(activeTabId) }, [activeTabId])
  const handleReload = useCallback(() => { oculoApi()?.reload(activeTabId) }, [activeTabId])

  // View page source — opens in a new tab with view-source: prefix
  const handleViewSource = useCallback(async () => {
    if (!activeTab || activeTab.url.startsWith('oculo://')) return
    const api = oculoApi()
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
    const api = oculoApi()
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
    const api = oculoApi()
    if (!api || !activeTab) return
    const existing = await api.bookmarksFindUrl(activeTab.url)
    if (existing) await api.bookmarksUpdate(existing.id, { title })
    setIsCurrentBookmarked(true)
  }, [activeTab])

  const handleRemoveBookmark = useCallback(async () => {
    const api = oculoApi()
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

  // AI Auto Tab Grouping (v0.3.0)
  const handleAutoGroup = useCallback(async () => {
    if (tabs.length < 3) return
    const api = oculoApi()
    // Group by domain first
    const domainMap: Record<string, string[]> = {}
    for (const tab of tabs) {
      try {
        const domain = new URL(tab.url).hostname.replace('www.', '')
        if (!domainMap[domain]) domainMap[domain] = []
        domainMap[domain].push(tab.id)
      } catch { /* skip invalid URLs */ }
    }

    // Auto-create groups for domains with 2+ tabs
    const newGroups: TabGroup[] = []
    const grouped = new Set<string>()
    const colors = TAB_GROUP_COLORS
    let colorIdx = tabGroups.length

    for (const [domain, tabIds] of Object.entries(domainMap)) {
      if (tabIds.length >= 2) {
        newGroups.push({
          id: `group-${Date.now()}-${domain}`,
          name: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
          color: colors[colorIdx % colors.length].bg,
          collapsed: false,
          tabIds
        })
        colorIdx++
        tabIds.forEach(id => grouped.add(id))
      }
    }

    // For remaining ungrouped tabs, try AI categorization
    const ungrouped = tabs.filter(t => !grouped.has(t.id) && !t.url.startsWith('oculo://'))
    if (ungrouped.length >= 3 && api) {
      const tabInfo = ungrouped.map(t => `${t.id}|${t.title}|${t.url}`).join('\n')
      const aiResult = await api.aiQuickComplete(
        `Categorize these tabs into 2-3 groups. Reply ONLY as JSON array: [{"name":"GroupName","tabIds":["id1","id2"]}]\n${tabInfo}`,
        200
      )
      if (aiResult) {
        try {
          const parsed = JSON.parse(aiResult.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
          if (Array.isArray(parsed)) {
            for (const g of parsed) {
              if (g.name && Array.isArray(g.tabIds) && g.tabIds.length >= 2) {
                // Validate tab IDs exist
                const validIds = g.tabIds.filter((id: string) => ungrouped.some(t => t.id === id))
                if (validIds.length >= 2) {
                  newGroups.push({
                    id: `group-${Date.now()}-${g.name}`,
                    name: g.name.substring(0, 20),
                    color: colors[colorIdx % colors.length].bg,
                    collapsed: false,
                    tabIds: validIds
                  })
                  colorIdx++
                }
              }
            }
          }
        } catch { /* AI returned invalid JSON */ }
      }
    }

    if (newGroups.length > 0) {
      setTabGroups(prev => [...prev, ...newGroups])
    }
  }, [tabs, tabGroups])

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

  // === Pinned Sidebar Apps ===
  const handlePinToSidebar = useCallback(async (tab: Tab) => {
    const api = oculoApi()
    if (!api?.pinnedAppAdd) return
    // Don't pin internal pages
    if (tab.url.startsWith('oculo://')) return
    const app = await api.pinnedAppAdd(tab.url, tab.title, tab.favicon)
    if (app) {
      setPinnedApps(prev => {
        // Avoid duplicates
        if (prev.find(p => p.id === app.id)) return prev
        return [...prev, app]
      })
      addToast?.('Pinned to sidebar', 'success')
    }
  }, [addToast])

  const handleUnpinFromSidebar = useCallback(async (id: string) => {
    const api = oculoApi()
    if (!api?.pinnedAppRemove) return
    const removed = await api.pinnedAppRemove(id)
    if (removed) {
      setPinnedApps(prev => prev.filter(a => a.id !== id))
    }
  }, [])

  const handlePinnedAppWidthChange = useCallback(async (id: string, width: number) => {
    const api = oculoApi()
    if (!api?.pinnedAppUpdate) return
    await api.pinnedAppUpdate(id, { width })
    setPinnedApps(prev => prev.map(a => a.id === id ? { ...a, width } : a))
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
      ...(tabs.length >= 3 ? [{ label: 'Auto Group All Tabs', action: () => handleAutoGroup() }] : []),
      { label: '', action: () => {}, separator: true },
      ...(!tab.url.startsWith('oculo://') && !pinnedApps.find(p => p.url === tab.url)
        ? [{ label: 'Pin to Sidebar', action: () => handlePinToSidebar(tab) }]
        : []
      ),
      { label: 'Close Tab', action: () => handleCloseTab(tabId), danger: tabs.length > 1, disabled: tabs.length <= 1 },
      { label: 'Close Other Tabs', action: () => {
        tabs.filter(t => t.id !== tabId).forEach(t => handleCloseTab(t.id))
      }, disabled: tabs.length <= 1 },
    ]

    contextMenu.showContextMenu(e, items)
  }, [tabs, tabGroups, pinnedApps, handleNewTab, handleCloseTab, handleCreateGroup, handleAddToGroup, handleRemoveFromGroup, handlePinToSidebar, contextMenu])

  const isSecure = activeTab?.url.startsWith('https://') || false
  const isNewTab = activeTab?.url === NEW_TAB_URL
  const isAbout = activeTab?.url === ABOUT_URL
  const isContact = activeTab?.url === CONTACT_URL
  const isGuide = activeTab?.url === GUIDE_URL
  const isInternalPage = isNewTab || isAbout || isContact || isGuide

  // Focus Mode: Esc exits
  useEffect(() => {
    if (!focusMode) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocusMode(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusMode])


  // Tab suspension timer (Feature 11)
  useEffect(() => {
    tabLastActive.current.set(activeTabId, Date.now())
    // Un-suspend the tab when switched to
    setTabSuspended(prev => {
      if (!prev.has(activeTabId)) return prev
      const next = new Set(prev)
      next.delete(activeTabId)
      return next
    })
  }, [activeTabId])

  useEffect(() => {
    const interval = setInterval(() => {
      const api = oculoApi()
      api?.getSettings?.().then((settings: any) => {
        if (!settings?.performanceMode) return
        const suspendAfter = (settings.tabSuspendAfterMinutes || 15) * 60 * 1000
        const now = Date.now()
        const toSuspend = new Set<string>()
        for (const tab of tabs) {
          if (tab.id === activeTabId) continue
          const lastActive = tabLastActive.current.get(tab.id) || 0
          if (now - lastActive > suspendAfter) {
            toSuspend.add(tab.id)
          }
        }
        if (toSuspend.size > 0) {
          setTabSuspended(prev => new Set([...prev, ...toSuspend]))
        }
      })
    }, 60000)
    return () => clearInterval(interval)
  }, [tabs, activeTabId])

  return (
    <div className="flex h-full" style={devToolsHeight > 0 ? { height: `calc(100% - ${devToolsHeight}px)` } : undefined}>
      {/* Focus Mode: hide all chrome */}
      {focusMode ? (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          <ContentArea
            tabs={tabs}
            activeTabId={activeTabId}
            chatOpen={false}
            onWebViewUpdate={handleWebViewUpdate}
            onCloseChat={() => {}}
            isNewTab={isNewTab}
            isAbout={isAbout}
            isContact={isContact}
            isGuide={isGuide}
            onNavigate={handleNavigate}
            suspendedTabs={tabSuspended}
            onCloseTab={handleCloseTab}
            pinnedApps={pinnedApps}
            onPinnedAppRemove={handleUnpinFromSidebar}
            onPinnedAppWidthChange={handlePinnedAppWidthChange}
            aiActing={aiActing}
            onStopAi={() => { oculoApi()?.abortChat(); setAiActing(false) }}
          />
          {/* Focus mode exit button */}
          <button
            onClick={() => setFocusMode(false)}
            className="absolute top-3 right-3 z-50 bg-surface/80 hover:bg-surface text-secondary hover:text-primary text-xs px-3 py-1.5 rounded-full backdrop-blur-sm border border-border/50 transition-all opacity-30 hover:opacity-100"
            title="Exit Focus Mode (Esc)"
          >
            Exit Focus Mode
          </button>
        </div>
      ) : (
        <>
          {/* Sidebar + sub-panels share mouse region so hovering a panel cancels collapse */}
          <div className="relative flex-shrink-0 flex" onMouseEnter={sidebar.onMouseEnter} onMouseLeave={sidebar.onMouseLeave}>
          <Sidebar
            tabs={tabs}
            activeTabId={activeTabId}
            expanded={sidebar.expanded}
            activePanel={sidebar.activePanel}
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
          <PipelinesPanel
            isOpen={sidebar.activePanel === 'pipelines'}
            onClose={sidebar.closePanel}
            suggestions={pipelineSuggestions}
            onDismissSuggestion={(id) => {
              oculoApi()?.pipelineDismiss(id)
              setPipelineSuggestions(prev => prev.filter(s => s.id !== id))
            }}
            onSaveSuggestion={(suggestion) => {
              oculoApi()?.macroCreate(suggestion.suggestedName, suggestion.steps, undefined, `Auto-detected on ${suggestion.domain}`)
              setPipelineSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
              addToast(`Saved pipeline: ${suggestion.suggestedName}`, 'success')
            }}
            onExecuteMacro={(id) => {
              oculoApi()?.macroExecute(id)
            }}
          />
          </div>

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
                onTextSelected={setHighlightPopup}
                suspendedTabs={tabSuspended}
                onCloseTab={handleCloseTab}
                pinnedApps={pinnedApps}
                onPinnedAppRemove={handleUnpinFromSidebar}
                onPinnedAppWidthChange={handlePinnedAppWidthChange}
                aiActing={aiActing}
                onStopAi={() => { oculoApi()?.abortChat(); setAiActing(false) }}
              />

              {/* Highlight-to-Ask popup */}
              {highlightPopup && (
                <div
                  className="fixed z-50 flex gap-1 bg-surface rounded-lg shadow-xl border border-border/50 p-1"
                  style={{ left: highlightPopup.x - 80, top: highlightPopup.y - 45 }}
                >
                  <button
                    onClick={() => { setChatOpen(true); setHighlightPopup(null) }}
                    className="px-2.5 py-1 text-xs rounded-md hover:bg-accent/20 text-primary transition-colors"
                    title="Ask AI about this text"
                  >
                    Ask AI
                  </button>
                  <button
                    onClick={() => { setChatOpen(true); setHighlightPopup(null) }}
                    className="px-2.5 py-1 text-xs rounded-md hover:bg-accent/20 text-primary transition-colors"
                    title="Translate selected text"
                  >
                    Translate
                  </button>
                  <button
                    onClick={() => { setChatOpen(true); setHighlightPopup(null) }}
                    className="px-2.5 py-1 text-xs rounded-md hover:bg-accent/20 text-primary transition-colors"
                    title="Explain selected text"
                  >
                    Explain
                  </button>
                  <button
                    onClick={() => setHighlightPopup(null)}
                    className="px-1.5 py-1 text-xs rounded-md hover:bg-red-500/20 text-secondary transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Link Preview popup (v0.3.0) */}
              {linkPreview && (
                <div
                  className="fixed z-50 max-w-xs px-3 py-2 rounded-lg shadow-xl bg-surface/95 border border-border/50 backdrop-blur-sm pointer-events-none"
                  style={{ left: Math.max(10, linkPreview.x - 100), top: Math.max(10, linkPreview.y - 50) }}
                >
                  <p className="text-xs text-gray-400 truncate mb-0.5">{linkPreview.url.substring(0, 60)}</p>
                  <p className="text-sm text-primary">{linkPreview.summary}</p>
                </div>
              )}
            </div>

            <BottomBar isLoading={activeTab?.isLoading || false} url={activeTab?.url || ''} />
          </div>
        </>
      )}

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
