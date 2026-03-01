import React from 'react'
import { Tab, TabGroup } from '../../../shared/types'
import { SidebarPanel } from '../../hooks/useSidebarState'

interface SidebarProps {
  tabs: Tab[]
  activeTabId: string
  expanded: boolean
  activePanel: SidebarPanel
  onTabSwitch: (id: string) => void
  onTabClose: (id: string) => void
  onNewTab: () => void
  onTogglePanel: (panel: SidebarPanel) => void
  onToggleChat: () => void
  onOpenSettings: () => void
  chatOpen: boolean
  tabGroups: TabGroup[]
  onTabContextMenu: (e: React.MouseEvent, tabId: string) => void
  onToggleGroupCollapse: (groupId: string) => void
}

function getFaviconUrl(tab: Tab): string | null {
  if (tab.favicon) return tab.favicon
  if (tab.url === 'oculo://newtab') return null
  try {
    const u = new URL(tab.url)
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`
    }
  } catch { /* ignore */ }
  return null
}

export default function Sidebar({
  tabs, activeTabId, expanded, activePanel,
  onTabSwitch, onTabClose, onNewTab,
  onTogglePanel, onToggleChat, onOpenSettings, chatOpen,
  tabGroups, onTabContextMenu, onToggleGroupCollapse
}: SidebarProps) {
  // Organize tabs: grouped tabs first (by group), then ungrouped
  const groupedTabIds = new Set(tabGroups.flatMap(g => g.tabIds))
  const ungroupedTabs = tabs.filter(t => !groupedTabIds.has(t.id))

  return (
    <div
      className={`flex flex-col h-full bg-sidebar-light-bg dark:bg-sidebar-bg flex-shrink-0 border-r border-sidebar-light-border dark:border-sidebar-border transition-all duration-200 ease-out ${
        expanded ? 'w-[var(--sidebar-expanded)]' : 'w-[var(--sidebar-width)]'
      }`}
    >
      {/* macOS traffic light spacer + drag region */}
      <div className="h-[38px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 space-y-0.5 scrollbar-thin">
        {/* Grouped tabs */}
        {tabGroups.map(group => (
          <div key={group.id} className="mb-1">
            {/* Group header */}
            <button
              onClick={() => onToggleGroupCollapse(group.id)}
              className={`flex items-center gap-1.5 h-[24px] rounded w-full transition-colors ${expanded ? 'px-2.5' : 'justify-center px-0'}`}
            >
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
              {expanded && (
                <>
                  <span className="text-[10px] font-semibold uppercase tracking-wider truncate flex-1 text-left" style={{ color: group.color }}>
                    {group.name}
                  </span>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500 flex-shrink-0" style={{ transform: group.collapsed ? 'rotate(-90deg)' : '' }}>
                    <path d="M1 3l3 3 3-3" strokeLinecap="round" />
                  </svg>
                </>
              )}
            </button>

            {/* Group tabs */}
            {!group.collapsed && group.tabIds.map(tabId => {
              const tab = tabs.find(t => t.id === tabId)
              if (!tab) return null
              return <TabPill key={tab.id} tab={tab} isActive={tab.id === activeTabId} expanded={expanded} tabs={tabs} onTabSwitch={onTabSwitch} onTabClose={onTabClose} onContextMenu={onTabContextMenu} groupColor={group.color} />
            })}
          </div>
        ))}

        {/* Ungrouped tabs */}
        {ungroupedTabs.map(tab => (
          <TabPill key={tab.id} tab={tab} isActive={tab.id === activeTabId} expanded={expanded} tabs={tabs} onTabSwitch={onTabSwitch} onTabClose={onTabClose} onContextMenu={onTabContextMenu} />
        ))}

        {/* New tab button */}
        <button
          onClick={onNewTab}
          className={`flex items-center gap-2.5 h-[36px] rounded-lg transition-colors text-gray-400 dark:text-gray-500 hover:bg-sidebar-light-hover dark:hover:bg-sidebar-hover hover:text-gray-600 dark:hover:text-gray-300 w-full ${
            expanded ? 'px-2.5' : 'justify-center'
          }`}
          title="New Tab"
        >
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </div>
          {expanded && <span className="text-xs font-medium">New Tab</span>}
        </button>
      </div>

      {/* Divider */}
      <div className="mx-2 border-t border-sidebar-light-border dark:border-sidebar-border" />

      {/* Bottom action icons */}
      <div className="flex-shrink-0 py-2 px-1.5 space-y-0.5">
        <SidebarButton icon="bookmarks" label="Bookmarks" expanded={expanded} active={activePanel === 'bookmarks'} onClick={() => onTogglePanel('bookmarks')} />
        <SidebarButton icon="downloads" label="Downloads" expanded={expanded} active={activePanel === 'downloads'} onClick={() => onTogglePanel('downloads')} />
        <SidebarButton icon="history" label="History" expanded={expanded} active={activePanel === 'history'} onClick={() => onTogglePanel('history')} />
        <SidebarButton icon="pipelines" label="Pipelines" expanded={expanded} active={activePanel === 'pipelines'} onClick={() => onTogglePanel('pipelines')} />
        <SidebarButton icon="ai" label="AI Chat" expanded={expanded} active={chatOpen} onClick={onToggleChat} />
        <SidebarButton icon="settings" label="Settings" expanded={expanded} active={false} onClick={onOpenSettings} />
      </div>
    </div>
  )
}

function TabPill({ tab, isActive, expanded, tabs, onTabSwitch, onTabClose, onContextMenu, groupColor }: {
  tab: Tab; isActive: boolean; expanded: boolean; tabs: Tab[]
  onTabSwitch: (id: string) => void; onTabClose: (id: string) => void
  onContextMenu: (e: React.MouseEvent, tabId: string) => void; groupColor?: string
}) {
  const favicon = getFaviconUrl(tab)
  return (
    <div
      onClick={() => onTabSwitch(tab.id)}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
      className={`group flex items-center gap-2.5 h-[36px] rounded-lg cursor-pointer transition-colors relative ${
        expanded ? 'px-2.5' : 'px-0 justify-center'
      } ${
        isActive
          ? 'bg-sidebar-light-active dark:bg-sidebar-active text-gray-900 dark:text-gray-100'
          : 'text-gray-600 dark:text-gray-400 hover:bg-sidebar-light-hover dark:hover:bg-sidebar-hover'
      }`}
      title={tab.title || 'New Tab'}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full" style={{ backgroundColor: groupColor || '#22d3ee' }} />
      )}

      {/* Favicon or loading spinner */}
      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
        {tab.isLoading ? (
          <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        ) : favicon ? (
          <img src={favicon} className="w-4 h-4 rounded-sm" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><circle cx="12" cy="12" r="10" /></svg>
        )}
      </div>

      {/* Title (only when expanded) */}
      {expanded && (
        <>
          <span className="truncate flex-1 text-xs font-medium">{tab.title || 'New Tab'}</span>
          {tabs.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
              className="opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 rounded w-5 h-5 flex items-center justify-center flex-shrink-0 transition-opacity"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
            </button>
          )}
        </>
      )}
    </div>
  )
}

function SidebarButton({ icon, label, expanded, active, onClick }: {
  icon: string; label: string; expanded: boolean; active: boolean; onClick: () => void
}) {
  const iconSvg: Record<string, React.ReactNode> = {
    bookmarks: <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>,
    downloads: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>,
    history: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    pipelines: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="1.5" fill="currentColor" /><circle cx="14" cy="12" r="1.5" fill="currentColor" /><circle cx="10" cy="18" r="1.5" fill="currentColor" /></svg>,
    ai: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" /><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>,
    settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
  }

  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 h-[36px] rounded-lg transition-colors w-full ${expanded ? 'px-2.5' : 'justify-center'} ${active ? 'text-accent bg-sidebar-light-active dark:bg-sidebar-active' : 'text-gray-400 dark:text-gray-500 hover:bg-sidebar-light-hover dark:hover:bg-sidebar-hover hover:text-gray-600 dark:hover:text-gray-300'}`} title={label}>
      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">{iconSvg[icon]}</div>
      {expanded && <span className="text-xs font-medium">{label}</span>}
    </button>
  )
}
