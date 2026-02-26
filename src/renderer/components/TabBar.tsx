import React from 'react'

interface TabBarProps {
  tabs: { id: string; title: string; isLoading: boolean }[]
  activeTabId: string
  onTabSwitch: (id: string) => void
  onTabClose: (id: string) => void
  onNewTab: () => void
}

export default function TabBar({ tabs, activeTabId, onTabSwitch, onTabClose, onNewTab }: TabBarProps) {
  return (
    <div className="flex items-end gap-0.5 h-[var(--tab-height)] overflow-x-auto">
      {tabs.map(tab => (
        <div key={tab.id} onClick={() => onTabSwitch(tab.id)}
          className={`group flex items-center gap-2 px-3 h-[34px] max-w-[200px] min-w-[100px] rounded-t-lg cursor-pointer transition-colors text-sm truncate ${
            tab.id === activeTabId
              ? 'bg-surface-0 dark:bg-surface-dark-0 text-gray-900 dark:text-gray-100'
              : 'bg-surface-2 dark:bg-surface-dark-2 text-gray-600 dark:text-gray-400 hover:bg-surface-1 dark:hover:bg-surface-dark-1'
          }`}>
          {tab.isLoading && <div className="w-3 h-3 border-2 border-oculo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          <span className="truncate flex-1 text-xs">{tab.title || 'New Tab'}</span>
          {tabs.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
              className="opacity-0 group-hover:opacity-100 hover:bg-surface-3 dark:hover:bg-surface-dark-3 rounded w-4 h-4 flex items-center justify-center flex-shrink-0"
              title="Close tab">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1l6 6M7 1L1 7" />
              </svg>
            </button>
          )}
        </div>
      ))}
      <button onClick={onNewTab} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500 text-lg mb-0.5 flex-shrink-0" title="New Tab">+</button>
    </div>
  )
}
