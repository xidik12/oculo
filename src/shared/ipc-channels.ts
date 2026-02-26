// IPC channel names - typed constants to avoid typos
export const IPC = {
  // Tab management
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_UPDATE: 'tab:update',
  TAB_LIST: 'tab:list',

  // Navigation
  NAV_GO: 'nav:go',
  NAV_BACK: 'nav:back',
  NAV_FORWARD: 'nav:forward',
  NAV_RELOAD: 'nav:reload',
  NAV_STOP: 'nav:stop',

  // MCP Server
  MCP_STATUS: 'mcp:status',
  MCP_TOOL_CALL: 'mcp:tool-call',
  MCP_CONNECTED: 'mcp:connected',
  MCP_DISCONNECTED: 'mcp:disconnected',

  // Security
  VAULT_LIST: 'vault:list',
  VAULT_ADD: 'vault:add',
  VAULT_DELETE: 'vault:delete',
  VAULT_GET: 'vault:get',
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPONSE: 'permission:response',
  AUDIT_QUERY: 'audit:query',

  // CAPTCHA
  CAPTCHA_DETECTED: 'captcha:detected',
  CAPTCHA_SOLVED: 'captcha:solved',
  CAPTCHA_FAILED: 'captcha:failed',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Chat Panel
  CHAT_SEND: 'chat:send',
  CHAT_STREAM: 'chat:stream',
  CHAT_CLEAR: 'chat:clear',
  CHAT_ABORT: 'chat:abort',
  CHAT_GET_STATUS: 'chat:get-status',

  // AI Provider Management
  AI_SET_PROVIDER: 'ai:set-provider',
  AI_SET_CONFIG: 'ai:set-config',
  AI_GET_PROVIDER_STATUS: 'ai:get-provider-status',
  AI_GET_ACTIVE: 'ai:get-active',

  // Bookmarks
  BOOKMARKS_LIST: 'bookmarks:list',
  BOOKMARKS_ADD: 'bookmarks:add',
  BOOKMARKS_UPDATE: 'bookmarks:update',
  BOOKMARKS_DELETE: 'bookmarks:delete',
  BOOKMARKS_FIND_URL: 'bookmarks:find-url',

  // History
  HISTORY_ADD: 'history:add',
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_DELETE_URL: 'history:delete-url',

  // Downloads
  DOWNLOADS_LIST: 'downloads:list',
  DOWNLOADS_CANCEL: 'downloads:cancel',
  DOWNLOADS_OPEN: 'downloads:open',

  // Zoom
  ZOOM_GET: 'zoom:get',
  ZOOM_SET: 'zoom:set',
  ZOOM_RESET: 'zoom:reset',

  // Find in page
  FIND_IN_PAGE: 'find:in-page',
  FIND_CLOSE: 'find:close',

  // Command palette
  COMMAND_PALETTE: 'command-palette',

  // Dev tools
  DEV_TOOLS: 'dev-tools',

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_STATUS: 'auth:status',

  // App
  APP_READY: 'app:ready',
  APP_QUIT: 'app:quit',
  NAVIGATE_TO: 'navigate-to',
  OPEN_EXTERNAL: 'open-external',

  // Screenshot (Phase 1)
  SCREENSHOT_SAVE: 'screenshot:save',

  // File Upload via CDP (Phase 2)
  FILE_UPLOAD: 'file:upload',

  // Media Generation (Phase 3)
  MEDIA_GENERATE: 'media:generate',

  // Downloads & File Access (Phase 4)
  DOWNLOAD_TRIGGER: 'download:trigger',
  FILE_READ_SAFE: 'file:read-safe',

  // Clipboard (Phase 5)
  CLIPBOARD_WRITE_IMAGE: 'clipboard:write-image'
} as const

export type IPCChannel = typeof IPC[keyof typeof IPC]
