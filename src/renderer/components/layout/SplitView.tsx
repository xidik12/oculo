import React, { useState, useRef, useCallback, useEffect } from 'react'

interface SplitViewProps {
  left: React.ReactNode
  right: React.ReactNode
  isActive: boolean
  onClose: () => void
}

export default function SplitView({ left, right, isActive, onClose }: SplitViewProps) {
  const [splitRatio, setSplitRatio] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = (e.clientX - rect.left) / rect.width
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const handleMouseUp = () => { dragging.current = false }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  if (!isActive) return <>{left}</>

  return (
    <div ref={containerRef} className="flex-1 flex relative">
      {/* Left pane */}
      <div className="relative overflow-hidden" style={{ width: `${splitRatio * 100}%` }}>
        {left}
      </div>

      {/* Divider */}
      <div
        className="w-[4px] bg-surface-3 dark:bg-surface-dark-3 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors flex-shrink-0 relative group"
        onMouseDown={handleMouseDown}
      >
        <button
          onClick={onClose}
          className="absolute top-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-surface-dark-2 border border-surface-dark-3 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-200 z-10"
          title="Close split view"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>

      {/* Right pane */}
      <div className="relative overflow-hidden flex-1">
        {right}
      </div>
    </div>
  )
}
