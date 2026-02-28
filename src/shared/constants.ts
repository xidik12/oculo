export const APP_NAME = 'Oculo'
export const APP_VERSION = '0.2.0'
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 }
export const DEFAULT_HOME_PAGE = 'https://www.google.com'
export const DEFAULT_SEARCH_ENGINE = 'https://www.google.com/search?q='
export const MCP_SERVER_NAME = 'oculo'
export const MCP_SERVER_VERSION = '0.2.0'

export const DEFAULT_SETTINGS: import('./types').AppSettings = {
  theme: 'system',
  homePage: DEFAULT_HOME_PAGE,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  mcpAutoStart: true,
  whisperModel: 'small',
  auditRetentionDays: 30,
  redactionEnabled: true,
  customRedactionPatterns: [],
  adBlockEnabled: true,
  performanceMode: false,
  tabSuspendAfterMinutes: 15,
  networkThrottling: 'none' as const
}

// Permission categorization
export const PERMISSION_MAP: Record<string, import('./types').PermissionLevel> = {
  // Auto - no confirmation needed
  'navigate': 'auto',
  'page': 'auto',
  'read': 'auto',
  'scroll': 'auto',
  'screenshot': 'auto',
  'back': 'auto',
  'forward': 'auto',
  'reload': 'auto',
  'hover': 'auto',

  // WebMCP
  'webmcp_list': 'auto',
  'webmcp_call': 'notify',

  // MCP Client (connected apps)
  'mcp_client_call': 'notify',

  // Notify - execute but notify user
  'click': 'notify',
  'type': 'notify',
  'fill': 'notify',
  'select': 'notify',
  'login': 'notify',
  'press': 'notify',
  'submit': 'notify',
  'upload': 'notify',
  'generate': 'notify',

  // Confirm - require explicit approval
  'payment': 'confirm',
  'delete_account': 'confirm',
  'change_password': 'confirm',
  'send_email': 'confirm',
  'download': 'confirm',
  'oauth': 'confirm',
  'shell': 'notify',

  // New MCP tools (auto)
  'tabs': 'auto',
  'preview': 'auto',
  'translate': 'auto',
  'lens': 'auto',

  // Blocked - never allowed
  'read_vault': 'blocked',
  'export_cookies': 'blocked',
  'export_tokens': 'blocked',
  'disable_security': 'blocked'
}

// Redaction patterns
export const REDACTION_PATTERNS = {
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  jwt: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-.+/=]{10,}/g,
  apiKey: /(?:api[_-]?key|token|secret|password|auth)["\s:=]+["']?([a-zA-Z0-9_\-]{20,})["']?/gi,
  privateKey: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  bearer: /Bearer\s+[A-Za-z0-9_\-.+/=]{20,}/g
}

// Prompt injection detection patterns
export const INJECTION_PATTERNS = [
  /ignore\s+(previous|prior|above|all)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(in|an?)\s+/i,
  /new\s+(system|admin)\s+(prompt|instruction|mode)/i,
  /\[INST\]/i,
  /\[SYSTEM\]/i,
  /send\s+(all|every|the)\s+.{0,30}(password|credential|secret|token|key)/i,
  /override\s+(safety|security|permission|restriction)/i,
  /disregard\s+(all|any|previous)/i
]

// CAPTCHA selectors
export const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="captcha"]',
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '[data-sitekey]',
  '#captcha',
  '.captcha'
]
