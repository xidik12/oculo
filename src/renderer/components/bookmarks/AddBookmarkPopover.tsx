import React, { useState, useEffect, useRef } from 'react'

interface AddBookmarkPopoverProps {
  isOpen: boolean
  url: string
  title: string
  favicon?: string
  onSave: (title: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function AddBookmarkPopover({ isOpen, url, title, favicon, onSave, onRemove, onClose }: AddBookmarkPopoverProps) {
  const [editTitle, setEditTitle] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setEditTitle(title)
      setTimeout(() => inputRef.current?.select(), 100)
    }
  }, [isOpen, title])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Popover */}
      <div className="absolute top-[var(--toolbar-height)] right-[60px] z-50 w-[300px] p-3 rounded-lg bg-white dark:bg-surface-dark-1 border border-surface-3 dark:border-surface-dark-3 shadow-xl">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Bookmark added!</p>

        <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">Name</label>
        <input
          ref={inputRef}
          type="text"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          className="w-full h-[30px] px-2 rounded-md bg-surface-2 dark:bg-surface-dark-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-accent/50 mb-2"
          onKeyDown={e => { if (e.key === 'Enter') { onSave(editTitle); onClose() } }}
        />

        <div className="text-[11px] text-gray-400 truncate mb-3">{url}</div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => { onRemove(); onClose() }}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs rounded-md hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-600 dark:text-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { onSave(editTitle); onClose() }}
              className="px-3 py-1 text-xs rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-medium"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
