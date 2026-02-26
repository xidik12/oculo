import React, { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react'
import { ChatMessage, ChatToolCall, ChatStreamEvent, TokenUsage } from '../../shared/types'
import { AI_PROVIDERS, AIProviderId } from '../../shared/ai-types'

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

function api() {
  return (window as any).oculo as {
    sendChatMessage(message: string): void
    clearChat(): void
    abortChat(): void
    getChatStatus(): Promise<{ hasClaudeCode: boolean; messageCount: number; activeProvider: string; activeModel: string; loggedIn: boolean; email?: string; authMode?: string }>
    onChatStream(callback: (event: ChatStreamEvent) => void): () => void
    aiSetProvider(providerId: string, modelId?: string): Promise<boolean>
    aiSetConfig(config: any): Promise<boolean>
    aiGetProviderStatus(providerId: string): Promise<{ providerId: string; connected: boolean; ready: boolean; error?: string; authMode?: string }>
    aiGetActive(): Promise<{ providerId: string; modelId: string }>
    authLogin(providerId: string): Promise<{ success: boolean; error?: string }>
    authStatus(): Promise<any>
  } | undefined
}

// ── Provider Icons ──────────────────────────────────────────────────────────

function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const icons: Record<string, React.ReactNode> = {
    claude: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-5-5 1.41-1.41L11 14.17l7.59-7.59L20 8l-9 9z" />
      </svg>
    ),
    gemini: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
    openai: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" /><path d="M8 12h8M12 8v8" strokeLinecap="round" />
      </svg>
    ),
    grok: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </svg>
    ),
    openclaw: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
      </svg>
    ),
    ollama: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" fill="currentColor" />
        <circle cx="15" cy="9" r="1.5" fill="currentColor" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      </svg>
    )
  }
  return <>{icons[provider] || icons.claude}</>
}

// ── Provider Selector ───────────────────────────────────────────────────────

