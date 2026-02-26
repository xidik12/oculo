import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react'
import { Tab, Bookmark, HistoryEntry } from '../../../shared/types'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  tabs: Tab[]
  onTabSwitch: (tabId: string) => void
  onNavigate: (url: string) => void
  onNewTab: (url?: string) => void
  onToggleChat: () => void
}

interface PaletteItem {
  id: string
  type: 'tab' | 'bookmark' | 'history' | 'action'
  label: string
  subtitle?: string
  icon?: string
  action: () => void
}

export default function CommandPalette({ isOpen, onClose, tabs, onTabSwitch, onNavigate, onNewTab, onToggleChat }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PaletteItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      buildResults('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const buildResults = useCallback(async (q: string) => {
    const items: PaletteItem[] = []
    const lq = q.toLowerCase()

    // Actions
    const actions: PaletteItem[] = [
      { id: 'new-tab', type: 'action', label: 'New Tab', subtitle: 'Cmd+T', action: () => { onNewTab(); onClose() } },
      { id: 'ai-chat', type: 'action', label: 'Toggle AI Chat', subtitle: 'Cmd+Shift+I', action: () => { onToggleChat(); onClose() } },
    ]

    if (!q) {
      items.push(...actions)
    } else {
      // Filter actions
      items.push(...actions.filter(a => a.label.toLowerCase().includes(lq)))
    }

    // Tabs
    const matchedTabs = tabs.filter(t =>
      !q || t.title.toLowerCase().includes(lq) || t.url.toLowerCase().includes(lq)
    ).map(t => ({
      id: `tab-${t.id}`,
      type: 'tab' as const,
      label: t.title || 'New Tab',
      subtitle: t.url,
      action: () => { onTabSwitch(t.id); onClose() }
    }))
    items.push(...matchedTabs)

    // Bookmarks
    try {
      const api = (window as any).oculo
      if (api?.bookmarksList) {
        const bms: Bookmark[] = await api.bookmarksList()
        const filtered = (bms || [])
          .filter(b => b.type === 'bookmark')
          .filter(b => !q || b.title.toLowerCase().includes(lq) || b.url.toLowerCase().includes(lq))
          .slice(0, 5)
        items.push(...filtered.map(b => ({
          id: `bm-${b.id}`,
          type: 'bookmark' as const,
          label: b.title,
          subtitle: b.url,
          action: () => { onNavigate(b.url); onClose() }
        })))
      }
    } catch { /* ignore */ }

    // History (debounced)
    if (q.length >= 2) {
      try {
        const api = (window as any).oculo
        if (api?.historyList) {
          const hist: HistoryEntry[] = await api.historyList(q, 5)
          items.push(...(hist || []).map((h, i) => ({
            id: `hist-${h.url}-${i}`,
            type: 'history' as const,
            label: h.title || h.url,
            subtitle: h.url,
            action: () => { onNavigate(h.url); onClose() }
          })))
        }
      } catch { /* ignore */ }
    }

    setResults(items)
    setSelectedIndex(0)
  }, [tabs, onTabSwitch, onNavigate, onNewTab, onToggleChat, onClose])

  useEffect(() => {
    if (!isOpen) return
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => buildResults(query), 100)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [query, isOpen, buildResults])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selectedIndex]) { results[selectedIndex].action() }
  }

  const typeIcons: Record<string, string> = {
    tab: 'T',
    bookmark: 'B',
    history: 'H',
    action: 'A'
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[560px] bg-white dark:bg-surface-dark-1 rounded-xl border border-surface-3 dark:border-surface-dark-3 shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center px-4 h-[48px] border-b border-surface-3 dark:border-surface-dark-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 mr-3">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tabs, bookmarks, history, or actions..."
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
            spellCheck={false}
          />
          <kbd className="text-[10px] text-gray-400 bg-surface-2 dark:bg-surface-dark-2 px-1.5 py-0.5 rounded">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">No results</div>
          ) : (
            results.map((item, i) => (
              <button
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-4 h-[38px] text-left transition-colors ${
                  i === selectedIndex ? 'bg-accent/10 dark:bg-accent/10' : 'hover:bg-surface-2 dark:hover:bg-surface-dark-2'
                }`}
              >
                <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                  i === selectedIndex ? 'bg-accent/20 text-accent' : 'bg-surface-3 dark:bg-surface-dark-3 text-gray-500'
                }`}>
                  {typeIcons[item.type]}
                </span>
                <span className="truncate text-sm text-gray-900 dark:text-gray-100 flex-1">{item.label}</span>
                {item.subtitle && <span className="truncate text-xs text-gray-400 max-w-[200px]">{item.subtitle}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
