import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'

interface FindBarProps {
  isOpen: boolean
  onClose: () => void
  activeTabId: string
}

export default function FindBar({ isOpen, onClose, activeTabId }: FindBarProps) {
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
    } else {
      // Stop find when closing
      stopFind()
      setQuery('')
      setActiveMatch(0)
      setTotalMatches(0)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !query) {
      if (!query) stopFind()
      return
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      findInPage(query)
    }, 150)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [query, activeTabId])

  // Listen for found-in-page results from webview
  useEffect(() => {
    const api = (window as any).oculo
    if (!api) return
    const wv = getWebview()
    if (!wv) return

    const handler = (event: any) => {
      if (event.result) {
        setActiveMatch(event.result.activeMatchOrdinal || 0)
        setTotalMatches(event.result.matches || 0)
      }
    }
    wv.addEventListener('found-in-page', handler)
    return () => wv.removeEventListener('found-in-page', handler)
  }, [activeTabId, isOpen])

  function getWebview(): any {
    const api = (window as any).oculo
    if (!api) return null
    const webviews = document.querySelectorAll('webview')
    for (const wv of webviews) {
      const parent = wv.closest('div')
      if (parent && !parent.classList.contains('hidden')) return wv
    }
    return webviews[0] || null
  }

  function findInPage(text: string) {
    const wv = getWebview()
    if (wv && text) {
      wv.findInPage(text)
    }
  }

  function findNext() {
    const wv = getWebview()
    if (wv && query) wv.findInPage(query, { findNext: true, forward: true })
  }

  function findPrev() {
    const wv = getWebview()
    if (wv && query) wv.findInPage(query, { findNext: true, forward: false })
  }

  function stopFind() {
    const wv = getWebview()
    if (wv) {
      try { wv.stopFindInPage('clearSelection') } catch { /* ignore */ }
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      if (e.shiftKey) findPrev()
      else findNext()
    }
  }

  if (!isOpen) return null

  return (
    <div className="absolute top-1 right-4 z-30 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-surface-dark-1 border border-surface-3 dark:border-surface-dark-3 shadow-lg max-w-[420px]">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page..."
        className="w-[200px] bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
        spellCheck={false}
      />
      {query && (
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap tabular-nums">
          {totalMatches > 0 ? `${activeMatch} / ${totalMatches}` : 'No matches'}
        </span>
      )}
      <div className="flex items-center gap-0.5">
        <button onClick={findPrev} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500" title="Previous (Shift+Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <button onClick={findNext} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500" title="Next (Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500" title="Close (Escape)">
        <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 1l6 6M7 1L1 7" />
        </svg>
      </button>
    </div>
  )
}
