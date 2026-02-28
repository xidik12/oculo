import React, { useRef, useEffect, useCallback } from 'react'
import { Tab } from '../../shared/types'

interface Props {
  tab: Tab
  isActive: boolean
  onUpdate: (updates: Partial<Tab>) => void
  onTextSelected?: (data: { text: string; x: number; y: number }) => void
  suspended?: boolean
}

export default function WebViewContainer({ tab, isActive, onUpdate, onTextSelected, suspended }: Props) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const lastLoadedUrl = useRef('')
  const domReady = useRef(false)
  // ContentArea won't render us for oculo://newtab — we always get a real URL
  const initialUrl = useRef(tab.url)

  // Set up event listeners once the webview DOM is ready
  const setupWebview = useCallback((wv: Electron.WebviewTag) => {
    if (domReady.current) return
    domReady.current = true
    lastLoadedUrl.current = initialUrl.current

    const onNav = (e: any) => {
      lastLoadedUrl.current = e.url
      onUpdate({ url: e.url, isLoading: false, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })
    }
    const onStartLoad = () => onUpdate({ isLoading: true, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })
    const onStopLoad = () => onUpdate({ isLoading: false, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })
    const onTitle = (e: any) => onUpdate({ title: e.title })
    const onFail = (e: any) => { if (e.errorCode !== -3) onUpdate({ isLoading: false, title: 'Failed to load' }) }

    // Crash recovery — when webview renderer crashes, auto-reload
    const onCrash = (e: any) => {
      console.warn('[Oculo] Webview crashed, reloading...', e?.reason || '')
      onUpdate({ isLoading: true, title: 'Reloading...' })
      setTimeout(() => {
        try { wv.reload() } catch { /* webview may be destroyed */ }
      }, 500)
    }
    const onUnresponsive = () => {
      console.warn('[Oculo] Webview unresponsive')
      onUpdate({ title: 'Page unresponsive...' })
    }
    const onResponsive = () => {
      console.log('[Oculo] Webview responsive again')
    }

    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-start-loading', onStartLoad)
    wv.addEventListener('did-stop-loading', onStopLoad)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('render-process-gone', onCrash)
    wv.addEventListener('crashed', onCrash)
    wv.addEventListener('unresponsive', onUnresponsive)
    wv.addEventListener('responsive', onResponsive)
  }, [onUpdate])

  // Register webview with preload API and set up dom-ready listener
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const notifyActive = () => {
      try {
        const wcId = (wv as any).getWebContentsId?.()
        if (wcId != null) {
          const api = (window as any).oculo
          api?.notifyActiveTab?.(wcId)
        }
      } catch { /* webview not ready yet */ }
    }

    const onDomReady = () => {
      setupWebview(wv)
      notifyActive()
    }

    const onDidNavigate = () => {
      if (isActive) notifyActive()
    }

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-navigate', onDidNavigate)

    // Listen for text selection from webview preload (Highlight-to-Ask)
    const onIpcMessage = (e: any) => {
      if (e.channel === 'text:selected' && onTextSelected && isActive) {
        onTextSelected(e.args?.[0] || e.args)
      }
    }
    wv.addEventListener('ipc-message', onIpcMessage)

    const api = (window as any).oculo
    if (api?.registerWebview) api.registerWebview(tab.id, wv)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-navigate', onDidNavigate)
      wv.removeEventListener('ipc-message', onIpcMessage)
      api?.unregisterWebview(tab.id)
    }
  }, [tab.id, setupWebview, isActive, onTextSelected])

  // Notify main process when this tab becomes active (with retry for pending dom-ready)
  useEffect(() => {
    if (!isActive) return
    const wv = webviewRef.current
    if (!wv) return

    const tryNotify = () => {
      try {
        const wcId = (wv as any).getWebContentsId?.()
        if (wcId != null) {
          const api = (window as any).oculo
          api?.notifyActiveTab?.(wcId)
          return true
        }
      } catch { /* webview not attached yet */ }
      return false
    }

    // Try immediately (may fail if dom-ready hasn't fired)
    if (tryNotify()) return

    // If webview isn't ready yet, retry after a short delay (dom-ready pending)
    const timer = setTimeout(tryNotify, 500)
    return () => clearTimeout(timer)
  }, [isActive])

  // Handle URL changes from address bar (subsequent navigations only)
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !domReady.current) return
    if (tab.url !== lastLoadedUrl.current) {
      lastLoadedUrl.current = tab.url
      wv.loadURL(tab.url).catch(() => {})
    }
  }, [tab.url])

  // Suspended tabs show placeholder instead of webview
  if (suspended && !isActive) {
    return (
      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-background hidden`}>
        <p className="text-secondary text-sm">Tab suspended to save resources</p>
        <p className="text-tertiary text-xs mt-1">{tab.title}</p>
      </div>
    )
  }

  // Dynamic partition: container tabs get isolated sessions
  const partition = tab.containerId ? `persist:container-${tab.containerId}` : 'persist:oculo'

  return (
    <div className={`absolute inset-0 flex flex-col ${isActive ? '' : 'hidden'}`}>
      <webview ref={webviewRef as any} src={initialUrl.current}
        partition={partition}
        preload={`file://${(window as any).oculo?.webviewPreloadPath}`}
        style={{ width: '100%', height: '100%' }}
        {...{ allowpopups: 'true' } as any} />
    </div>
  )
}
