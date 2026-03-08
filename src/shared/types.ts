// Tab state
export interface Tab {
  id: string
  url: string
  title: string
  originalTitle?: string  // v0.3.0: pre-tidy title for tooltip
  favicon?: string
  isLoading: boolean
  isActive?: boolean
  canGoBack: boolean
  canGoForward: boolean
  containerId?: string
  openerId?: number  // webContentsId of the opener tab (for popup/OAuth flow)
}

// Page description (what the 'page' MCP tool returns)
export interface PageDescription {
  url: string
  title: string
  headings: string[]
  forms: FormDescription[]
  buttons: string[]
  links: { text: string; href: string }[]
  meta?: string
}

// Form field description
export interface FormField {
  label: string
  type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'date' | 'hidden' | 'unknown'
  value: string
  placeholder?: string
  required: boolean
  options?: string[]  // for select/radio
  checked?: boolean   // for checkbox/radio
}

// Form description
export interface FormDescription {
  id?: string
  action?: string
  fields: FormField[]
  submitButton?: string
}

// Element target (how Claude specifies which element to interact with)
export interface ElementTarget {
  text?: string
  role?: string
  name?: string
  label?: string
  placeholder?: string
  selector?: string
  nth?: number
}

// Action types for the 'act' tool
export type ActionType = 'click' | 'navigate' | 'back' | 'forward' | 'scroll' | 'press' | 'hover' | 'select' | 'login' | 'reload'

// Act tool request
export interface ActRequest {
  action: ActionType
  // Element targeting
  text?: string
  role?: string
  name?: string
  label?: string
  placeholder?: string
  selector?: string
  nth?: number
  // Action-specific
  url?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  key?: string
  modifiers?: string[]
  site?: string
  value?: string  // for select
  screenshot?: boolean
}

// Fill tool request
export interface FillRequest {
  fields: Record<string, string | boolean>
  submit?: boolean | string
  screenshot?: boolean
}

// Read tool request
export interface ReadRequest {
  what: string
  scope?: string
  fields?: string[]
  limit?: number
  format?: 'text' | 'json'
}

// Pipeline step
export interface PipelineStep {
  page?: { scope?: string; include?: string[]; screenshot?: boolean }
  act?: ActRequest
  fill?: FillRequest
  read?: ReadRequest
  wait?: { text?: string; url?: string; selector?: string; timeout?: number }
  if?: { text?: string; url?: string; then: PipelineStep; else?: PipelineStep }
}

// Run tool request
export interface RunRequest {
  steps: PipelineStep[]
  returnAll?: boolean
}

// MCP tool response
export interface ToolResponse {
  content: string
  screenshot?: string  // base64 PNG
  isError?: boolean
}

// Credential vault entry
export interface VaultEntry {
  id: string
  domain: string
  username: string
  password: string  // encrypted at rest, never exposed via MCP
  totpSecret?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

// Permission levels
export type PermissionLevel = 'auto' | 'notify' | 'confirm' | 'blocked'

// Audit log entry
export interface AuditEntry {
  id: number
  timestamp: number
  action: string
  target: string
  result: 'success' | 'failed' | 'blocked' | 'confirmed' | 'denied'
  details?: string
  toolName?: string
}

// CAPTCHA types
export type CaptchaType = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile' | 'text' | 'math' | 'slider' | 'image' | 'unknown'

// Tab groups
export interface TabGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
  tabIds: string[]
}

export const TAB_GROUP_COLORS = [
  { name: 'cyan', bg: '#22d3ee', text: '#164e63' },
  { name: 'purple', bg: '#a78bfa', text: '#4c1d95' },
  { name: 'green', bg: '#4ade80', text: '#14532d' },
  { name: 'orange', bg: '#fb923c', text: '#7c2d12' },
  { name: 'pink', bg: '#f472b6', text: '#831843' },
  { name: 'blue', bg: '#60a5fa', text: '#1e3a5f' },
  { name: 'red', bg: '#f87171', text: '#7f1d1d' },
  { name: 'yellow', bg: '#facc15', text: '#713f12' },
]

// Bookmarks
export interface Bookmark {
  id: string
  title: string
  url: string
  favicon?: string
  parentId: string | null
  index: number
  createdAt: number
  type: 'bookmark' | 'folder' | 'separator'
}

// History
export interface HistoryEntry {
  url: string
  title: string
  favicon?: string
  visitedAt: number
}

// Downloads
export interface DownloadItem {
  id: string
  filename: string
  url: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
}

