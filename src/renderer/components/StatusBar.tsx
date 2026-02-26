import React, { useEffect, useState } from 'react'

interface Props {
  isLoading: boolean
  url: string
  chatOpen?: boolean
  onToggleChat?: () => void
}

export default function StatusBar({ isLoading, url, chatOpen, onToggleChat }: Props) {
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

  return (
    <div className="h-[var(--statusbar-height)] flex items-center px-3 bg-surface-1 dark:bg-surface-dark-1 border-t border-surface-3 dark:border-surface-dark-3 text-xs text-gray-500 dark:text-gray-400">
      <div className="flex items-center gap-2 flex-1 truncate">
        {isLoading && <span>Loading...</span>}
        <span className="truncate">{isLoading ? url : ''}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${mcpConnected ? 'bg-green-500' : 'bg-gray-500'}`} title={mcpConnected ? 'MCP Connected' : 'MCP Disconnected'} />
          <span>MCP</span>
        </div>
        <button
          onClick={onToggleChat}
          title="Toggle AI Chat (Cmd+Shift+I)"
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
            chatOpen
              ? 'bg-indigo-500/20 text-indigo-400'
              : 'hover:bg-white/10 text-gray-500 dark:text-gray-400'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M7 1L8.1 4.4L11.5 3.5L9.3 6.2L12 9H8.5L7 13L5.5 9H2L4.7 6.2L2.5 3.5L5.9 4.4L7 1Z"
              fill="currentColor"
              opacity={chatOpen ? 1 : 0.6}
            />
          </svg>
          <span>AI</span>
        </button>
      </div>
    </div>
  )
}
