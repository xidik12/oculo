import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'

interface AddressBarProps {
  url: string; isLoading: boolean; canGoBack: boolean; canGoForward: boolean
  onNavigate: (url: string) => void; onGoBack: () => void; onGoForward: () => void; onReload: () => void
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^(https?|file|about):\/\//.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export default function AddressBar({ url, isLoading, canGoBack, canGoForward, onNavigate, onGoBack, onGoForward, onReload }: AddressBarProps) {
  const [inputValue, setInputValue] = useState(url)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!isFocused) setInputValue(url) }, [url, isFocused])

  // Focus address bar on Cmd+L
  useEffect(() => {
    const api = (window as any).oculo
    const cleanup = api?.onFocusAddressBar?.(() => {
      inputRef.current?.focus()
    })
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

  const NavBtn = ({ onClick, disabled, children, title }: { onClick: () => void; disabled: boolean; children: React.ReactNode; title: string }) => (
    <button onClick={onClick} disabled={disabled} title={title}
      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-3 dark:hover:bg-surface-dark-3 disabled:opacity-30 disabled:hover:bg-transparent text-gray-600 dark:text-gray-400 transition-colors">
      {children}
    </button>
  )

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-0 dark:bg-surface-dark-0 border-b border-surface-3 dark:border-surface-dark-3">
      <NavBtn onClick={onGoBack} disabled={!canGoBack} title="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </NavBtn>
      <NavBtn onClick={onGoForward} disabled={!canGoForward} title="Forward">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </NavBtn>
      <NavBtn onClick={onReload} disabled={false} title={isLoading ? 'Stop' : 'Reload'}>
        {isLoading ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
        )}
      </NavBtn>
      <div className={`flex-1 flex items-center h-8 px-3 rounded-lg transition-all ${isFocused ? 'bg-white dark:bg-surface-dark-1 ring-2 ring-oculo-500' : 'bg-surface-2 dark:bg-surface-dark-2 hover:bg-surface-3 dark:hover:bg-surface-dark-3'}`}>
        {!isFocused && url.startsWith('https://') && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" className="mr-2 flex-shrink-0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        )}
        <input ref={inputRef} type="text" value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={handleKeyDown} onFocus={handleFocus} onBlur={() => setIsFocused(false)}
          className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400" placeholder="Search or enter URL" spellCheck={false} />
      </div>
    </div>
  )
}