// App settings
export interface AppSettings {
  theme: 'system' | 'dark' | 'light'
  homePage: string
  searchEngine: string
  mcpAutoStart: boolean
  whisperModel: 'tiny' | 'base' | 'small'
  auditRetentionDays: number
  redactionEnabled: boolean
  customRedactionPatterns: string[]
  /** Ad/tracker/malware blocking (Brave Shields-style) */
  adBlockEnabled: boolean
  /** Persisted AI provider configs (API keys, enabled state) */
  aiProviders?: Record<string, { apiKey?: string; enabled?: boolean; modelId?: string }>
  /** Connected MCP client servers (external apps like Gmail, Calendar, etc.) */
  mcpClients?: McpClientConfig[]
  /** Performance: auto-suspend tabs after N minutes of inactivity */
  performanceMode?: boolean
  tabSuspendAfterMinutes?: number
  networkThrottling?: 'none' | 'slow-3g' | 'fast-3g' | 'regular-4g'
}

// IPC message types
export interface WebviewCommand {
  tabId: string
  action: string
  payload?: unknown
}

// Chat panel types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: ChatToolCall[]
  isStreaming?: boolean
}

export interface ChatToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  status: 'pending' | 'running' | 'done' | 'error'
}

// Token usage from AI providers
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

// WebMCP tool descriptor (from page's navigator.modelContext)
export interface WebMCPToolDescriptor {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  readOnlyHint?: boolean
}

// MCP Client configuration (for connected external MCP servers)
export interface McpClientConfig {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  command?: string           // for stdio transport
  args?: string[]            // for stdio transport
  url?: string               // for SSE transport
  env?: Record<string, string>
  enabled: boolean
  icon?: string              // emoji or icon name
}

export type ChatStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; toolCall: ChatToolCall }
  | { type: 'tool_use_result'; toolCallId: string; result: string; isError?: boolean }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: string }

// === Feature 2: Session Memory ===
export interface SessionMemoryEntry {
  id: string
  summary: string
  urls: string[]
  timestamp: number
  tags?: string[]
}

// === Feature 6: Containers ===
export interface Container {
  id: string
  name: string
  color: string
  icon: string
  partition: string
}

// === Feature 7: Cards / Custom AI Skills ===
export interface Card {
  id: string
  name: string
  icon: string
  systemInstruction: string
  triggerDomains?: string[]
  isActive: boolean
  createdAt: number
}

// === Feature 8: Workspaces ===
export interface Workspace {
  id: string
  name: string
  color: string
  tabIds: string[]
  tabUrls: string[]
  aiHistory: Array<{ role: string; content: unknown }>
  createdAt: number
  lastActiveAt: number
}

// === Feature 10: Macros ===
export interface Macro {
  id: string
  name: string
  shortcut?: string
  steps: PipelineStep[]
  description?: string
  createdAt: number
}

// === Feature 11: Pattern Detection ===
export interface PatternSuggestion {
  id: string
  domain: string
  sequenceLength: number
  occurrences: number
  suggestedName: string
  steps: PipelineStep[]
}

// === Adaptive Element Resolution (fingerprint for 3-tier ref resolution) ===
export interface ElementFingerprint {
  name: string
  role: string
  backendDOMNodeId?: number
  tagName?: string
  inputType?: string
  href?: string
  innerText?: string
  ariaLabel?: string
  placeholder?: string
  classes?: string[]       // top 3 classes
  boundingBox?: { x: number; y: number; w: number; h: number }
  parentRole?: string
  parentName?: string
  siblingIndex?: number
  domDepth?: number
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  required?: boolean
}

// === Proxy Support ===
export interface ProxyConfig {
  type: 'http' | 'https' | 'socks4' | 'socks5' | 'direct'
  host: string
  port: number
  username?: string
  password?: string
  /** Bypass list — domains that should NOT use proxy */
  bypass?: string[]
}

// === Session Recording ===
export interface SessionEntry {
  timestamp: number
  type: 'tool_call' | 'tool_result' | 'screenshot' | 'navigation' | 'page_snapshot'
  toolName?: string
  args?: Record<string, unknown>
  result?: string
  url?: string
  screenshot?: string   // file path to screenshot
  snapshot?: string     // page description at that moment
}

export interface SessionRecord {
  id: string
  startedAt: number
  entries: SessionEntry[]
  status: 'recording' | 'stopped'
}

// === Feature 15: Pinned Sidebar Apps ===
export interface PinnedApp {
  id: string
  url: string
  title: string
  favicon?: string
  width: number
  position: number
}
