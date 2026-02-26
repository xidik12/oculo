import React, { useState, useEffect } from 'react'
import { Bookmark } from '../../../shared/types'

interface BookmarksSidebarProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (url: string) => void
}

export default function BookmarksSidebar({ isOpen, onClose, onNavigate }: BookmarksSidebarProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!isOpen) return
    loadBookmarks()
  }, [isOpen])

  async function loadBookmarks() {
    const api = (window as any).oculo
    if (!api?.bookmarksList) return
    const list = await api.bookmarksList()
    setBookmarks(list || [])
  }

  async function handleDelete(id: string) {
    const api = (window as any).oculo
    if (!api?.bookmarksDelete) return
    await api.bookmarksDelete(id)
    loadBookmarks()
  }

  const filtered = searchQuery
    ? bookmarks.filter(b => b.type === 'bookmark' && (
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.url.toLowerCase().includes(searchQuery.toLowerCase())
      ))
    : bookmarks.filter(b => b.type === 'bookmark')

  if (!isOpen) return null

  return (
    <div className="absolute left-[var(--sidebar-expanded)] top-0 bottom-0 w-[280px] bg-white dark:bg-surface-dark-0 border-r border-surface-3 dark:border-surface-dark-3 z-40 flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center h-[48px] px-3 border-b border-surface-3 dark:border-surface-dark-3 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1">Bookmarks</span>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500" title="Close">
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 flex-shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search bookmarks..."
          className="w-full h-[30px] px-2.5 rounded-md bg-surface-2 dark:bg-surface-dark-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:ring-1 focus:ring-accent/50"
          spellCheck={false}
        />
      </div>

      {/* Bookmark list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-[100px] text-sm text-gray-400">
            {searchQuery ? 'No matches' : 'No bookmarks yet'}
          </div>
        ) : (
          filtered.map(bm => (
            <div
              key={bm.id}
              className="group flex items-center gap-2.5 h-[34px] px-2 rounded-md cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-dark-2 transition-colors"
              onClick={() => onNavigate(bm.url)}
              title={bm.url}
            >
              <img
                src={bm.favicon || `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=16`}
                className="w-4 h-4 rounded-sm flex-shrink-0"
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              <span className="truncate text-xs text-gray-700 dark:text-gray-300 flex-1">{bm.title || bm.url}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(bm.id) }}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-400 flex-shrink-0 transition-opacity"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
