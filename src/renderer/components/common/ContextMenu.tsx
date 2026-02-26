import React, { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  action: () => void
  icon?: React.ReactNode
  danger?: boolean
  separator?: boolean
  disabled?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  // Adjust position if menu would go offscreen
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  }, [x, y])

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[180px] bg-white dark:bg-surface-dark-1 border border-surface-3 dark:border-surface-dark-3 rounded-lg shadow-xl py-1 select-none"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="mx-2 my-1 border-t border-surface-3 dark:border-surface-dark-3" />
        }
        return (
          <button
            key={i}
            onClick={() => { item.action(); onClose() }}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2 px-3 h-[30px] text-left text-xs transition-colors ${
              item.disabled
                ? 'text-gray-400 cursor-not-allowed'
                : item.danger
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-surface-2 dark:hover:bg-surface-dark-2'
            }`}
          >
            {item.icon && <span className="w-4 flex items-center justify-center flex-shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// Hook for context menu state
export function useContextMenu() {
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  const showContextMenu = React.useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  const closeContextMenu = React.useCallback(() => setMenu(null), [])

  return { menu, showContextMenu, closeContextMenu }
}
