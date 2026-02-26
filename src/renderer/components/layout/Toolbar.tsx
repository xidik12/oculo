import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'

interface ToolbarProps {
  url: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isBookmarked: boolean
  isSecure: boolean
  onNavigate: (url: string) => void
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
  onToggleBookmark: () => void
  onFindInPage: () => void
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^(https?|file|about):\/\//.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export default function Toolbar({
  url, isLoading, canGoBack, canGoForward, isBookmarked, isSecure,
  onNavigate, onGoBack, onGoForward, onReload, onToggleBookmark, onFindInPage
}: ToolbarProps) {
  const [inputValue, setInputValue] = useState(url)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!isFocused) setInputValue(url) }, [url, isFocused])

  useEffect(() => {
    const api = (window as any).oculo
    const cleanup = api?.onFocusAddressBar?.(() => inputRef.current?.focus())
    return () => { cleanup?.() }
  }, [])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const normalized = normalizeUrl(inputValue)
      if (normalized) { onNavigate(normalized); inputRef.current?.blur() }
    } else if (e.key === 'Escape') {
      setInputValue(url); inputRef.current?.blur()
    }
  }

  const handleFocus = () => { setIsFocused(true); setTimeout(() => inputRef.current?.select(), 0) }

  return (
    <div
      className="h-[var(--toolbar-height)] flex items-center gap-1.5 px-3 bg-white dark:bg-surface-dark-0 border-b border-surface-3 dark:border-surface-dark-3 flex-shrink-0"
    >
      {/* Nav buttons */}
      <div className="flex items-center gap-0.5">
        <NavBtn onClick={onGoBack} disabled={!canGoBack} title="Back (Cmd+[)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </NavBtn>
        <NavBtn onClick={onGoForward} disabled={!canGoForward} title="Forward (Cmd+])">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </NavBtn>
        <NavBtn onClick={onReload} disabled={false} title={isLoading ? 'Stop' : 'Reload (Cmd+R)'}>
          {isLoading ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
          )}
        </NavBtn>
      </div>

      {/* Address bar */}
      <div
        className={`flex-1 flex items-center h-[32px] px-3 rounded-lg transition-all ${
          isFocused
            ? 'bg-white dark:bg-surface-dark-1 ring-2 ring-accent/60 dark:ring-accent/50'
            : 'bg-surface-2 dark:bg-surface-dark-2 hover:bg-surface-3 dark:hover:bg-surface-dark-1'
        }`}
      >
        {!isFocused && isSecure && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" className="mr-2 flex-shrink-0">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        )}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => setIsFocused(false)}
          className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
          placeholder="Search or enter URL"
          spellCheck={false}
        />
        {/* Bookmark star */}
        <button
          onClick={onToggleBookmark}
          className="ml-1 w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex-shrink-0"
          title={isBookmarked ? 'Remove bookmark' : 'Add bookmark (Cmd+D)'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isBookmarked ? '#22d3ee' : 'none'} stroke={isBookmarked ? '#22d3ee' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isBookmarked ? '' : 'text-gray-400'}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </div>

      {/* Find in page button */}
      <div style={{ WebkitAppRegion: 'no-drag' } as any}>
        <NavBtn onClick={onFindInPage} disabled={false} title="Find in page (Cmd+F)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </NavBtn>
      </div>
    </div>
  )
}

function NavBtn({ onClick, disabled, children, title }: { onClick: () => void; disabled: boolean; children: React.ReactNode; title: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-[30px] h-[30px] flex items-center justify-center rounded-md hover:bg-surface-3 dark:hover:bg-surface-dark-3 disabled:opacity-30 disabled:hover:bg-transparent text-gray-600 dark:text-gray-400 transition-colors"
    >
      {children}
    </button>
  )
}
