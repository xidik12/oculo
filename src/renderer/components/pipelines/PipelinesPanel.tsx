import React, { useState, useEffect } from 'react'
import { Macro, PatternSuggestion } from '../../../shared/types'

interface PipelinesPanelProps {
  isOpen: boolean
  onClose: () => void
  suggestions: PatternSuggestion[]
  onDismissSuggestion: (id: string) => void
  onSaveSuggestion: (suggestion: PatternSuggestion) => void
  onExecuteMacro: (id: string) => void
}

type TabFilter = 'all' | 'saved' | 'learned' | 'suggestions'

interface CachedWorkflow {
  id: string
  domain: string
  description: string
  steps: any[]
  successCount: number
  failCount: number
  lastUsed: number
  createdAt: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function PipelinesPanel({
  isOpen,
  onClose,
  suggestions,
  onDismissSuggestion,
  onSaveSuggestion,
  onExecuteMacro
}: PipelinesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [macros, setMacros] = useState<Macro[]>([])
  const [cached, setCached] = useState<CachedWorkflow[]>([])

  useEffect(() => {
    if (!isOpen) return
    loadData()
  }, [isOpen])

  async function loadData() {
    const api = (window as any).oculo
    if (!api) return
    const [macroList, cacheList] = await Promise.all([
      api.macroList?.() || [],
      api.runCacheList?.() || []
    ])
    setMacros(macroList || [])
    setCached(cacheList || [])
  }

  async function handleDeleteMacro(id: string) {
    const api = (window as any).oculo
    if (!api?.macroDelete) return
    await api.macroDelete(id)
    setMacros(prev => prev.filter(m => m.id !== id))
  }

  async function handleDeleteCached(id: string) {
    const api = (window as any).oculo
    if (!api?.runCacheDelete) return
    await api.runCacheDelete(id)
    setCached(prev => prev.filter(c => c.id !== id))
  }

  // Filter items by tab
  const showMacros = activeTab === 'all' || activeTab === 'saved'
  const showCached = activeTab === 'all' || activeTab === 'learned'
  const showSuggestions = activeTab === 'all' || activeTab === 'suggestions'

  const totalCount = macros.length + cached.length + suggestions.length

  if (!isOpen) return null

  return (
    <div className="absolute left-[var(--sidebar-expanded)] top-0 bottom-0 w-[320px] bg-white dark:bg-surface-dark-0 border-r border-surface-3 dark:border-surface-dark-3 z-40 flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center h-[48px] px-3 border-b border-surface-3 dark:border-surface-dark-3 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1">Pipelines</span>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500">
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 px-2 py-1.5 border-b border-surface-3 dark:border-surface-dark-3 flex-shrink-0">
        {(['all', 'saved', 'learned', 'suggestions'] as TabFilter[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-2.5 py-1 text-[11px] rounded-md font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-accent/15 text-accent'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-surface-2 dark:hover:bg-surface-dark-2'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-[140px] text-center px-4">
            <div className="text-sm text-gray-400 mb-1">No pipelines yet</div>
            <div className="text-[11px] text-gray-400/70">Use Claude to perform repeated actions on websites. Oculo will detect patterns and suggest saving them.</div>
          </div>
        ) : (
          <>
            {/* Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <SectionHeader title="Suggestions" count={suggestions.length} />
            )}
            {showSuggestions && suggestions.map(s => (
              <PipelineItem
                key={s.id}
                name={s.suggestedName}
                domain={s.domain}
                stepCount={s.sequenceLength}
                steps={s.steps}
                meta={`${s.occurrences}x detected`}
                kind="suggestion"
                onPlay={() => onSaveSuggestion(s)}
                onDelete={() => onDismissSuggestion(s.id)}
                playLabel="Save"
                deleteLabel="Dismiss"
              />
            ))}

            {/* Saved macros */}
            {showMacros && macros.length > 0 && (
              <SectionHeader title="Saved" count={macros.length} />
            )}
            {showMacros && macros.map(m => (
              <PipelineItem
                key={m.id}
                name={m.name}
                domain={m.description || ''}
                stepCount={m.steps.length}
                steps={m.steps}
                description={m.description}
                meta={m.shortcut || ''}
                kind="saved"
                onPlay={() => onExecuteMacro(m.id)}
                onDelete={() => handleDeleteMacro(m.id)}
              />
            ))}

            {/* Cached workflows */}
            {showCached && cached.length > 0 && (
              <SectionHeader title="Learned" count={cached.length} />
            )}
            {showCached && cached.map(c => (
              <PipelineItem
                key={c.id}
                name={c.description}
                domain={c.domain}
                stepCount={c.steps.length}
                steps={c.steps}
                description={c.description}
                meta={`${c.successCount}x success - ${formatTime(c.lastUsed)}`}
                extraMeta={`${c.successCount} success / ${c.failCount} fail`}
                kind="learned"
                onDelete={() => handleDeleteCached(c.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="px-2 py-1.5 mt-1 first:mt-0">
      <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {title} ({count})
      </span>
    </div>
  )
}

function describeStep(step: any): { icon: string; label: string; detail: string } {
  if (step.act) {
    const a = step.act
    const action = a.action || 'act'
    if (action === 'navigate') return { icon: '🌐', label: 'Navigate', detail: a.url || '' }
    if (action === 'click') return { icon: '👆', label: 'Click', detail: a.text || a.selector || a.ref || '' }
    if (action === 'type') return { icon: '⌨', label: 'Type', detail: `"${(a.text || '').slice(0, 40)}"` }
    if (action === 'scroll') return { icon: '↕', label: 'Scroll', detail: a.direction || '' }
    if (action === 'press') return { icon: '⏎', label: 'Press', detail: a.key || '' }
    if (action === 'screenshot') return { icon: '📸', label: 'Screenshot', detail: '' }
    if (action === 'hover') return { icon: '🎯', label: 'Hover', detail: a.text || a.selector || '' }
    if (action === 'select') return { icon: '☑', label: 'Select', detail: a.value || '' }
    if (action === 'upload') return { icon: '📎', label: 'Upload', detail: a.value || '' }
    if (action === 'download') return { icon: '⬇', label: 'Download', detail: a.url || '' }
    return { icon: '▶', label: action, detail: '' }
  }
  if (step.fill) return { icon: '📝', label: 'Fill form', detail: Object.keys(step.fill.fields || {}).join(', ') }
  if (step.page) return { icon: '👁', label: 'Read page', detail: step.page.scope || '' }
  if (step.read) return { icon: '📊', label: 'Extract', detail: step.read.what || '' }
  if (step.wait) return { icon: '⏳', label: 'Wait', detail: step.wait.text || step.wait.url || step.wait.selector || '' }
  if (step.if) return { icon: '🔀', label: 'Condition', detail: step.if.text || step.if.url || '' }
  return { icon: '•', label: 'Step', detail: '' }
}

function PipelineItem({
  name, domain, stepCount, steps, description, meta, extraMeta, kind, onPlay, onDelete,
  playLabel = 'Play', deleteLabel = 'Delete'
}: {
  name: string; domain: string; stepCount: number; steps?: any[]; description?: string; meta: string; extraMeta?: string
  kind: 'saved' | 'learned' | 'suggestion'
  onPlay?: () => void; onDelete?: () => void
  playLabel?: string; deleteLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)

  const kindColors = {
    saved: 'bg-blue-500/15 text-blue-400',
    learned: 'bg-green-500/15 text-green-400',
    suggestion: 'bg-amber-500/15 text-amber-400'
  }

  return (
    <div className={`rounded-md transition-colors ${expanded ? 'bg-surface-2 dark:bg-surface-dark-2' : 'hover:bg-surface-2 dark:hover:bg-surface-dark-2'}`}>
      {/* Header row — clickable */}
      <div className="group flex items-start gap-2 px-2 py-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className={`text-gray-500 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}>
              <path d="M2 1l4 3-4 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${kindColors[kind]}`}>
              {stepCount} steps
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 ml-[20px]">
            {domain && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{domain}</span>
            )}
            {meta && (
              <>
                {domain && <span className="text-[10px] text-gray-300 dark:text-gray-600">-</span>}
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{meta}</span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
          {onPlay && (
            <button
              onClick={(e) => { e.stopPropagation(); onPlay() }}
              className="text-[10px] px-2 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-medium"
              title={playLabel}
            >
              {playLabel}
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/15 transition-colors"
              title={deleteLabel}
            >
              {deleteLabel === 'Dismiss' ? 'Dismiss' : (
                <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-2 pb-2 ml-[20px]">
          {description && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">{description}</p>
          )}
          {extraMeta && (
            <p className="text-[10px] text-gray-500 dark:text-gray-600 mb-1.5">{extraMeta}</p>
          )}

          {/* Steps */}
          {steps && steps.length > 0 && (
            <div className="space-y-0.5">
              {steps.map((step, i) => {
                const s = describeStep(step)
                return (
                  <div key={i} className="flex items-start gap-1.5 py-0.5">
                    <span className="text-[10px] text-gray-600 dark:text-gray-500 w-3 text-right flex-shrink-0 font-mono">{i + 1}</span>
                    <span className="text-[10px] flex-shrink-0">{s.icon}</span>
                    <span className="text-[10px] font-medium text-gray-300 flex-shrink-0">{s.label}</span>
                    {s.detail && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-600 truncate">{s.detail}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
