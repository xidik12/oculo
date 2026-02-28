import React, { useState, useEffect, useCallback } from 'react'
import { AI_PROVIDERS, AIProviderId } from '../../shared/ai-types'
import { AppSettings, Container, Card } from '../../shared/types'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

function api() {
  return (window as any).oculo as {
    getSettings(): Promise<AppSettings>
    saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>
    aiSetConfig(config: any): Promise<boolean>
    aiGetProviderStatus(providerId: string): Promise<{ providerId: string; connected: boolean; ready: boolean; error?: string; authMode?: string }>
    mcpClientList(): Promise<any[]>
    mcpClientAdd(config: any): Promise<boolean>
    mcpClientRemove(serverId: string): Promise<boolean>
    mcpClientToggle(serverId: string, enabled: boolean): Promise<boolean>
    mcpClientStatus(): Promise<any[]>
    mcpClientTools(): Promise<any[]>
    containerList(): Promise<Container[]>
    containerCreate(name: string, color: string, icon: string): Promise<Container>
    containerDelete(id: string): Promise<boolean>
    cardList(): Promise<Card[]>
    cardActivate(id: string): Promise<Card>
    cardDelete(id: string): Promise<boolean>
  } | undefined
}

type SettingsTab = 'general' | 'ai' | 'media' | 'privacy' | 'apps' | 'performance' | 'support'

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('ai')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [statuses, setStatuses] = useState<Record<string, { ready?: boolean; authMode?: string }>>({})
  const [saved, setSaved] = useState<string | null>(null)

  // Load settings on open
  useEffect(() => {
    if (!isOpen) return
    api()?.getSettings().then(s => setSettings(s))
    refreshStatuses()
  }, [isOpen])

  const refreshStatuses = useCallback(() => {
    AI_PROVIDERS.forEach(async (p) => {
      const status = await api()?.aiGetProviderStatus(p.id)
      if (status) setStatuses(prev => ({ ...prev, [p.id]: status }))
    })
  }, [])

  const handleSaveSetting = useCallback(async (key: string, value: any) => {
    const updated = await api()?.saveSettings({ [key]: value })
    if (updated) setSettings(updated)
    flash('Saved')
  }, [])

  const handleSaveApiKey = useCallback(async (providerId: string) => {
    const id = providerId as AIProviderId
    const key = apiKeys[id]?.trim()
    if (!key) return
    await api()?.aiSetConfig({ providerId: id, enabled: true, apiKey: key })
    setApiKeys(prev => ({ ...prev, [id]: '' }))
    refreshStatuses()
    flash(`${id} API key saved`)
  }, [apiKeys, refreshStatuses])

  const handleRemoveApiKey = useCallback(async (providerId: string) => {
    const id = providerId as AIProviderId
    await api()?.aiSetConfig({ providerId: id, enabled: false, apiKey: '' })
    refreshStatuses()
    flash(`${id} API key removed`)
  }, [refreshStatuses])

  function flash(msg: string) {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2000)
  }

  if (!isOpen) return null

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI Providers' },
    { id: 'apps', label: 'Connected Apps' },
    { id: 'media', label: 'Media' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'performance', label: 'Performance' },
    { id: 'support', label: 'Support' },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 top-0 bottom-0 z-[61] flex items-center justify-center p-8">
        <div className="w-full max-w-[640px] max-h-full bg-surface-dark-0 border border-surface-dark-3 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center h-12 px-4 border-b border-surface-dark-3 flex-shrink-0">
            <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
            <div className="flex-1" />
            {saved && <span className="text-xs text-emerald-400 mr-3">{saved}</span>}
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-dark-2 text-gray-400 hover:text-gray-200 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-surface-dark-3 px-4">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#373a40 transparent' }}>
            {tab === 'general' && settings && (
              <GeneralSettings settings={settings} onSave={handleSaveSetting} flash={flash} />
            )}
            {tab === 'ai' && (
              <AISettings
                apiKeys={apiKeys}
                setApiKeys={setApiKeys}
                statuses={statuses}
                onSaveKey={handleSaveApiKey}
                onRemoveKey={handleRemoveApiKey}
                flash={flash}
              />
            )}
            {tab === 'apps' && (
              <ConnectedAppsSettings flash={flash} />
            )}
            {tab === 'media' && (
              <MediaSettings
                apiKeys={apiKeys}
                setApiKeys={setApiKeys}
                onSaveKey={handleSaveApiKey}
                onRemoveKey={handleRemoveApiKey}
                statuses={statuses}
              />
            )}
            {tab === 'privacy' && settings && (
              <PrivacySettings settings={settings} onSave={handleSaveSetting} />
            )}
            {tab === 'performance' && settings && (
              <PerformanceSettings settings={settings} onSave={handleSaveSetting} />
            )}
            {tab === 'support' && (
              <SupportSettings />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── General ─────────────────────────────────────────────────────────────────

function GeneralSettings({ settings, onSave, flash }: { settings: AppSettings; onSave: (key: string, value: any) => void; flash: (msg: string) => void }) {
  const [containers, setContainers] = useState<Container[]>([])
  const [showAddContainer, setShowAddContainer] = useState(false)
  const [newContainerName, setNewContainerName] = useState('')
  const [newContainerColor, setNewContainerColor] = useState('#3b82f6')
  const [newContainerIcon, setNewContainerIcon] = useState('box')

  const CONTAINER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316']
  const CONTAINER_ICONS = [
    { id: 'box', label: 'Box' },
    { id: 'briefcase', label: 'Work' },
    { id: 'user', label: 'Personal' },
    { id: 'shopping', label: 'Shopping' },
    { id: 'bank', label: 'Banking' },
  ]

  const refreshContainers = useCallback(async () => {
    const list = await api()?.containerList() || []
    setContainers(list)
  }, [])

  useEffect(() => { refreshContainers() }, [refreshContainers])

  const handleAddContainer = async () => {
    if (!newContainerName.trim()) return
    await api()?.containerCreate(newContainerName.trim(), newContainerColor, newContainerIcon)
    setNewContainerName('')
    setNewContainerColor('#3b82f6')
    setNewContainerIcon('box')
    setShowAddContainer(false)
    flash('Container created')
    refreshContainers()
  }

  const handleDeleteContainer = async (id: string) => {
    await api()?.containerDelete(id)
    flash('Container deleted')
    refreshContainers()
  }

  return (
    <>
      <SettingRow label="Theme" description="Controls the app's appearance">
        <select value={settings.theme} onChange={e => onSave('theme', e.target.value)}
          className="h-8 px-2 rounded bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50">
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingRow>

      <SettingRow label="Home Page" description="URL opened when creating a new tab">
        <input type="text" value={settings.homePage}
          onChange={e => onSave('homePage', e.target.value)}
          className="h-8 w-64 px-2 rounded bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs font-mono outline-none focus:border-accent/50" />
      </SettingRow>

      <SettingRow label="Search Engine" description="Search URL with {query} placeholder">
        <input type="text" value={settings.searchEngine}
          onChange={e => onSave('searchEngine', e.target.value)}
          className="h-8 w-64 px-2 rounded bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs font-mono outline-none focus:border-accent/50" />
      </SettingRow>

      {/* Containers */}
      <div className="mt-4 pt-4 border-t border-surface-dark-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm text-gray-200">Containers</div>
            <div className="text-[11px] text-gray-500">Isolate browsing sessions with separate cookies and storage</div>
          </div>
          <button onClick={() => setShowAddContainer(true)}
            className="h-7 px-2.5 text-[11px] font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors">
            + Add
          </button>
        </div>

        {containers.length === 0 && !showAddContainer && (
          <p className="text-xs text-gray-600 py-2">No containers yet. Add one to isolate browsing sessions.</p>
        )}

        <div className="space-y-2">
          {containers.map(c => (
            <div key={c.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
              <span className="text-xs text-gray-200 font-medium flex-1">{c.name}</span>
              <span className="text-[10px] text-gray-600 font-mono">{c.partition}</span>
              <button onClick={() => handleDeleteContainer(c.id)}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors p-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>

        {showAddContainer && (
          <div className="mt-2 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 space-y-2">
            <input value={newContainerName} onChange={e => setNewContainerName(e.target.value)} placeholder="Container name"
              className="w-full h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50 placeholder-gray-600" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-10">Color</span>
              <div className="flex gap-1.5">
                {CONTAINER_COLORS.map(color => (
                  <button key={color} onClick={() => setNewContainerColor(color)}
                    className={`w-5 h-5 rounded-full transition-all ${newContainerColor === color ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-dark-1' : ''}`}
                    style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-10">Icon</span>
              <select value={newContainerIcon} onChange={e => setNewContainerIcon(e.target.value)}
                className="h-7 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-[11px] outline-none">
                {CONTAINER_ICONS.map(ic => (
                  <option key={ic.id} value={ic.id}>{ic.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddContainer(false)}
                className="h-7 px-2.5 text-[11px] text-gray-500 rounded hover:text-gray-300 transition-colors">Cancel</button>
              <button onClick={handleAddContainer} disabled={!newContainerName.trim()}
                className="h-7 px-2.5 text-[11px] font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 disabled:opacity-30 transition-colors">Create</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── AI Providers ────────────────────────────────────────────────────────────

function AISettings({ apiKeys, setApiKeys, statuses, onSaveKey, onRemoveKey, flash }: {
  apiKeys: Record<string, string>
  setApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>
  statuses: Record<string, { ready?: boolean; authMode?: string }>
  onSaveKey: (providerId: AIProviderId) => void
  onRemoveKey: (providerId: AIProviderId) => void
  flash: (msg: string) => void
}) {
  const [cards, setCards] = useState<Card[]>([])

  const refreshCards = useCallback(async () => {
    const list = await api()?.cardList() || []
    setCards(list)
  }, [])

  useEffect(() => { refreshCards() }, [refreshCards])

  const handleToggleCard = async (id: string) => {
    await api()?.cardActivate(id)
    flash('Card updated')
    refreshCards()
  }

  const handleDeleteCard = async (id: string) => {
    await api()?.cardDelete(id)
    flash('Card deleted')
    refreshCards()
  }

  return (
    <>
      <p className="text-xs text-gray-500 mb-3">
        Configure API keys for AI providers. Keys are stored securely and never leave your device.
      </p>

      {AI_PROVIDERS.map(provider => {
        const status = statuses[provider.id]
        const isReady = status?.ready
        const authMode = status?.authMode

        return (
          <div key={provider.id} className="p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-200">{provider.name}</span>
              {isReady && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  authMode === 'api-key'
                    ? 'bg-emerald-900/50 text-emerald-300'
                    : 'bg-oculo-900/50 text-oculo-300'
                }`}>
                  {authMode === 'api-key' ? 'API Key' : (__ENABLE_OAUTH__ ? 'CLI Subscription' : 'Active')}
                </span>
              )}
              {isReady && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-auto" />}
              {!isReady && <span className="w-1.5 h-1.5 rounded-full bg-gray-600 ml-auto" />}
            </div>

            <p className="text-[11px] text-gray-500 mb-2">{provider.description}</p>

            {__ENABLE_OAUTH__ && provider.id === 'claude' && authMode === 'subscription' && isReady && (
              <p className="text-[11px] text-oculo-400 mb-2">
                Using Claude CLI subscription. Add an API key below for instant responses.
              </p>
            )}

            {__ENABLE_OAUTH__ && provider.id === 'openai' && authMode === 'subscription' && isReady && (
              <p className="text-[11px] text-oculo-400 mb-2">
                Using Codex CLI subscription (ChatGPT Plus/Pro). Add an API key below for direct API access.
              </p>
            )}

            {__ENABLE_OAUTH__ && provider.id === 'openai' && !isReady && (
              <p className="text-[11px] text-gray-500 mb-2">
                Run <code className="px-1 py-0.5 bg-surface-dark-2 rounded text-[10px] font-mono text-gray-400">codex auth</code> in terminal to use your ChatGPT subscription, or paste an API key below.
              </p>
            )}

            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKeys[provider.id] || ''}
                onChange={e => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                placeholder={isReady && authMode === 'api-key' ? '••••••••••••••••' : 'Paste API key...'}
                className="flex-1 h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs font-mono outline-none focus:border-accent/50 placeholder-gray-600"
                onKeyDown={e => { if (e.key === 'Enter') onSaveKey(provider.id) }}
              />
              <button
                onClick={() => onSaveKey(provider.id)}
                disabled={!apiKeys[provider.id]?.trim()}
                className="h-8 px-3 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 disabled:opacity-30 disabled:hover:bg-accent/10 transition-colors">
                Save
              </button>
              {isReady && authMode === 'api-key' && (
                <button
                  onClick={() => onRemoveKey(provider.id)}
                  className="h-8 px-2 text-xs text-red-400 rounded hover:bg-red-900/20 transition-colors">
                  Remove
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {provider.models.map(m => (
                <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-dark-2 text-gray-500">
                  {m.name}
                </span>
              ))}
            </div>
          </div>
        )
      })}

      {/* AI Cards / Skills */}
      <div className="mt-4 pt-4 border-t border-surface-dark-3">
        <div className="mb-3">
          <div className="text-sm text-gray-200">AI Cards</div>
          <div className="text-[11px] text-gray-500">Custom AI personas with system instructions and domain triggers</div>
        </div>

        {cards.length === 0 && (
          <p className="text-xs text-gray-600 py-2">No AI cards configured. Cards can be created from the AI chat panel.</p>
        )}

        <div className="space-y-2">
          {cards.map(card => (
            <div key={card.id} className="p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">{card.icon || '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-200">{card.name}</span>
                    {card.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 font-medium">Active</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 truncate mt-0.5">
                    {card.systemInstruction.length > 80
                      ? card.systemInstruction.slice(0, 80) + '...'
                      : card.systemInstruction}
                  </p>
                  {card.triggerDomains && card.triggerDomains.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {card.triggerDomains.map(d => (
                        <span key={d} className="text-[9px] px-1 py-0.5 rounded bg-surface-dark-2 text-gray-500 font-mono">{d}</span>
                      ))}
                    </div>
                  )}
                </div>
                <Toggle checked={card.isActive} onChange={() => handleToggleCard(card.id)} />
                <button onClick={() => handleDeleteCard(card.id)}
                  className="text-xs text-gray-600 hover:text-red-400 transition-colors p-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Media Generation ────────────────────────────────────────────────────────

const MEDIA_PROVIDERS = [
  { id: 'stability' as const, name: 'Stability AI', desc: 'Stable Diffusion 3 image generation. Requires separate API key.', placeholder: 'sk-...' },
]

function MediaSettings({ apiKeys, setApiKeys, onSaveKey, onRemoveKey, statuses }: {
  apiKeys: Record<string, string>
  setApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onSaveKey: (providerId: string) => void | Promise<void>
  onRemoveKey: (providerId: string) => void | Promise<void>
  statuses: Record<string, { ready?: boolean }>
}) {
  return (
    <>
      <p className="text-xs text-gray-500 mb-3">
        Configure media generation providers. Gemini and OpenAI keys from AI Providers are reused automatically for image generation.
      </p>

      <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-800/30 mb-4">
        <p className="text-[11px] text-emerald-300 font-medium mb-1">Auto-detected keys</p>
        <p className="text-[11px] text-gray-400">
          Your <strong className="text-gray-300">Gemini</strong> key powers <strong className="text-gray-300">Nano Banana 2</strong> (images) and <strong className="text-gray-300">Veo 3.1</strong> (videos). Your <strong className="text-gray-300">OpenAI</strong> key powers <strong className="text-gray-300">DALL-E 3</strong>. Both are auto-detected from AI Providers.
        </p>
      </div>

      {MEDIA_PROVIDERS.map(provider => {
        const status = statuses[provider.id]
        const isReady = status?.ready

        return (
          <div key={provider.id} className="p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-200">{provider.name}</span>
              {isReady && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-auto" />}
            </div>
            <p className="text-[11px] text-gray-500 mb-2">{provider.desc}</p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKeys[provider.id] || ''}
                onChange={e => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                placeholder={provider.placeholder}
                className="flex-1 h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs font-mono outline-none focus:border-accent/50 placeholder-gray-600"
                onKeyDown={e => { if (e.key === 'Enter') onSaveKey(provider.id) }}
              />
              <button
                onClick={() => onSaveKey(provider.id)}
                disabled={!apiKeys[provider.id]?.trim()}
                className="h-8 px-3 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 disabled:opacity-30 disabled:hover:bg-accent/10 transition-colors">
                Save
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

// ── Connected Apps (MCP Client) ──────────────────────────────────────────────

const PRE_CONFIGURED_APPS = [
  { id: 'gmail', name: 'Gmail', icon: '📧', transport: 'stdio' as const, command: 'npx -y @anthropic/gmail-mcp-server', description: 'Read, search, and send emails via Gmail API' },
  { id: 'calendar', name: 'Google Calendar', icon: '📅', transport: 'stdio' as const, command: 'npx -y @anthropic/google-calendar-mcp-server', description: 'Create, update, and list calendar events' },
  { id: 'notion', name: 'Notion', icon: '📝', transport: 'stdio' as const, command: 'npx -y @anthropic/notion-mcp-server', description: 'Read and edit Notion pages and databases' },
  { id: 'slack', name: 'Slack', icon: '💬', transport: 'stdio' as const, command: 'npx -y @anthropic/slack-mcp-server', description: 'Send messages and interact with Slack channels' },
]

interface McpServerStatus { id: string; status: 'connected' | 'disconnected' | 'error' | 'connecting'; toolCount?: number; error?: string }

function ConnectedAppsSettings({ flash }: { flash: (msg: string) => void }) {
  const [configs, setConfigs] = useState<import('../../shared/types').McpClientConfig[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newTransport, setNewTransport] = useState<'stdio' | 'sse'>('stdio')
  const [newUrl, setNewUrl] = useState('')

  const refresh = useCallback(async () => {
    const cfgs = await api()?.mcpClientList() || []
    setConfigs(cfgs)
    const sts = await api()?.mcpClientStatus() || []
    setStatuses(sts)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleToggle = async (serverId: string, enabled: boolean) => {
    await api()?.mcpClientToggle(serverId, enabled)
    flash(enabled ? 'Connecting...' : 'Disconnected')
    // Refresh status after a short delay for connection to complete
    setTimeout(refresh, enabled ? 2000 : 500)
  }

  const handleAddPreConfigured = async (app: typeof PRE_CONFIGURED_APPS[0]) => {
    const existing = configs.find(c => c.id === app.id)
    if (existing) {
      flash(`${app.name} already added`)
      return
    }
    await api()?.mcpClientAdd({
      id: app.id,
      name: app.name,
      icon: app.icon,
      transport: app.transport,
      command: app.command,
      enabled: false
    })
    flash(`${app.name} added — toggle to connect`)
    refresh()
  }

  const handleAddCustom = async () => {
    if (!newName.trim()) return
    const id = newName.toLowerCase().replace(/[^a-z0-9]/g, '-')
    await api()?.mcpClientAdd({
      id,
      name: newName.trim(),
      transport: newTransport,
      ...(newTransport === 'stdio' ? { command: newCommand } : { url: newUrl }),
      enabled: false
    })
    setNewName('')
    setNewCommand('')
    setNewUrl('')
    setShowAddForm(false)
    flash('Custom server added')
    refresh()
  }

  const handleRemove = async (serverId: string) => {
    await api()?.mcpClientRemove(serverId)
    flash('Server removed')
    refresh()
  }

  const getStatus = (id: string): McpServerStatus | undefined => statuses.find(s => s.id === id)

  return (
    <>
      <p className="text-xs text-gray-500 mb-3">
        Connect external MCP servers to extend Oculo's AI with Gmail, Calendar, Notion, and more. Tools become available in the AI chat panel.
      </p>

      {/* Pre-configured apps */}
      <div className="space-y-2 mb-4">
        {PRE_CONFIGURED_APPS.map(app => {
          const cfg = configs.find(c => c.id === app.id)
          const status = getStatus(app.id)
          const isConnected = status?.status === 'connected'

          return (
            <div key={app.id} className="p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{app.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-200">{app.name}</span>
                    {isConnected && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 font-medium">
                        {status?.toolCount || 0} tools
                      </span>
                    )}
                    {status?.status === 'error' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 font-medium">
                        Error
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{app.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isConnected && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                  {status?.status === 'error' && <span className="w-2 h-2 rounded-full bg-red-500" />}
                  {cfg ? (
                    <>
                      <Toggle checked={cfg.enabled} onChange={(v) => handleToggle(app.id, v)} />
                      <button onClick={() => handleRemove(app.id)}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors p-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleAddPreConfigured(app)}
                      className="h-7 px-2.5 text-[11px] font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors">
                      Add
                    </button>
                  )}
                </div>
              </div>
              {status?.error && (
                <p className="text-[10px] text-red-400 mt-1 truncate">{status.error}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Custom servers */}
      {configs.filter(c => !PRE_CONFIGURED_APPS.find(a => a.id === c.id)).map(cfg => {
        const status = getStatus(cfg.id)
        const isConnected = status?.status === 'connected'
        return (
          <div key={cfg.id} className="p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{cfg.icon || '🔧'}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-200">{cfg.name}</span>
                {isConnected && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 font-medium ml-2">
                    {status?.toolCount || 0} tools
                  </span>
                )}
                <p className="text-[10px] text-gray-600 font-mono truncate">{cfg.command || cfg.url}</p>
              </div>
              {isConnected && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
              <Toggle checked={cfg.enabled} onChange={(v) => handleToggle(cfg.id, v)} />
              <button onClick={() => handleRemove(cfg.id)}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors p-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )
      })}

      {/* Add custom server */}
      {!showAddForm ? (
        <button onClick={() => setShowAddForm(true)}
          className="w-full h-9 text-xs font-medium text-gray-500 border border-dashed border-surface-dark-3 rounded-lg hover:border-accent/40 hover:text-accent transition-colors">
          + Add Custom MCP Server
        </button>
      ) : (
        <div className="p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 space-y-2">
          <div className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Server name"
              className="flex-1 h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50 placeholder-gray-600" />
            <select value={newTransport} onChange={e => setNewTransport(e.target.value as 'stdio' | 'sse')}
              className="h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs outline-none">
              <option value="stdio">stdio</option>
              <option value="sse">SSE</option>
            </select>
          </div>
          {newTransport === 'stdio' ? (
            <input value={newCommand} onChange={e => setNewCommand(e.target.value)} placeholder="Command (e.g. npx -y @org/mcp-server)"
              className="w-full h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs font-mono outline-none focus:border-accent/50 placeholder-gray-600" />
          ) : (
            <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="SSE URL (e.g. http://localhost:3001/sse)"
              className="w-full h-8 px-2 rounded bg-surface-dark-2 border border-surface-dark-3 text-gray-200 text-xs font-mono outline-none focus:border-accent/50 placeholder-gray-600" />
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddForm(false)}
              className="h-7 px-2.5 text-[11px] text-gray-500 rounded hover:text-gray-300 transition-colors">Cancel</button>
            <button onClick={handleAddCustom} disabled={!newName.trim()}
              className="h-7 px-2.5 text-[11px] font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 disabled:opacity-30 transition-colors">Add Server</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Privacy ─────────────────────────────────────────────────────────────────

function PrivacySettings({ settings, onSave }: { settings: AppSettings; onSave: (key: string, value: any) => void }) {
  return (
    <>
      <SettingRow label="Redaction" description="Strip passwords, tokens, and card numbers from AI requests">
        <Toggle checked={settings.redactionEnabled} onChange={v => onSave('redactionEnabled', v)} />
      </SettingRow>

      <SettingRow label="Audit Log Retention" description="Days to keep the audit log">
        <select value={settings.auditRetentionDays} onChange={e => onSave('auditRetentionDays', Number(e.target.value))}
          className="h-8 px-2 rounded bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50">
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </SettingRow>

      <SettingRow label="MCP Auto-Start" description="Automatically start MCP server on launch">
        <Toggle checked={settings.mcpAutoStart} onChange={v => onSave('mcpAutoStart', v)} />
      </SettingRow>
    </>
  )
}

// ── Performance ─────────────────────────────────────────────────────────────

function PerformanceSettings({ settings, onSave }: { settings: AppSettings; onSave: (key: string, value: any) => void }) {
  return (
    <>
      <SettingRow label="Performance Mode" description="Reduce animations and background activity to improve speed">
        <Toggle checked={settings.performanceMode ?? false} onChange={v => onSave('performanceMode', v)} />
      </SettingRow>

      <SettingRow label="Tab Suspend After" description="Auto-suspend inactive tabs to free memory">
        <select value={settings.tabSuspendAfterMinutes ?? 15} onChange={e => onSave('tabSuspendAfterMinutes', Number(e.target.value))}
          className="h-8 px-2 rounded bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50">
          <option value={5}>5 minutes</option>
          <option value={10}>10 minutes</option>
          <option value={15}>15 minutes</option>
          <option value={30}>30 minutes</option>
          <option value={60}>60 minutes</option>
        </select>
      </SettingRow>

      <SettingRow label="Network Throttling" description="Simulate slower network conditions for testing">
        <select value={settings.networkThrottling ?? 'none'} onChange={e => onSave('networkThrottling', e.target.value)}
          className="h-8 px-2 rounded bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50">
          <option value="none">None</option>
          <option value="slow-3g">Slow 3G</option>
          <option value="fast-3g">Fast 3G</option>
          <option value="regular-4g">Regular 4G</option>
        </select>
      </SettingRow>
    </>
  )
}

// ── Support / Donate ────────────────────────────────────────────────────────

const BTC_ADDRESS = '12yRGpUfFznzZoz4yVfZKRxLSkAwbanw2B'

function SupportSettings() {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(BTC_ADDRESS).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-5">
      {/* Heading */}
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Support Oculo Development</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          Oculo is free and open source. If you find it useful, consider supporting development with a donation.
        </p>
      </div>

      {/* Bitcoin donation */}
      <div className="p-4 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
        <div className="flex items-center gap-2 mb-3">
          {/* Bitcoin SVG icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <circle cx="12" cy="12" r="12" fill="#F7931A" />
            <path
              d="M16.5 10.2c.22-1.48-.9-2.28-2.44-2.81l.5-2-.97-.24-.49 1.94c-.25-.06-.51-.12-.77-.18l.5-1.95-.97-.24-.5 2c-.21-.05-.42-.1-.62-.15l.001-.005-.34-.08-.47 1.13s.72.16.7.17c.39.1.46.35.45.56l-.46 1.83c.03.01.06.02.1.04l-.1-.02-.64 2.56c-.05.12-.17.29-.44.23.01.01-.7-.18-.7-.18L9 13.47l.9.22.5-1.97c.27.07.53.13.79.19l-.5 1.96.97.24.5-2c2.02.38 3.54.23 4.18-1.6.52-1.48-.03-2.34-1.1-2.9.79-.18 1.38-.69 1.54-1.75l-.18-.05zm-2.75 3.86c-.37 1.48-2.87.68-3.68.48l.66-2.62c.81.2 3.4.6 3.02 2.14zm.37-3.88c-.34 1.35-2.42.66-3.1.5l.59-2.37c.68.17 2.88.48 2.51 1.87z"
              fill="white"
            />
          </svg>
          <span className="text-sm font-semibold text-gray-200">Bitcoin (BTC)</span>
        </div>
        <p className="text-[11px] text-gray-500 mb-2">Send BTC to the address below:</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 h-8 px-2 flex items-center rounded bg-surface-dark-2 border border-surface-dark-3 text-[11px] font-mono text-gray-300 truncate select-all">
            {BTC_ADDRESS}
          </code>
          <button
            onClick={handleCopy}
            className={`h-8 px-3 text-xs font-medium rounded transition-all flex-shrink-0 ${
              copied
                ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50'
                : 'bg-accent/10 text-accent hover:bg-accent/20 border border-transparent'
            }`}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* GitHub Sponsors */}
      <div className="p-4 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
        <div className="flex items-center gap-2 mb-2">
          {/* GitHub icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-gray-300 flex-shrink-0">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          <span className="text-sm font-semibold text-gray-200">GitHub</span>
        </div>
        <p className="text-[11px] text-gray-500 mb-2">You can also support us on GitHub:</p>
        <a
          href="https://github.com/xidik12/oculo"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors border border-transparent">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          github.com/xidik12/oculo
        </a>
      </div>

      {/* Thank you */}
      <div className="px-4 py-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 text-center">
        <p className="text-xs text-gray-400 leading-relaxed">
          Every contribution helps keep Oculo free for everyone. Thank you! 🙏
        </p>
      </div>
    </div>
  )
}

// ── Shared components ───────────────────────────────────────────────────────

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm text-gray-200">{label}</div>
        <div className="text-[11px] text-gray-500">{description}</div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-dark-3'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}
