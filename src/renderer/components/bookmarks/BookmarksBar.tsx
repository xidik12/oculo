import React, { useState, useEffect } from 'react'
import { Bookmark } from '../../../shared/types'

interface BookmarksBarProps {
  isOpen: boolean
  onNavigate: (url: string) => void
}

export default function BookmarksBar({ isOpen, onNavigate }: BookmarksBarProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  useEffect(() => {
    if (!isOpen) return
    loadBookmarks()
  }, [isOpen])

  // Refresh when bar becomes visible
  useEffect(() => {
    if (!isOpen) return
    const interval = setInterval(loadBookmarks, 5000)
    return () => clearInterval(interval)
  }, [isOpen])

  async function loadBookmarks() {
    const api = (window as any).oculo
    if (!api?.bookmarksList) return
    const list = await api.bookmarksList()
    setBookmarks((list || []).filter((b: Bookmark) => b.type === 'bookmark' && b.parentId === null))
  }

  if (!isOpen || bookmarks.length === 0) return null

  return (
    <div className="h-[28px] flex items-center gap-0.5 px-2 bg-surface-1 dark:bg-surface-dark-1 border-b border-surface-3 dark:border-surface-dark-3 overflow-x-auto flex-shrink-0">
      {bookmarks.map(bm => {
        let favicon: string | null = null
        try { favicon = bm.favicon || `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=16` }
        catch { /* ignore */ }
        return (
          <button
            key={bm.id}
            onClick={() => onNavigate(bm.url)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 transition-colors max-w-[160px] flex-shrink-0"
            title={bm.url}
          >
            {favicon && (
              <img src={favicon} className="w-3.5 h-3.5 rounded-sm flex-shrink-0" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            <span className="truncate text-[11px] text-gray-700 dark:text-gray-300">{bm.title}</span>
          </button>
        )
      })}
    </div>
  )
}