function ProviderSelector({ activeProvider, activeModel, onSelect }: {
  activeProvider: string; activeModel: string
  onSelect: (providerId: string, modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, any>>({})

  useEffect(() => {
    AI_PROVIDERS.forEach(async (p) => {
      const status = await api()?.aiGetProviderStatus(p.id)
      if (status) setStatuses(prev => ({ ...prev, [p.id]: status }))
    })
  }, [open])

  const currentProvider = AI_PROVIDERS.find(p => p.id === activeProvider)
  const currentModel = currentProvider?.models.find(m => m.id === activeModel)

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 transition-colors text-xs">
        <ProviderIcon provider={activeProvider} size={12} />
        <span className="text-gray-300 font-medium">{currentModel?.name || currentProvider?.name || 'Select'}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
          <path d="M1 3l3 3 3-3" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-[320px] bg-surface-dark-1 border border-surface-dark-3 rounded-lg shadow-xl z-50 py-1 max-h-[400px] overflow-y-auto">
            {AI_PROVIDERS.map(provider => {
              const status = statuses[provider.id]
              const isActive = provider.id === activeProvider
              const isReady = status?.ready
              const authMode = status?.authMode

              return (
                <div key={provider.id} className="px-2 py-1">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <ProviderIcon provider={provider.id} size={14} />
                    <span className="text-xs font-semibold text-gray-200 flex-1">{provider.name}</span>
                    {isReady && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    {isReady && provider.id === 'ollama' && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-purple-900/50 text-purple-300">Local</span>
                    )}
                    {__ENABLE_OAUTH__ && isReady && provider.id !== 'ollama' && authMode === 'subscription' && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-oculo-900/50 text-oculo-300">CLI</span>
                    )}
                    {isReady && provider.id !== 'ollama' && authMode === 'api-key' && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-300">API</span>
                    )}
                  </div>

                  {!isReady && (
                    <p className="text-[10px] text-yellow-400/80 px-2 mb-1">
                      {status?.error || 'Not configured — go to Settings'}
                    </p>
                  )}

                  <p className="text-[10px] text-gray-500 px-2 mb-1">{provider.description}</p>

                  <div className="space-y-0.5">
                    {provider.models.map(model => {
                      const selected = isActive && activeModel === model.id
                      return (
                        <button key={model.id}
                          onClick={() => { onSelect(provider.id, model.id); setOpen(false) }}
                          disabled={!isReady}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs text-left transition-colors ${
                            selected ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                          } ${!isReady ? 'opacity-40 cursor-not-allowed' : ''}`}>
                          {selected && <span className="text-accent text-[10px]">&#10003;</span>}
                          <span className={selected ? '' : 'ml-4'}>{model.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mx-2 mt-1 border-t border-surface-dark-3" />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Shared state hook ───────────────────────────────────────────────────────

function useChatState() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [streamingToolCalls, setStreamingToolCalls] = useState<ChatToolCall[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [activeProvider, setActiveProvider] = useState('claude')
  const [activeModel, setActiveModel] = useState('claude-sonnet-4-6')
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null)
  const toolCallsRef = useRef<ChatToolCall[]>([])
  const pendingUsageRef = useRef<TokenUsage | null>(null)

  useEffect(() => {
    const cleanup = api()?.onChatStream((event: ChatStreamEvent) => {
      switch (event.type) {
        case 'text_delta':
          setStreamingText(prev => prev + event.text)
          setError(null)
          break
        case 'tool_use_start':
          setStreamingToolCalls(prev => {
            const next = [...prev, event.toolCall]
            toolCallsRef.current = next
            return next
          })
          break
        case 'tool_use_result':
          setStreamingToolCalls(prev => {
            const next = prev.map(tc =>
              tc.id === event.toolCallId
                ? { ...tc, result: event.result, isError: event.isError, status: (event.isError ? 'error' : 'done') as ChatToolCall['status'] }
                : tc
            )
            toolCallsRef.current = next
            return next
          })
          break
        case 'usage':
          pendingUsageRef.current = event.usage
          break
        case 'done': {
          const finalToolCalls = toolCallsRef.current
          setMessages(prev => [...prev, {
            ...event.message,
            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined
          }])
          setLastUsage(pendingUsageRef.current)
          pendingUsageRef.current = null
          setStreamingText('')
          setStreamingToolCalls([])
          toolCallsRef.current = []
          setIsStreaming(false)
          break
        }
        case 'error':
          setError(event.error)
          setLastUsage(pendingUsageRef.current)
          pendingUsageRef.current = null
          setStreamingText('')
          setStreamingToolCalls([])
          toolCallsRef.current = []
          setIsStreaming(false)
          break
      }
    })
    return () => { cleanup?.() }
  }, [])

  const handleProviderSelect = useCallback(async (providerId: string, modelId: string) => {
    setActiveProvider(providerId)
    setActiveModel(modelId)
    await api()?.aiSetProvider(providerId, modelId)
    handleClear()
  }, [])

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text || isStreaming) return
    const userMessage: ChatMessage = { id: `msg-${Date.now()}-user`, role: 'user', content: text, timestamp: Date.now() }
    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsStreaming(true)
    setError(null)
    setStreamingText('')
    setStreamingToolCalls([])
    api()?.sendChatMessage(text)
  }, [inputValue, isStreaming])

  const handleClear = useCallback(() => {
    api()?.clearChat()
    setMessages([])
    setStreamingText('')
    setStreamingToolCalls([])
    toolCallsRef.current = []
    setIsStreaming(false)
    setError(null)
    setLastUsage(null)
    pendingUsageRef.current = null
  }, [])

  const handleStop = useCallback(() => {
    api()?.abortChat()
    setIsStreaming(false)
  }, [])

  return {
    messages, streamingText, streamingToolCalls, isStreaming, error,
    inputValue, setInputValue, activeProvider, activeModel, lastUsage,
    handleProviderSelect, handleSend, handleClear, handleStop
  }
}

// ── Chat Input ──────────────────────────────────────────────────────────────

function ChatInput({ value, onChange, onKeyDown, onSend, onStop, isStreaming, inputRef, placeholder }: {
  value: string; onChange: (val: string) => void; onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void; onStop: () => void; isStreaming: boolean; inputRef: React.RefObject<HTMLTextAreaElement | null>
  placeholder?: string
}) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  return (
    <div className="flex-shrink-0 border-t border-surface-dark-3 p-2">
      <div className="flex items-end gap-2">
        <textarea ref={inputRef as any} value={value} onChange={handleChange} onKeyDown={onKeyDown}
          placeholder={placeholder || (isStreaming ? 'Wait for response...' : 'Message... (Enter to send)')}
          disabled={isStreaming} rows={1}
          className="flex-1 resize-none px-3 py-2 rounded-md bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-sm font-mono placeholder-gray-600 outline-none focus:border-accent/50 transition-colors disabled:opacity-50"
          style={{ maxHeight: '120px' }} />
        {isStreaming ? (
          <button onClick={onStop}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 text-red-400 transition-colors" title="Stop">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="2" /></svg>
          </button>
        ) : (
          <button onClick={onSend} disabled={!value.trim()}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-accent/80 hover:bg-accent disabled:opacity-30 disabled:hover:bg-accent/80 text-white transition-colors" title="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
      <p className="text-[10px] text-gray-600 mt-1.5 px-1">Shift+Enter for new line</p>
    </div>
  )
}

// ── Chat View (bubbles) ─────────────────────────────────────────────────────

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0; let match: RegExpExecArray | null; let partIdx = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(<span key={`${keyPrefix}-t${partIdx++}`}>{text.slice(lastIndex, match.index)}</span>)
    if (match[2]) nodes.push(<strong key={`${keyPrefix}-b${partIdx++}`} className="font-semibold text-gray-100">{match[2]}</strong>)
    else if (match[3]) nodes.push(<em key={`${keyPrefix}-i${partIdx++}`} className="italic text-gray-200">{match[3]}</em>)
    else if (match[4]) nodes.push(<code key={`${keyPrefix}-c${partIdx++}`} className="px-1 py-0.5 rounded bg-surface-dark-2 text-oculo-300 font-mono text-[0.85em]">{match[4]}</code>)
    else if (match[5] && match[6]) nodes.push(<a key={`${keyPrefix}-a${partIdx++}`} className="text-accent hover:underline cursor-pointer" title={match[6]}>{match[5]}</a>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(<span key={`${keyPrefix}-t${partIdx}`}>{text.slice(lastIndex)}</span>)
  return nodes
}

function renderMarkdownLite(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code blocks (```)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <div key={`code-${i}`} className="my-2 rounded-lg overflow-hidden border border-surface-dark-3">
          {lang && <div className="bg-surface-dark-2 px-3 py-1 text-[10px] text-gray-500 font-mono">{lang}</div>}
          <pre className="bg-[#0d1117] px-3 py-2 text-[12px] font-mono text-gray-300 overflow-x-auto whitespace-pre">{codeLines.join('\n')}</pre>
        </div>
      )
      continue
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h3-${i}`} className="text-sm font-bold text-gray-100 mt-3 mb-1">{renderInlineMarkdown(line.slice(4), `h3-${i}`)}</h4>)
      i++; continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={`h2-${i}`} className="text-sm font-bold text-gray-100 mt-3 mb-1">{renderInlineMarkdown(line.slice(3), `h2-${i}`)}</h3>)
      i++; continue
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={`h1-${i}`} className="text-base font-bold text-gray-50 mt-3 mb-1">{renderInlineMarkdown(line.slice(2), `h1-${i}`)}</h2>)
      i++; continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="border-t border-surface-dark-3 my-2" />)
      i++; continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <blockquote key={`bq-${i}`} className="border-l-2 border-accent/40 pl-3 my-1 text-gray-400 italic text-[13px]">
          {quoteLines.map((ql, qi) => <span key={qi}>{renderInlineMarkdown(ql, `bq-${i}-${qi}`)}{qi < quoteLines.length - 1 && <br />}</span>)}
        </blockquote>
      )
      continue
    }

    // Unordered list
    if (/^[\-\*]\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^[\-\*]\s/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside my-1 space-y-0.5">
          {listItems.map((li, idx) => <li key={idx} className="text-gray-300">{renderInlineMarkdown(li, `ul-${i}-${idx}`)}</li>)}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside my-1 space-y-0.5">
          {listItems.map((li, idx) => <li key={idx} className="text-gray-300">{renderInlineMarkdown(li, `ol-${i}-${idx}`)}</li>)}
        </ol>
      )
      continue
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^\|?[\s\-|:]+\|?$/.test(lines[i + 1])) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) => row.split('|').map(c => c.trim()).filter(Boolean)
        const headers = parseRow(tableLines[0])
        const rows = tableLines.slice(2).map(parseRow)
        elements.push(
          <div key={`tbl-${i}`} className="my-2 overflow-x-auto rounded border border-surface-dark-3">
            <table className="w-full text-xs">
              <thead><tr className="bg-surface-dark-2">
                {headers.map((h, hi) => <th key={hi} className="px-2 py-1 text-left text-gray-300 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((row, ri) => <tr key={ri} className="border-t border-surface-dark-3">
                  {row.map((cell, ci) => <td key={ci} className="px-2 py-1 text-gray-400">{renderInlineMarkdown(cell, `td-${i}-${ri}-${ci}`)}</td>)}
                </tr>)}
              </tbody>
            </table>
          </div>
        )
        continue
      }
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`sp-${i}`} className="h-1" />)
      i++; continue
    }

    // Regular paragraph
    elements.push(<p key={`p-${i}`} className="my-0.5">{renderInlineMarkdown(line, `p-${i}`)}</p>)
    i++
  }

  return elements
}

function ToolCallDetail({ toolCall }: { toolCall: ChatToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = toolCall.result != null && toolCall.result.length > 0
  const statusIcon = toolCall.status === 'done' ? <span className="text-emerald-400 text-[10px]">&#10003;</span>
    : toolCall.status === 'error' ? <span className="text-red-400 text-[10px]">&#10007;</span>
    : <span className="text-gray-500 text-[10px]">&#9675;</span>

  return (
    <div>
      <button onClick={() => hasResult && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded transition-colors w-full text-left ${hasResult ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
        <span className="flex-shrink-0 w-3 text-center">{statusIcon}</span>
        <span className="text-accent">[{toolCall.name}]</span>
        <span className={`truncate ${toolCall.isError ? 'text-red-400' : 'text-gray-500'}`}>
          {toolCall.isError ? 'Error' : 'Done'}
        </span>
        {hasResult && <span className="ml-auto text-gray-600 flex-shrink-0 text-[9px]">{expanded ? '\u25BC' : '\u25B6'}</span>}
      </button>
      {expanded && hasResult && (
        <pre className={`mt-0.5 ml-5 px-2 py-1 rounded text-[11px] font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto ${
          toolCall.isError ? 'bg-red-900/20 text-red-300 border border-red-800/30' : 'bg-surface-dark-0 text-gray-300 border border-surface-dark-3'
        }`}>{toolCall.result}</pre>
      )}
    </div>
  )
}

function ToolCallGroup({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const [expanded, setExpanded] = useState(false)
  const runningCall = toolCalls.find(tc => tc.status === 'running')
  const doneCalls = toolCalls.filter(tc => tc.status === 'done' || tc.status === 'error')
  const errorCount = toolCalls.filter(tc => tc.status === 'error').length

  // While running: show active tool + compact summary of done ones
  // All done: single collapsed summary line
  return (
    <div className="my-1.5">
      {/* Summary row */}
      {doneCalls.length > 0 && (
        <button onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded hover:bg-white/5 transition-colors w-full text-left">
          <span className="text-accent/60 flex-shrink-0">&#9889;</span>
          <span className="text-gray-400">
            {doneCalls.length} tool call{doneCalls.length !== 1 ? 's' : ''}
            {errorCount > 0 && <span className="text-red-400 ml-1">({errorCount} error{errorCount !== 1 ? 's' : ''})</span>}
          </span>
          <span className="ml-auto text-gray-600 text-[9px] flex-shrink-0">{expanded ? '\u25BC' : '\u25B6'}</span>
        </button>
      )}

      {/* Currently running tool — always visible */}
      {runningCall && (
        <div className="flex items-center gap-2 font-mono text-xs px-2 py-1">
          <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-accent">{runningCall.name}</span>
          <span className="text-gray-500 truncate">
            {runningCall.input?.action || runningCall.input?.what || ''}
          </span>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="ml-1 mt-0.5 border-l border-surface-dark-3 pl-1">
          {toolCalls.map(tc => <ToolCallDetail key={tc.id} toolCall={tc} />)}
        </div>
      )}
    </div>
  )
}

// ── Auth Welcome Screen ─────────────────────────────────────────────────────

function AuthWelcome({ onLogin }: { onLogin: (providerId: string) => void }) {
  const [loading, setLoading] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, any>>({})

  useEffect(() => {
    // Check which providers are ready
    ;['claude', 'openai'].forEach(async (id) => {
      const status = await api()?.aiGetProviderStatus(id)
      if (status) setStatuses(prev => ({ ...prev, [id]: status }))
    })
  }, [])

  const handleLogin = async (providerId: string) => {
    setLoading(providerId)
    try {
      const result = await api()?.authLogin(providerId)
      if (result?.success) {
        onLogin(providerId)
      } else {
        setLoading(null)
      }
    } catch {
      setLoading(null)
    }
  }

  const claudeReady = statuses['claude']?.ready
  const openaiReady = statuses['openai']?.ready
  const anyReady = claudeReady || openaiReady

  if (anyReady) return null // Don't show auth screen if already logged in

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Welcome to Oculo AI</h3>
        <p className="text-xs text-gray-500 leading-relaxed max-w-[280px]">
          {__ENABLE_OAUTH__
            ? 'Sign in with your existing subscription or add an API key in Settings to get started.'
            : 'Add an API key in Settings to get started.'}
        </p>
      </div>

      {__ENABLE_OAUTH__ && (
        <div className="w-full max-w-[280px] space-y-2 mt-1">
          <button
            onClick={() => handleLogin('claude')}
            disabled={loading !== null}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#d97706]/10 border border-[#d97706]/20 hover:bg-[#d97706]/15 hover:border-[#d97706]/30 transition-colors text-left disabled:opacity-50 disabled:cursor-wait">
            <div className="w-7 h-7 rounded-md bg-[#d97706]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[#d97706] text-sm font-bold">C</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-200">Sign in with Claude</div>
              <div className="text-[10px] text-gray-500">Max / Pro subscription</div>
            </div>
            {loading === 'claude' && <span className="w-3 h-3 border-2 border-[#d97706] border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          </button>

          <button
            onClick={() => handleLogin('openai')}
            disabled={loading !== null}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15 hover:border-emerald-500/30 transition-colors text-left disabled:opacity-50 disabled:cursor-wait">
            <div className="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-400 text-sm font-bold">G</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-200">Sign in with OpenAI</div>
              <div className="text-[10px] text-gray-500">ChatGPT Plus / Pro subscription</div>
            </div>
            {loading === 'openai' && <span className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          </button>
        </div>
      )}

      {__ENABLE_OAUTH__ && (
        <div className="flex items-center gap-2 w-full max-w-[280px]">
          <div className="flex-1 border-t border-surface-dark-3" />
          <span className="text-[10px] text-gray-600">or</span>
          <div className="flex-1 border-t border-surface-dark-3" />
        </div>
      )}

      <p className="text-[10px] text-gray-600 max-w-[280px]">
        Add an API key in <span className="text-gray-400">Settings &gt; AI Providers</span> {__ENABLE_OAUTH__ ? 'for direct access' : 'to get started'}.
      </p>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function TokenUsageDisplay({ usage }: { usage: TokenUsage }) {
  const total = usage.inputTokens + usage.outputTokens
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-gray-500 font-mono border-t border-surface-dark-3/50">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-gray-600 flex-shrink-0">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM8 4v4l3 1.5" />
      </svg>
      <span>{formatTokens(total)} tokens</span>
      <span className="text-gray-700">({formatTokens(usage.inputTokens)} in, {formatTokens(usage.outputTokens)} out)</span>
    </div>
  )
}

function ChatView({ state, onAuthComplete }: { state: ReturnType<typeof useChatState>; onAuthComplete?: () => void }) {
  const { messages, streamingText, streamingToolCalls, isStreaming, error, inputValue, setInputValue, handleSend, handleStop, lastUsage } = state
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  // Check if any provider is authenticated
  useEffect(() => {
    let cancelled = false
    async function check() {
      const statuses = await Promise.all(
        ['claude', 'openai', 'gemini', 'grok'].map(id => api()?.aiGetProviderStatus(id))
      )
      if (cancelled) return
      const anyReady = statuses.some(s => s?.ready)
      setNeedsAuth(!anyReady)
      setAuthChecked(true)
    }
    check()
    return () => { cancelled = true }
  }, [])

  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [])
  useEffect(() => { scrollToBottom() }, [messages, streamingText, streamingToolCalls, error, scrollToBottom])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  // Show auth screen if no provider is ready and no messages yet
  if (authChecked && needsAuth && messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <AuthWelcome onLogin={() => { setNeedsAuth(false); onAuthComplete?.() }} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-3 py-3 scroll-smooth select-text" style={{ scrollbarWidth: 'thin', scrollbarColor: '#373a40 transparent', userSelect: 'text', WebkitUserSelect: 'text' }}>
        {messages.length === 0 && !isStreaming && !error && (
          <div className="flex flex-col items-center justify-center h-full px-6 gap-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round" />
                <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed max-w-[280px]">
              Ask me anything about the page you're viewing. I can help you browse, fill forms, extract data, and more.
            </p>
          </div>
        )}
        {messages.map(msg => (
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end mb-3">
              <div className="max-w-[85%] px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 text-gray-200 text-sm">{msg.content}</div>
            </div>
          ) : (
            <div key={msg.id} className="mb-3">
              <div className="text-sm text-gray-300 leading-relaxed">{renderMarkdownLite(msg.content)}</div>
              {msg.toolCalls && msg.toolCalls.length > 0 && <ToolCallGroup toolCalls={msg.toolCalls} />}
            </div>
          )
        ))}
        {isStreaming && (streamingText || streamingToolCalls.length > 0) && (
          <div className="mb-3">
            {streamingText && <div className="text-sm text-gray-300 leading-relaxed">{renderMarkdownLite(streamingText)}<span className="inline-block w-[7px] h-[15px] bg-accent ml-0.5 align-middle animate-pulse rounded-sm" /></div>}
            {streamingToolCalls.length > 0 && <ToolCallGroup toolCalls={streamingToolCalls} />}
          </div>
        )}
        {isStreaming && !streamingText && streamingToolCalls.length === 0 && (
          <div className="mb-3 flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-500 font-mono">Thinking...</span>
          </div>
        )}
        {error && <div className="mb-3 px-3 py-2 rounded-md bg-red-900/20 border border-red-800/30 text-red-300 text-sm font-mono whitespace-pre-wrap">{error}</div>}
        <div ref={messagesEndRef} />
      </div>
      {lastUsage && !isStreaming && <TokenUsageDisplay usage={lastUsage} />}
      <ChatInput value={inputValue} onChange={setInputValue} onKeyDown={handleKeyDown} onSend={handleSend} onStop={handleStop} isStreaming={isStreaming} inputRef={inputRef} />
    </div>
  )
}

// ── Terminal View ───────────────────────────────────────────────────────────

function TerminalView({ state }: { state: ReturnType<typeof useChatState> }) {
  const { messages, streamingText, streamingToolCalls, isStreaming, error, inputValue, setInputValue, handleSend, handleStop, lastUsage } = state
  const termEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [])
  useEffect(() => { scrollToBottom() }, [messages, streamingText, streamingToolCalls, error, scrollToBottom])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto font-mono text-[13px] leading-[1.6] bg-[#0d1117] px-4 py-3 select-text"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#373a40 transparent', userSelect: 'text', WebkitUserSelect: 'text' }}>

        {messages.length === 0 && !isStreaming && !error && (
          <div className="text-gray-600 py-4">
            <div className="text-accent mb-1">~ Oculo AI Terminal</div>
            <div className="text-gray-500">Type a message below. Output streams here like a CLI.</div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="mb-3">
            {msg.role === 'user' ? (
              <div>
                <span className="text-emerald-400 select-none">&#10095; </span>
                <span className="text-gray-100">{msg.content}</span>
              </div>
            ) : (
              <>
                {msg.content && (
                  <div className="text-gray-300 whitespace-pre-wrap pl-2 border-l-2 border-surface-dark-3 ml-1">
                    {msg.content}
                  </div>
                )}
                {msg.toolCalls && msg.toolCalls.length > 0 && <TerminalToolCallGroup toolCalls={msg.toolCalls} />}
              </>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="mb-3">
            {streamingText && (
              <div className="text-gray-300 whitespace-pre-wrap pl-2 border-l-2 border-accent/30 ml-1">
                {streamingText}
                <span className="inline-block w-2 h-4 bg-accent/70 ml-0.5 animate-pulse" />
              </div>
            )}
            {streamingToolCalls.length > 0 && <TerminalToolCallGroup toolCalls={streamingToolCalls} />}
            {!streamingText && streamingToolCalls.length === 0 && (
              <div className="flex items-center gap-2 text-gray-500">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span>thinking...</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3">
            <span className="text-red-400 select-none">error: </span>
            <span className="text-red-300 whitespace-pre-wrap">{error}</span>
          </div>
        )}

        <div ref={termEndRef} />
      </div>

      {lastUsage && !isStreaming && (
        <div className="text-[11px] text-gray-600 font-mono px-4 py-1">
          tokens: {formatTokens(lastUsage.inputTokens + lastUsage.outputTokens)} ({formatTokens(lastUsage.inputTokens)} in / {formatTokens(lastUsage.outputTokens)} out)
        </div>
      )}
      <ChatInput value={inputValue} onChange={setInputValue} onKeyDown={handleKeyDown} onSend={handleSend} onStop={handleStop}
        isStreaming={isStreaming} inputRef={inputRef} placeholder={isStreaming ? 'Streaming...' : '> Enter command...'} />
    </div>
  )
}

function TerminalToolCall({ toolCall }: { toolCall: ChatToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = toolCall.result != null && toolCall.result.length > 0

  const statusChar = toolCall.status === 'running' ? '...'
    : toolCall.status === 'done' ? 'ok'
    : toolCall.status === 'error' ? 'err'
    : '?'

  const statusColor = toolCall.status === 'running' ? 'text-yellow-400'
    : toolCall.status === 'done' ? 'text-emerald-400'
    : toolCall.status === 'error' ? 'text-red-400'
    : 'text-gray-500'

  return (
    <div className="my-1 ml-2">
      <button onClick={() => hasResult && setExpanded(!expanded)}
        className={`flex items-center gap-1 text-[12px] transition-colors ${hasResult ? 'hover:text-gray-200 cursor-pointer' : 'cursor-default'}`}>
        {toolCall.status === 'running' && (
          <span className="inline-block w-2.5 h-2.5 border border-yellow-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
        <span className="text-oculo-400">{toolCall.name}</span>
        <span className={statusColor}>[{statusChar}]</span>
        {hasResult && <span className="text-gray-600 ml-1">{expanded ? '\u25BC' : '\u25B6'}</span>}
      </button>
      {expanded && hasResult && (
        <pre className={`mt-0.5 ml-3 px-2 py-1 rounded text-[11px] whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto ${
          toolCall.isError ? 'bg-red-900/15 text-red-300' : 'bg-[#161b22] text-gray-400'
        }`}>{toolCall.result}</pre>
      )}
    </div>
  )
}

function TerminalToolCallGroup({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const [expanded, setExpanded] = useState(false)
  const runningCall = toolCalls.find(tc => tc.status === 'running')
  const doneCalls = toolCalls.filter(tc => tc.status === 'done' || tc.status === 'error')

  return (
    <div className="my-1 ml-2">
      {doneCalls.length > 0 && (
        <button onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[12px] hover:text-gray-200 cursor-pointer transition-colors">
          <span className="text-accent/60">&#9889;</span>
          <span className="text-gray-500">
            {doneCalls.length} tool call{doneCalls.length !== 1 ? 's' : ''}
          </span>
          <span className="text-gray-600 ml-1 text-[9px]">{expanded ? '\u25BC' : '\u25B6'}</span>
        </button>
      )}
      {runningCall && (
        <div className="flex items-center gap-1 text-[12px] mt-0.5">
          <span className="inline-block w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-oculo-400">{runningCall.name}</span>
          <span className="text-gray-500 truncate">
            {runningCall.input?.action || runningCall.input?.what || ''}
          </span>
        </div>
      )}
      {expanded && toolCalls.map(tc => <TerminalToolCall key={tc.id} toolCall={tc} />)}
    </div>
  )
}

// ── Main ChatPanel ──────────────────────────────────────────────────────────

type ViewMode = 'chat' | 'terminal'

export default function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const [authMode, setAuthMode] = useState<string>('')
  const state = useChatState()

  useEffect(() => {
    if (!isOpen) return
    api()?.aiGetActive().then(active => {
      if (active) state.handleProviderSelect(active.providerId, active.modelId)
    })
    api()?.getChatStatus().then(s => {
      if (s?.authMode) setAuthMode(s.authMode)
    })
  }, [isOpen])

  return (
    <div className={`flex-shrink-0 h-full flex flex-col bg-surface-dark-0 border-l border-surface-dark-3 transition-all duration-200 ease-out overflow-hidden ${isOpen ? 'w-[420px]' : 'w-0'}`}>
      {/* Header */}
      <div className="flex items-center h-11 px-2 border-b border-surface-dark-3 flex-shrink-0 gap-1">
        <ProviderSelector activeProvider={state.activeProvider} activeModel={state.activeModel} onSelect={state.handleProviderSelect} />

        {authMode && (authMode !== 'subscription' || __ENABLE_OAUTH__) && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
            authMode === 'subscription' ? 'bg-oculo-900/50 text-oculo-300' :
            authMode === 'api-key' ? 'bg-emerald-900/50 text-emerald-300' :
            'bg-gray-800 text-gray-400'
          }`}>
            {authMode === 'subscription' ? 'Max' : authMode === 'api-key' ? 'API' : authMode}
          </span>
        )}

        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center bg-surface-dark-2 rounded-md p-0.5">
          <button onClick={() => setViewMode('chat')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'chat' ? 'bg-surface-dark-3 text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}>
            Chat
          </button>
          <button onClick={() => setViewMode('terminal')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'terminal' ? 'bg-surface-dark-3 text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}>
            Terminal
          </button>
        </div>

        {state.isStreaming && <span className="text-[10px] text-accent font-mono animate-pulse">streaming...</span>}
        {!state.isStreaming && state.lastUsage && (
          <span className="text-[10px] text-gray-500 font-mono">{formatTokens(state.lastUsage.inputTokens + state.lastUsage.outputTokens)}</span>
        )}

        <button onClick={state.handleClear} disabled={state.messages.length === 0 && !state.isStreaming}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-dark-2 disabled:opacity-30 text-gray-400 hover:text-gray-200 transition-colors" title="Clear">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>

        <button onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-dark-2 text-gray-400 hover:text-gray-200 transition-colors" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {viewMode === 'chat'
        ? <ChatView state={state} onAuthComplete={() => {
            api()?.getChatStatus().then(s => { if (s?.authMode) setAuthMode(s.authMode) })
          }} />
        : <TerminalView state={state} />}
    </div>
  )
}
