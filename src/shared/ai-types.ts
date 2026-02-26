// AI Provider definitions

export type AIProviderId = 'claude' | 'gemini' | 'openai' | 'grok' | 'openclaw' | 'ollama'

export interface AIProvider {
  id: AIProviderId
  name: string
  description: string
  authType: 'api-key' | 'dual' // 'dual' = supports both API key and CLI subscription
  models: AIModel[]
  icon: string
}

export interface AIModel {
  id: string
  name: string
  providerId: AIProviderId
}

export interface AIProviderConfig {
  providerId: AIProviderId
  enabled: boolean
  apiKey?: string
  selectedModelId?: string
}

export interface AIProviderStatus {
  providerId: AIProviderId
  connected: boolean
  ready: boolean
  error?: string
  authMode?: 'api-key' | 'subscription' // which mode is active
}

// All available providers
export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Paste API key for instant responses, or use CLI subscription (slower)',
    authType: 'dual',
    icon: 'claude',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', providerId: 'claude' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', providerId: 'claude' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', providerId: 'claude' },
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google AI — requires API key from ai.google.dev',
    authType: 'api-key',
    icon: 'gemini',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', providerId: 'gemini' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', providerId: 'gemini' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', providerId: 'gemini' },
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Use Codex CLI subscription or API key from platform.openai.com',
    authType: 'dual',
    icon: 'openai',
    models: [
      { id: 'gpt-4.1', name: 'GPT-4.1', providerId: 'openai' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', providerId: 'openai' },
      { id: 'o3', name: 'o3', providerId: 'openai' },
      { id: 'o4-mini', name: 'o4 Mini', providerId: 'openai' },
      { id: 'codex-mini', name: 'Codex Mini', providerId: 'openai' },
    ]
  },
  {
    id: 'grok',
    name: 'Grok',
    description: 'xAI Grok models — requires API key from console.x.ai',
    authType: 'api-key',
    icon: 'grok',
    models: [
      { id: 'grok-3', name: 'Grok 3', providerId: 'grok' },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', providerId: 'grok' },
    ]
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'OpenClaw AI — requires API key',
    authType: 'api-key',
    icon: 'openclaw',
    models: [
      { id: 'openclaw-default', name: 'OpenClaw', providerId: 'openclaw' },
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Free, local AI — install Ollama, pull a model, no API key needed',
    authType: 'api-key',
    icon: 'ollama',
    models: [
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', providerId: 'ollama' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', providerId: 'ollama' },
      { id: 'gemma2:9b', name: 'Gemma 2 9B', providerId: 'ollama' },
      { id: 'mistral:7b', name: 'Mistral 7B', providerId: 'ollama' },
      { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', providerId: 'ollama' },
      { id: 'phi4:14b', name: 'Phi-4 14B', providerId: 'ollama' },
    ]
  },
]
