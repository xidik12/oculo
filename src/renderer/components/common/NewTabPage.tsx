import React, { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { Bookmark, HistoryEntry } from '../../../shared/types'
import oculoIcon from '../../assets/oculo-icon.png'

interface NewTabPageProps {
  onNavigate: (url: string) => void
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^(https?|file|about):\/\//.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export default function NewTabPage({ onNavigate }: NewTabPageProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [recentVisits, setRecentVisits] = useState<HistoryEntry[]>([])
  const [searchValue, setSearchValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadData()
    setTimeout(() => inputRef.current?.focus(), 200)
  }, [])

  async function loadData() {
    const api = (window as any).oculo
    if (api?.bookmarksList) {
      const bms = await api.bookmarksList()
      setBookmarks((bms || []).filter((b: Bookmark) => b.type === 'bookmark').slice(0, 8))
    }
    if (api?.historyList) {
      const hist = await api.historyList(undefined, 12)
      // Deduplicate by domain
      const seen = new Set<string>()
      const deduped: HistoryEntry[] = []
      for (const h of (hist || [])) {
        try {
          const domain = new URL(h.url).hostname
          if (!seen.has(domain)) {
            seen.add(domain)
            deduped.push(h)
          }
        } catch { deduped.push(h) }
        if (deduped.length >= 8) break
      }
      setRecentVisits(deduped)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const normalized = normalizeUrl(searchValue)
      if (normalized) onNavigate(normalized)
    }
  }

  return (
    <div className="absolute inset-0 bg-surface-1 dark:bg-surface-dark-0 flex flex-col items-center pt-[15vh] overflow-y-auto">
      {/* Logo / Brand */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <img src={oculoIcon} alt="Oculo" className="w-20 h-20 rounded-2xl drop-shadow-lg" draggable={false} />
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Oculo</h1>
      </div>

      {/* Search bar */}
      <div className="w-full max-w-[520px] mb-10 px-4">
        <div className="flex items-center h-[44px] px-4 rounded-xl bg-white dark:bg-surface-dark-1 border border-surface-3 dark:border-surface-dark-3 shadow-sm focus-within:ring-2 focus-within:ring-accent/40 transition-shadow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 mr-3 flex-shrink-0">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or enter URL"
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
            spellCheck={false}
          />
        </div>
      </div>

      {/* Bookmarks grid */}
      {bookmarks.length > 0 && (
        <div className="w-full max-w-[520px] px-4 mb-8">
          <h2 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">Bookmarks</h2>
          <div className="grid grid-cols-4 gap-2">
            {bookmarks.map(bm => {
              let favicon: string | null = null
              try { favicon = bm.favicon || `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32` }
              catch { /* ignore */ }
              let displayName = bm.title
              try { if (!displayName || displayName.length > 20) displayName = new URL(bm.url).hostname.replace('www.', '') }
              catch { /* ignore */ }

              return (
                <button
                  key={bm.id}
                  onClick={() => onNavigate(bm.url)}
                  className="flex flex-col items-center gap-2 py-3 px-2 rounded-xl hover:bg-white dark:hover:bg-surface-dark-1 transition-colors group"
                  title={bm.url}
                >
                  <div className="w-10 h-10 rounded-xl bg-surface-2 dark:bg-surface-dark-2 flex items-center justify-center group-hover:bg-surface-3 dark:group-hover:bg-surface-dark-3 transition-colors">
                    {favicon ? (
                      <img src={favicon} className="w-5 h-5 rounded-sm" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <span className="text-sm font-bold text-gray-400">{(bm.title || '?')[0].toUpperCase()}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate w-full text-center">{displayName}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Recently visited */}
      {recentVisits.length > 0 && (
        <div className="w-full max-w-[520px] px-4 mb-8">
          <h2 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">Recently Visited</h2>
          <div className="grid grid-cols-4 gap-2">
            {recentVisits.map((entry, i) => {
              let hostname = ''
              let favicon: string | null = null
              try {
                const u = new URL(entry.url)
                hostname = u.hostname.replace('www.', '')
                favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`
              } catch { hostname = entry.url }

              return (
                <button
                  key={`${entry.url}-${i}`}
                  onClick={() => onNavigate(entry.url)}
                  className="flex flex-col items-center gap-2 py-3 px-2 rounded-xl hover:bg-white dark:hover:bg-surface-dark-1 transition-colors group"
                  title={entry.url}
                >
                  <div className="w-10 h-10 rounded-xl bg-surface-2 dark:bg-surface-dark-2 flex items-center justify-center group-hover:bg-surface-3 dark:group-hover:bg-surface-dark-3 transition-colors">
                    {favicon ? (
                      <img src={favicon} className="w-5 h-5 rounded-sm" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <span className="text-sm font-bold text-gray-400">{hostname[0]?.toUpperCase() || '?'}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate w-full text-center">{hostname}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
