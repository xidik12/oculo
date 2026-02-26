import React, { useState, useEffect, useRef } from 'react'
import { HistoryEntry } from '../../../shared/types'

interface HistoryPanelProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (url: string) => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const entryDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = today.getTime() - entryDate.getTime()
  const days = diff / (1000 * 60 * 60 * 24)

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function HistoryPanel({ isOpen, onClose, onNavigate }: HistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isOpen) return
    loadHistory()
  }, [isOpen])

  async function loadHistory(query?: string) {
    const api = (window as any).oculo
    if (!api?.historyList) return
    const list = await api.historyList(query, 200)
    setEntries(list || [])
  }

  function handleSearch(q: string) {
    setSearchQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      loadHistory(q || undefined)
    }, 200)
  }

  async function handleClear() {
    const api = (window as any).oculo
    if (!api?.historyClear) return
    await api.historyClear()
    setEntries([])
  }

  // Group entries by date
  const grouped: { date: string; items: HistoryEntry[] }[] = []
  let currentDate = ''
  for (const entry of entries) {
    const date = formatDate(entry.visitedAt)
    if (date !== currentDate) {
      currentDate = date
      grouped.push({ date, items: [] })
    }
    grouped[grouped.length - 1].items.push(entry)
  }

  if (!isOpen) return null

  return (
    <div className="absolute left-[var(--sidebar-expanded)] top-0 bottom-0 w-[320px] bg-white dark:bg-surface-dark-0 border-r border-surface-3 dark:border-surface-dark-3 z-40 flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center h-[48px] px-3 border-b border-surface-3 dark:border-surface-dark-3 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1">History</span>
        <button onClick={handleClear} className="text-[11px] text-red-400 hover:text-red-300 mr-2 transition-colors">Clear all</button>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500">
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 flex-shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search history..."
          className="w-full h-[30px] px-2.5 rounded-md bg-surface-2 dark:bg-surface-dark-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:ring-1 focus:ring-accent/50"
          spellCheck={false}
        />
      </div>

      {/* History list grouped by date */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center h-[100px] text-sm text-gray-400">
            {searchQuery ? 'No matches' : 'No history yet'}
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.date} className="mb-3">
              <div className="px-2 py-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{group.date}</div>
              {group.items.map((entry, i) => (
                <div
                  key={`${entry.url}-${entry.visitedAt}-${i}`}
                  className="group flex items-center gap-2.5 h-[34px] px-2 rounded-md cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-dark-2 transition-colors"
                  onClick={() => onNavigate(entry.url)}
                  title={entry.url}
                >
                  <span className="text-[10px] text-gray-400 tabular-nums w-[40px] flex-shrink-0">{formatTime(entry.visitedAt)}</span>
                  <span className="truncate text-xs text-gray-700 dark:text-gray-300 flex-1">{entry.title || entry.url}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
