import React, { useRef, useCallback } from 'react'
import { Tab, PinnedApp } from '../../../shared/types'
import WebViewContainer from '../WebViewContainer'
import ChatPanel from '../ChatPanel'
import NewTabPage from '../common/NewTabPage'
import AboutPage from '../common/AboutPage'
import ContactPage from '../common/ContactPage'
import GuidePage from '../common/GuidePage'

interface ContentAreaProps {
  tabs: Tab[]
  activeTabId: string
  chatOpen: boolean
  onWebViewUpdate: (tabId: string, updates: Partial<Tab>) => void
  onCloseChat: () => void
  isNewTab: boolean
  isAbout: boolean
  isContact: boolean
  isGuide: boolean
  onNavigate: (url: string) => void
  onTextSelected?: (data: { text: string; x: number; y: number }) => void
  suspendedTabs?: Set<string>
  onCloseTab?: (tabId: string) => void
  pinnedApps?: PinnedApp[]
  onPinnedAppRemove?: (id: string) => void
  onPinnedAppWidthChange?: (id: string, width: number) => void
}

/** A single pinned sidebar panel with webview */
function PinnedPanel({
  app,
  onRemove,
  onWidthChange
}: {
  app: PinnedApp
  onRemove: (id: string) => void
  onWidthChange?: (id: string, width: number) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true

    const startX = e.clientX
    const startWidth = app.width

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = e.clientX - startX
      const newWidth = Math.max(200, Math.min(600, startWidth + delta))
      if (panelRef.current) {
        panelRef.current.style.width = `${newWidth}px`
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      isResizing.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      const delta = e.clientX - startX
      const finalWidth = Math.max(200, Math.min(600, startWidth + delta))
      onWidthChange?.(app.id, finalWidth)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [app.id, app.width, onWidthChange])

  return (
    <div
      ref={panelRef}
      className="flex-shrink-0 flex flex-col border-r border-border/50 relative"
      style={{ width: app.width }}
    >
      {/* Header bar */}
      <div className="h-8 flex items-center gap-1.5 px-2 bg-surface/80 border-b border-border/30 flex-shrink-0">
        {app.favicon && (
          <img src={app.favicon} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        <span className="text-xs text-secondary truncate flex-1 select-none">{app.title}</span>
        <button
          onClick={() => onRemove(app.id)}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 text-secondary hover:text-red-400 transition-colors flex-shrink-0"
          title="Unpin from sidebar"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Webview */}
      <webview
        src={app.url}
        partition="persist:oculo"
        className="flex-1"
        style={{ width: '100%', height: '100%' }}
        // @ts-ignore — Electron webview attributes
        allowpopups="true"
      />

      {/* Resize handle on the right edge */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-accent/30 active:bg-accent/50 transition-colors"
        onMouseDown={handleResizeStart}
      />
    </div>
  )
}

export default function ContentArea({ tabs, activeTabId, chatOpen, onWebViewUpdate, onCloseChat, isNewTab, isAbout, isContact, isGuide, onNavigate, onTextSelected, suspendedTabs, onCloseTab, pinnedApps, onPinnedAppRemove, onPinnedAppWidthChange }: ContentAreaProps) {
  const isInternalPage = isNewTab || isAbout || isContact || isGuide

  return (
    <div className="absolute inset-0 flex">
      {/* Loading bar */}
      {tabs.find(t => t.id === activeTabId)?.isLoading && (
        <div className="absolute top-0 left-0 right-0 h-[2px] z-20">
          <div className="h-full bg-gradient-to-r from-accent/80 via-accent to-oculo-400/80 animate-loading-bar" />
        </div>
      )}

      {/* Pinned sidebar panels — LEFT side */}
      {pinnedApps && pinnedApps.length > 0 && onPinnedAppRemove && (
        <>
          {pinnedApps.map(app => (
            <PinnedPanel
              key={app.id}
              app={app}
              onRemove={onPinnedAppRemove}
              onWidthChange={onPinnedAppWidthChange}
            />
          ))}
        </>
      )}

      {/* Webview area — absolute positioning guarantees full height */}
      <div className="flex-1 relative">
        {isNewTab && <NewTabPage onNavigate={onNavigate} />}
        {isAbout && <AboutPage />}
        {isContact && <ContactPage />}
        {isGuide && <GuidePage />}

        {tabs.map(tab => {
          if (tab.url.startsWith('oculo://')) return null
          return (
            <WebViewContainer
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onUpdate={(updates) => onWebViewUpdate(tab.id, updates)}
              onTextSelected={onTextSelected}
              onClose={tab.openerId ? () => onCloseTab?.(tab.id) : undefined}
              suspended={suspendedTabs?.has(tab.id)}
            />
          )
        })}
      </div>

      {/* Chat panel */}
      <ChatPanel isOpen={chatOpen} onClose={onCloseChat} />
    </div>
  )
}
