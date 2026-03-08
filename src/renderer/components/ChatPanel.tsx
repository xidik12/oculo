import React, { useState, useRef, useEffect, useCallback, KeyboardEvent, DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { ChatMessage, ChatToolCall, ChatStreamEvent, TokenUsage, Card } from '../../shared/types'
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
    aiSetConfig(config: { providerId: string; enabled?: boolean; apiKey?: string; modelId?: string }): Promise<boolean>
    aiGetProviderStatus(providerId: string): Promise<{ providerId: string; connected: boolean; ready: boolean; error?: string; authMode?: string }>
    aiGetActive(): Promise<{ providerId: string; modelId: string }>
    authLogin(providerId: string): Promise<{ success: boolean; error?: string }>
    authStatus(): Promise<{ loggedIn?: boolean; authMode?: string }>
    ptySpawn(cols: number, rows: number): void
    ptyWrite(data: string): void
    ptyResize(cols: number, rows: number): void
    ptyKill(): void
    onPtyData(callback: (data: string) => void): () => void
    onPtyExit(callback: (exitCode: number, signal?: number) => void): () => void
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
  const [statuses, setStatuses] = useState<Record<string, { ready?: boolean; authMode?: string; error?: string }>>({})

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
                    {isReady && provider.id !== 'ollama' && authMode === 'subscription' && (
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

// ── Card Selector ───────────────────────────────────────────────────────────

function CardSelector() {
  const [open, setOpen] = useState(false)
  const [cards, setCards] = useState<Card[]>([])

  const loadCards = useCallback(async () => {
    const list = await (window as any).oculo?.cardList?.()
    if (list) setCards(list)
  }, [])

  useEffect(() => {
    if (open) loadCards()
  }, [open, loadCards])

  // Also load on mount to show active count
  useEffect(() => { loadCards() }, [loadCards])

  const handleToggle = async (id: string) => {
    await (window as any).oculo?.cardActivate?.(id)
    await loadCards()
  }

  const activeCount = cards.filter(c => c.isActive).length

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-white/5 transition-colors text-xs"
        title="AI Cards">
        {/* Sparkle / puzzle-piece icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={activeCount > 0 ? 'text-accent' : 'text-gray-500'}>
          <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
        </svg>
        {activeCount > 0 && (
          <span className="text-[9px] font-bold text-accent min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-accent/15">{activeCount}</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-[260px] bg-surface-dark-1 border border-surface-dark-3 rounded-lg shadow-xl z-50 py-1 max-h-[320px] overflow-y-auto">
            <div className="px-3 py-1.5 border-b border-surface-dark-3">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI Cards</span>
            </div>

            {cards.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-gray-500">No cards yet</p>
                <p className="text-[10px] text-gray-600 mt-1">Create cards in Settings &rarr; AI</p>
              </div>
            )}

            {cards.map(card => (
              <button key={card.id}
                onClick={() => handleToggle(card.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors group">
                {/* Card icon */}
                <span className="text-base flex-shrink-0 w-5 text-center">{card.icon || '🃏'}</span>
                {/* Card name */}
                <span className={`flex-1 text-xs truncate ${card.isActive ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                  {card.name}
                </span>
                {/* Active toggle indicator */}
                <span className={`flex-shrink-0 w-7 h-4 rounded-full relative transition-colors ${card.isActive ? 'bg-accent/30' : 'bg-surface-dark-3'}`}>
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${card.isActive ? 'left-3.5 bg-accent' : 'left-0.5 bg-gray-600'}`} />
                </span>
              </button>
            ))}

            {cards.length > 0 && (
              <div className="px-3 py-1.5 border-t border-surface-dark-3">
                <p className="text-[10px] text-gray-600">
                  {activeCount} of {cards.length} active
                  {cards.some(c => c.triggerDomains?.length) && ' · some auto-trigger by domain'}
                </p>
              </div>
            )}
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
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
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

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if ((!text && attachedFiles.length === 0) || isStreaming) return

    // Build message with file attachments
    let messageText = text
    const fileNames = attachedFiles.map(f => f.split('/').pop() || f)
    const oculo = (window as any).oculo

    if (attachedFiles.length > 0 && oculo) {
      const fileParts: string[] = []
      for (const filePath of attachedFiles) {
        const ext = filePath.split('.').pop()?.toLowerCase() || ''
        const name = filePath.split('/').pop() || filePath
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
        if (imageExts.includes(ext)) {
          fileParts.push(`[Attached image: ${name}]\nFile path: ${filePath}`)
        } else {
          // Try to read text content
          try {
            const content = await oculo.fileReadSafe(filePath)
            if (content && !content.startsWith('Error:')) {
              fileParts.push(`[Attached file: ${name}]\n${content}`)
            } else {
              fileParts.push(`[Attached file: ${name}]\nFile path: ${filePath}`)
            }
          } catch {
            fileParts.push(`[Attached file: ${name}]\nFile path: ${filePath}`)
          }
        }
      }
      messageText = fileParts.join('\n\n') + (text ? '\n\n' + text : '')
    }

    // Show just the text + file names in the chat bubble (not full content)
    const displayContent = attachedFiles.length > 0
      ? (fileNames.map(f => `📎 ${f}`).join('\n') + (text ? '\n' + text : ''))
      : text

    const userMessage: ChatMessage = { id: `msg-${Date.now()}-user`, role: 'user', content: displayContent, timestamp: Date.now() }
    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setAttachedFiles([])
    setIsStreaming(true)
    setError(null)
    setStreamingText('')
    setStreamingToolCalls([])
    api()?.sendChatMessage(messageText)
  }, [inputValue, isStreaming, attachedFiles])

  const handleAttach = useCallback(async () => {
    const oculo = (window as any).oculo
    if (!oculo?.fileDialogOpen) return
    const filePaths = await oculo.fileDialogOpen()
    if (filePaths && filePaths.length > 0) {
      setAttachedFiles(prev => [...prev, ...filePaths])
    }
  }, [])

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleFileDrop = useCallback((filePaths: string[]) => {
    if (filePaths.length > 0) {
      setAttachedFiles(prev => [...prev, ...filePaths])
    }
  }, [])

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
    setAttachedFiles([])
  }, [])

  const handleStop = useCallback(() => {
    api()?.abortChat()
    // Commit whatever was streamed so far as a partial message
    const partialText = streamingText
    const partialToolCalls = toolCallsRef.current
    if (partialText || partialToolCalls.length > 0) {
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-assistant-stopped`,
        role: 'assistant' as const,
        content: partialText || '(stopped)',
        toolCalls: partialToolCalls.length > 0 ? partialToolCalls : undefined,
        timestamp: Date.now()
      }])
    }
    setStreamingText('')
    setStreamingToolCalls([])
    toolCallsRef.current = []
    setIsStreaming(false)
  }, [streamingText])

  return {
    messages, streamingText, streamingToolCalls, isStreaming, error,
    inputValue, setInputValue, activeProvider, activeModel, lastUsage,
    attachedFiles, handleAttach, handleRemoveFile, handleFileDrop,
    handleProviderSelect, handleSend, handleClear, handleStop
  }
}

// ── Chat Input ──────────────────────────────────────────────────────────────

function ChatInput({ value, onChange, onKeyDown, onSend, onStop, isStreaming, inputRef, placeholder, attachedFiles, onAttach, onRemoveFile, imagePreviews }: {
  value: string; onChange: (val: string) => void; onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void; onStop: () => void; isStreaming: boolean; inputRef: React.RefObject<HTMLTextAreaElement | null>
  placeholder?: string; attachedFiles: string[]; onAttach: () => void; onRemoveFile: (index: number) => void
  imagePreviews?: Record<string, string>
}) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  // Voice input (v0.3.0)
  const [isRecording, setIsRecording] = useState(false)
  const recognitionRef = useRef<any>(null)

  const toggleVoice = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript || ''
      if (transcript) onChange(value + (value ? ' ' : '') + transcript)
      setIsRecording(false)
    }
    recognition.onerror = () => setIsRecording(false)
    recognition.onend = () => setIsRecording(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsRecording(true)
    } catch {
      setIsRecording(false)
    }
  }, [isRecording, value, onChange])

  const getFileName = (filePath: string) => filePath.split('/').pop() || filePath
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
  const isImageFile = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    return IMAGE_EXTS.includes(ext)
  }

  return (
    <div className="flex-shrink-0 border-t border-surface-dark-3 p-2">
      {attachedFiles.length > 0 && (
        <div className="px-1 mb-2 space-y-1.5">
          {/* Image previews (only for files with a preview URL from drag-and-drop) */}
          {attachedFiles.some(f => isImageFile(f) && imagePreviews?.[f]) && (
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((f, i) => isImageFile(f) && imagePreviews?.[f] ? (
                <div key={`img-${i}`} className="relative group">
                  <img src={imagePreviews[f]} alt={getFileName(f)}
                    className="w-16 h-16 object-cover rounded-md border border-accent/20" />
                  <button onClick={() => onRemoveFile(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surface-dark-1 border border-surface-dark-3 flex items-center justify-center text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">
                    <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 rounded-b-md px-1 py-0.5 text-[8px] text-gray-300 truncate">{getFileName(f)}</div>
                </div>
              ) : null)}
            </div>
          )}
          {/* Image files without preview (added via file dialog) show as chips with image icon */}
          {attachedFiles.some(f => isImageFile(f) && !imagePreviews?.[f]) && (
            <div className="flex flex-wrap gap-1.5">
              {attachedFiles.map((f, i) => isImageFile(f) && !imagePreviews?.[f] ? (
                <span key={`imgchip-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px] font-mono">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                  {getFileName(f)}
                  <button onClick={() => onRemoveFile(i)} className="ml-0.5 text-gray-500 hover:text-red-400 transition-colors" title="Remove">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                  </button>
                </span>
              ) : null)}
            </div>
          )}
          {/* Non-image file chips */}
          <div className="flex flex-wrap gap-1.5">
            {attachedFiles.map((f, i) => !isImageFile(f) && (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent text-[11px] font-mono">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
                {getFileName(f)}
                <button onClick={() => onRemoveFile(i)} className="ml-0.5 text-gray-500 hover:text-red-400 transition-colors" title="Remove">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        <button onClick={onAttach} disabled={isStreaming}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 text-gray-500 hover:text-gray-300 disabled:opacity-30 transition-colors" title="Attach file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea ref={inputRef as any} value={value} onChange={handleChange} onKeyDown={onKeyDown}
          placeholder={placeholder || (isStreaming ? 'Wait for response...' : 'Message... (Enter to send)')}
          disabled={isStreaming} rows={1}
          className="flex-1 resize-none px-3 py-2 rounded-md bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-sm font-mono placeholder-gray-600 outline-none focus:border-accent/50 transition-colors disabled:opacity-50"
          style={{ maxHeight: '120px' }} />
        {/* Voice input button (v0.3.0) */}
        <button onClick={toggleVoice} disabled={isStreaming}
          className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors ${isRecording ? 'bg-red-500/20 border border-red-500/40 text-red-400 animate-pulse' : 'hover:bg-white/5 text-gray-500 hover:text-gray-300 disabled:opacity-30'}`}
          title={isRecording ? 'Stop recording' : 'Voice input'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        {isStreaming ? (
          <button onClick={onStop}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 text-red-400 transition-colors" title="Stop">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="2" /></svg>
          </button>
        ) : (
          <button onClick={onSend} disabled={!value.trim() && attachedFiles.length === 0}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-accent/80 hover:bg-accent disabled:opacity-30 disabled:hover:bg-accent/80 text-white transition-colors" title="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
      <p className="text-[10px] text-gray-600 mt-1.5 px-1">Shift+Enter for new line · Drag & drop or paperclip to attach files</p>
    </div>
  )
}

// ── Chat View (bubbles) ─────────────────────────────────────────────────────

function handleLinkClick(href: string) {
  const oculo = (window as any).oculo
  if (!oculo) return
  const isFilePath = href.startsWith('/') || href.startsWith('~/')
  if (isFilePath) {
    oculo.openFile(href)
  } else if (href.startsWith('http://') || href.startsWith('https://')) {
    oculo.openExternal(href)
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Extended regex: markdown formatting + markdown links + bare file paths (absolute paths with common extensions)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|((?:\/[\w.@\-]+)+\/[\w.@\-]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|pdf|mp4|webm|mov|txt|html|json|csv|md|xml|zip|tar|gz)))/gi
  let lastIndex = 0; let match: RegExpExecArray | null; let partIdx = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(<span key={`${keyPrefix}-t${partIdx++}`}>{text.slice(lastIndex, match.index)}</span>)
    if (match[2]) nodes.push(<strong key={`${keyPrefix}-b${partIdx++}`} className="font-semibold text-gray-100">{match[2]}</strong>)
    else if (match[3]) nodes.push(<em key={`${keyPrefix}-i${partIdx++}`} className="italic text-gray-200">{match[3]}</em>)
    else if (match[4]) nodes.push(<code key={`${keyPrefix}-c${partIdx++}`} className="px-1 py-0.5 rounded bg-surface-dark-2 text-oculo-300 font-mono text-[0.85em]">{match[4]}</code>)
    else if (match[5] && match[6]) {
      const href = match[6]
      nodes.push(<a key={`${keyPrefix}-a${partIdx++}`} className="text-accent hover:underline cursor-pointer" title={href} onClick={() => handleLinkClick(href)}>{match[5]}</a>)
    }
    else if (match[7]) {
      const filePath = match[7]
      nodes.push(<a key={`${keyPrefix}-f${partIdx++}`} className="text-accent hover:underline cursor-pointer font-mono text-[0.9em]" title={`Open ${filePath}`} onClick={() => handleLinkClick(filePath)}>{filePath}</a>)
    }
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
            {String(runningCall.input?.action ?? runningCall.input?.what ?? '')}
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
  const [statuses, setStatuses] = useState<Record<string, { ready?: boolean }>>({})

  useEffect(() => {
    // Check which providers are ready
    ;['claude', 'codex'].forEach(async (id) => {
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
  const codexReady = statuses['codex']?.ready
  const anyReady = claudeReady || codexReady

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
          Sign in with your ChatGPT or Claude subscription to get started.
        </p>
      </div>

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
            onClick={() => handleLogin('codex')}
            disabled={loading !== null}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15 hover:border-emerald-500/30 transition-colors text-left disabled:opacity-50 disabled:cursor-wait">
            <div className="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-400 text-sm font-bold">G</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-200">Sign in with Codex</div>
              <div className="text-[10px] text-gray-500">ChatGPT Plus / Pro subscription</div>
            </div>
            {loading === 'codex' && <span className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          </button>
        </div>

      <div className="flex items-center gap-2 w-full max-w-[280px]">
          <div className="flex-1 border-t border-surface-dark-3" />
          <span className="text-[10px] text-gray-600">or</span>
          <div className="flex-1 border-t border-surface-dark-3" />
        </div>

      <p className="text-[10px] text-gray-600 max-w-[280px]">
        Add an API key in <span className="text-gray-400">Settings &gt; AI Providers</span> for direct access.
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
  const { messages, streamingText, streamingToolCalls, isStreaming, error, inputValue, setInputValue, handleSend, handleStop, lastUsage, attachedFiles, handleAttach, handleRemoveFile, handleFileDrop } = state
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({})

  // Check if any provider is authenticated
  useEffect(() => {
    let cancelled = false
    async function check() {
      const statuses = await Promise.all(
        ['claude', 'anthropic', 'codex', 'openai', 'gemini', 'grok'].map(id => api()?.aiGetProviderStatus(id))
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

  // Drag-and-drop handlers
  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsDragging(true)
    }
  }, [])

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const paths: string[] = []
      const newPreviews: Record<string, string> = {}
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        // Electron provides the full path via file.path
        const filePath = (file as any).path as string | undefined
        if (filePath) {
          paths.push(filePath)
          // Create object URL preview for image files
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          if (imageExts.includes(ext)) {
            newPreviews[filePath] = URL.createObjectURL(file)
          }
        }
      }
      if (paths.length > 0) {
        handleFileDrop(paths)
        if (Object.keys(newPreviews).length > 0) {
          setImagePreviews(prev => ({ ...prev, ...newPreviews }))
        }
      }
    }
  }, [handleFileDrop])

  // Cleanup object URLs when files are removed or chat is cleared
  useEffect(() => {
    const currentPaths = new Set(attachedFiles)
    setImagePreviews(prev => {
      const next: Record<string, string> = {}
      let changed = false
      for (const [path, url] of Object.entries(prev)) {
        if (currentPaths.has(path)) {
          next[path] = url
        } else {
          URL.revokeObjectURL(url)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [attachedFiles])

  // Show auth screen if no provider is ready and no messages yet
  if (authChecked && needsAuth && messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <AuthWelcome onLogin={() => { setNeedsAuth(false); onAuthComplete?.() }} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative"
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-dark-0/80 backdrop-blur-sm border-2 border-dashed border-accent/50 rounded-lg m-2 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-sm font-medium text-accent">Drop files here</span>
            <span className="text-[10px] text-gray-500">Files will be attached to your message</span>
          </div>
        </div>
      )}
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
      <ChatInput value={inputValue} onChange={setInputValue} onKeyDown={handleKeyDown} onSend={handleSend} onStop={handleStop} isStreaming={isStreaming} inputRef={inputRef}
        attachedFiles={attachedFiles} onAttach={handleAttach} onRemoveFile={handleRemoveFile} imagePreviews={imagePreviews} />
    </div>
  )
}

// ── Terminal View (real xterm.js + node-pty) ────────────────────────────────

function TerminalView({ isVisible }: { isVisible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [exited, setExited] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const onTermDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer?.types?.includes('Files')) setIsDragging(true)
  }, [])
  const onTermDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
  }, [])
  const onTermDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])
  const onTermDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const filePath = (files[i] as any).path as string | undefined
        if (filePath) paths.push(filePath)
      }
      if (paths.length > 0) {
        const escaped = paths.map(p => p.includes(' ') ? `'${p.replace(/'/g, "'\\''")}'` : p).join(' ')
        api()?.ptyWrite(escaped)
      }
    }
  }, [])

  useEffect(() => {
    const oculo = api()
    if (!oculo || !containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      fontSize: 13,
      fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)

    // Fit after a frame so the container has layout dimensions
    requestAnimationFrame(() => {
      fitAddon.fit()
      oculo.ptySpawn(term.cols, term.rows)
    })

    // Keystrokes → PTY
    const dataDisposable = term.onData((data) => oculo.ptyWrite(data))

    // PTY output → screen
    const cleanupData = oculo.onPtyData((data) => term.write(data))

    // PTY exit
    const cleanupExit = oculo.onPtyExit((exitCode) => {
      term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}. Press any key to restart.]\x1b[0m\r\n`)
      setExited(true)
    })

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        oculo.ptyResize(term.cols, term.rows)
      } catch { /* ignore */ }
    })
    if (containerRef.current) observer.observe(containerRef.current)

    termRef.current = term
    fitRef.current = fitAddon

    return () => {
      observer.disconnect()
      dataDisposable.dispose()
      cleanupData()
      cleanupExit()
      oculo.ptyKill()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // Re-fit and focus when tab becomes visible
  useEffect(() => {
    if (isVisible && termRef.current && fitRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit()
        termRef.current?.focus()
        const oculo = api()
        if (oculo && termRef.current) {
          oculo.ptyResize(termRef.current.cols, termRef.current.rows)
        }
      })
    }
  }, [isVisible])

  // Restart on keypress after exit
  useEffect(() => {
    if (!exited || !termRef.current) return
    const disposable = termRef.current.onData(() => {
      setExited(false)
      const oculo = api()
      if (oculo && termRef.current) {
        termRef.current.clear()
        oculo.ptySpawn(termRef.current.cols, termRef.current.rows)
      }
    })
    return () => disposable.dispose()
  }, [exited])

  return (
    <div className="flex-1 min-h-0 relative" onDragEnter={onTermDragEnter} onDragOver={onTermDragOver} onDragLeave={onTermDragLeave} onDrop={onTermDrop}>
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0d1117]/80 backdrop-blur-sm border-2 border-dashed border-accent/50 rounded-lg m-1 pointer-events-none">
          <div className="flex flex-col items-center gap-1.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
            <span className="text-xs font-medium text-accent">Drop to paste path</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" style={{ padding: '4px 0 0 4px' }} />
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

        {authMode && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
            authMode === 'subscription' ? 'bg-oculo-900/50 text-oculo-300' :
            authMode === 'api-key' ? 'bg-emerald-900/50 text-emerald-300' :
            'bg-gray-800 text-gray-400'
          }`}>
            {authMode === 'subscription' ? 'Max' : authMode === 'api-key' ? 'API' : authMode}
          </span>
        )}

        <CardSelector />

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

      {/* Body — both views mounted, toggle visibility with CSS to preserve state */}
      <div className={viewMode === 'chat' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
        <ChatView state={state} onAuthComplete={() => {
          api()?.getChatStatus().then(s => { if (s?.authMode) setAuthMode(s.authMode) })
        }} />
      </div>
      <div className={viewMode === 'terminal' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
        <TerminalView isVisible={viewMode === 'terminal'} />
      </div>
    </div>
  )
}
