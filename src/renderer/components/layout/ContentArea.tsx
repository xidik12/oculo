import React from 'react'
import { Tab } from '../../../shared/types'
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
}

export default function ContentArea({ tabs, activeTabId, chatOpen, onWebViewUpdate, onCloseChat, isNewTab, isAbout, isContact, isGuide, onNavigate }: ContentAreaProps) {
  const isInternalPage = isNewTab || isAbout || isContact || isGuide

  return (
    <div className="absolute inset-0 flex">
      {/* Loading bar */}
      {tabs.find(t => t.id === activeTabId)?.isLoading && (
        <div className="absolute top-0 left-0 right-0 h-[2px] z-20">
          <div className="h-full bg-gradient-to-r from-accent/80 via-accent to-oculo-400/80 animate-loading-bar" />
        </div>
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
            />
          )
        })}
      </div>

      {/* Chat panel */}
      <ChatPanel isOpen={chatOpen} onClose={onCloseChat} />
    </div>
  )
}
