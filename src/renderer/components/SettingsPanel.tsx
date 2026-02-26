import React, { useState, useEffect, useCallback } from 'react'
import { AI_PROVIDERS, AIProviderId } from '../../shared/ai-types'
import { AppSettings } from '../../shared/types'

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
  } | undefined
}

type SettingsTab = 'general' | 'ai' | 'media' | 'privacy'

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('ai')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [statuses, setStatuses] = useState<Record<string, any>>({})
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

  const handleSaveApiKey = useCallback(async (providerId: AIProviderId) => {
    const key = apiKeys[providerId]?.trim()
    if (!key) return
    await api()?.aiSetConfig({ providerId, enabled: true, apiKey: key })
    setApiKeys(prev => ({ ...prev, [providerId]: '' }))
    refreshStatuses()
    flash(`${providerId} API key saved`)
  }, [apiKeys, refreshStatuses])

  const handleRemoveApiKey = useCallback(async (providerId: AIProviderId) => {
    await api()?.aiSetConfig({ providerId, enabled: false, apiKey: '' })
    refreshStatuses()
    flash(`${providerId} API key removed`)
  }, [refreshStatuses])

  function flash(msg: string) {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2000)
  }

  if (!isOpen) return null

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI Providers' },
    { id: 'media', label: 'Media' },
    { id: 'privacy', label: 'Privacy' },
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
              <GeneralSettings settings={settings} onSave={handleSaveSetting} />
            )}
            {tab === 'ai' && (
              <AISettings
                apiKeys={apiKeys}
                setApiKeys={setApiKeys}
                statuses={statuses}
                onSaveKey={handleSaveApiKey}
                onRemoveKey={handleRemoveApiKey}
              />
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
          </div>
        </div>
      </div>
    </>
  )
}

// ── General ─────────────────────────────────────────────────────────────────

function GeneralSettings({ settings, onSave }: { settings: AppSettings; onSave: (key: string, value: any) => void }) {
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
    </>
  )
}

// ── AI Providers ────────────────────────────────────────────────────────────

function AISettings({ apiKeys, setApiKeys, statuses, onSaveKey, onRemoveKey }: {
  apiKeys: Record<string, string>
  setApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>
  statuses: Record<string, any>
  onSaveKey: (providerId: AIProviderId) => void
  onRemoveKey: (providerId: AIProviderId) => void
}) {
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
    </>
  )
}

// ── Media Generation ────────────────────────────────────────────────────────

const MEDIA_PROVIDERS = [
  { id: 'stability' as const, name: 'Stability AI', desc: 'Stable Diffusion 3 image generation. Requires separate API key.', placeholder: 'sk-...' },
  { id: 'runway' as const, name: 'Runway ML', desc: 'Video generation (coming soon).', placeholder: 'rk-...' },
  { id: 'kling' as const, name: 'Kling', desc: 'Video generation (coming soon).', placeholder: 'API key...' },
]

function MediaSettings({ apiKeys, setApiKeys, onSaveKey, onRemoveKey, statuses }: {
  apiKeys: Record<string, string>
  setApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onSaveKey: (providerId: any) => void
  onRemoveKey: (providerId: any) => void
  statuses: Record<string, any>
}) {
  return (
    <>
      <p className="text-xs text-gray-500 mb-3">
        Configure media generation providers. Gemini and OpenAI keys from AI Providers are reused automatically for image generation.
      </p>

      <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-800/30 mb-4">
        <p className="text-[11px] text-emerald-300 font-medium mb-1">Auto-detected keys</p>
        <p className="text-[11px] text-gray-400">
          If you have a <strong className="text-gray-300">Gemini</strong> or <strong className="text-gray-300">OpenAI</strong> key configured in AI Providers, it will be used for image generation automatically (Gemini Imagen / DALL-E 3).
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
