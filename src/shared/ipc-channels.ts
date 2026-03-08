// IPC channel names - typed constants to avoid typos
export const IPC = {
  // Tab management
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_CLOSE_BY_URL: 'tab:close-by-url',
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
  VAULT_TOTP: 'vault:totp',
  VAULT_SET_TOTP: 'vault:set-totp',
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPONSE: 'permission:response',
  AUDIT_QUERY: 'audit:query',

  // CAPTCHA
  CAPTCHA_DETECTED: 'captcha:detected',
  CAPTCHA_SOLVED: 'captcha:solved',
  CAPTCHA_FAILED: 'captcha:failed',
  CAPTCHA_SOLVE: 'captcha:solve',

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
  DOWNLOADS_SHOW_IN_FOLDER: 'downloads:show-in-folder',

  // Zoom
  ZOOM_GET: 'zoom:get',
  ZOOM_SET: 'zoom:set',
  ZOOM_RESET: 'zoom:reset',

  // Find in page
  FIND_IN_PAGE: 'find-in-page',
  FIND_CLOSE: 'find:close',

  // Command palette
  COMMAND_PALETTE: 'command-palette',

  // Dev tools
  DEV_TOOLS: 'dev-tools',

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
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
  FILE_WRITE_SAFE: 'file:write-safe',

  // Clipboard (Phase 5)
  CLIPBOARD_WRITE_IMAGE: 'clipboard:write-image',

  // Accessibility Tree (CDP)
  A11Y_SNAPSHOT: 'a11y:snapshot',

  // Adaptive Element Resolution (CDP)
  RESOLVE_NODE: 'resolve:node',

  // Print to PDF
  PRINT_TO_PDF: 'print:to-pdf',

  // File Operations (Chat Features)
  OPEN_FILE: 'file:open',
  FILE_DIALOG_OPEN: 'file:dialog-open',

  // MCP Client (Connected Apps)
  MCP_CLIENT_LIST: 'mcp-client:list',
  MCP_CLIENT_ADD: 'mcp-client:add',
  MCP_CLIENT_REMOVE: 'mcp-client:remove',
  MCP_CLIENT_TOGGLE: 'mcp-client:toggle',
  MCP_CLIENT_STATUS: 'mcp-client:status',
  MCP_CLIENT_TOOLS: 'mcp-client:tools',
  MCP_CLIENT_CALL: 'mcp-client:call',

  // PTY Terminal
  PTY_SPAWN: 'pty:spawn',
  PTY_DATA: 'pty:data',
  PTY_RESIZE: 'pty:resize',
  PTY_EXIT: 'pty:exit',
  PTY_KILL: 'pty:kill',

  // Session Memory (Feature 2)
  MEMORY_LIST: 'memory:list',
  MEMORY_ADD: 'memory:add',
  MEMORY_CLEAR: 'memory:clear',

  // Containers (Feature 6)
  CONTAINER_LIST: 'container:list',
  CONTAINER_CREATE: 'container:create',
  CONTAINER_UPDATE: 'container:update',
  CONTAINER_DELETE: 'container:delete',

  // Cards / AI Skills (Feature 7)
  CARD_LIST: 'card:list',
  CARD_CREATE: 'card:create',
  CARD_UPDATE: 'card:update',
  CARD_DELETE: 'card:delete',
  CARD_ACTIVATE: 'card:activate',

  // Workspaces (Feature 8)
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_SWITCH: 'workspace:switch',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_SAVE: 'workspace:save',

  // Macros (Feature 10)
  MACRO_LIST: 'macro:list',
  MACRO_CREATE: 'macro:create',
  MACRO_UPDATE: 'macro:update',
  MACRO_DELETE: 'macro:delete',
  MACRO_EXECUTE: 'macro:execute',

  // Pipelines / Run Cache (Feature 11)
  RUN_CACHE_LIST: 'run-cache:list',
  RUN_CACHE_DELETE: 'run-cache:delete',
  RUN_CACHE_SAVE: 'run-cache:save',
  RUN_CACHE_FIND: 'run-cache:find',
  RUN_CACHE_GET: 'run-cache:get',
  RUN_CACHE_MARK_FAILED: 'run-cache:mark-failed',
  RUN_CACHE_MARK_SUCCESS: 'run-cache:mark-success',
  RUN_CACHE_SUMMARY: 'run-cache:summary',
  RUN_CACHE_SKILLS: 'run-cache:skills',
  PIPELINE_SUGGEST: 'pipeline:suggest',
  PIPELINE_DISMISS: 'pipeline:dismiss',

  // Lessons
  LESSONS_FOR_DOMAIN: 'lessons:for-domain',

  // Network Interception (CDP)
  NETWORK_INTERCEPT: 'network:intercept',
  NETWORK_GET_BODY: 'network:get-body',

  // Text Selection (Feature 3)
  TEXT_SELECTED: 'text:selected',

  // Focus Mode (Feature 4)
  FOCUS_MODE: 'focus-mode',

  // Session Cookies (Export/Import)
  COOKIES_EXPORT: 'cookies:export',
  COOKIES_IMPORT: 'cookies:import',

  // Pinned Sidebar Apps (Feature 15)
  PINNED_APP_LIST: 'pinned-app:list',
  PINNED_APP_ADD: 'pinned-app:add',
  PINNED_APP_REMOVE: 'pinned-app:remove',
  PINNED_APP_UPDATE: 'pinned-app:update',
  PINNED_APP_SAVE: 'pinned-app:save',

  // AI Quick Complete (v0.3.0)
  AI_QUICK_COMPLETE: 'ai:quick-complete',

  // Download Updates (v0.3.0)
  DOWNLOAD_UPDATED: 'download:updated',

  // Webpage Change Monitoring (v0.3.0)
  WATCHER_LIST: 'watcher:list',
  WATCHER_ADD: 'watcher:add',
  WATCHER_REMOVE: 'watcher:remove',
  WATCHER_CHANGED: 'watcher:changed',
} as const

export type IPCChannel = typeof IPC[keyof typeof IPC]
