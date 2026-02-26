import React, { useEffect, useState } from 'react'

interface BottomBarProps {
  isLoading: boolean
  url: string
}

export default function BottomBar({ isLoading, url }: BottomBarProps) {
  const [mcpConnected, setMcpConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      const api = (window as any).oculo
      api?.getMcpStatus?.().then((status: any) => {
        if (!cancelled) setMcpConnected(status?.connected ?? false)
      }).catch(() => {
        if (!cancelled) setMcpConnected(false)
      })
    }
    check()
    const interval = setInterval(check, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Only show when loading or MCP status needs display
  if (!isLoading && !mcpConnected) return null

  return (
    <div className="h-[24px] flex items-center px-3 bg-surface-1 dark:bg-surface-dark-1 border-t border-surface-3 dark:border-surface-dark-3 text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
      <div className="flex-1 truncate">
        {isLoading && <span className="truncate">{url}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${mcpConnected ? 'bg-emerald-500' : 'bg-gray-500'}`} />
        <span className="text-[10px]">MCP</span>
      </div>
    </div>
  )
}
