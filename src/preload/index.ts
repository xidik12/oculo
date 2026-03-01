import { contextBridge, ipcRenderer } from 'electron'
import path from 'path'

// IPC channel constants — synced from src/shared/ipc-channels.ts
// This is a copy because preload cannot import from shared in all build configs.
const IPC = {
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

  // Screenshot
  SCREENSHOT_SAVE: 'screenshot:save',

  // File Upload via CDP
  FILE_UPLOAD: 'file:upload',

  // Media Generation
  MEDIA_GENERATE: 'media:generate',

  // Downloads & File Access
  DOWNLOAD_TRIGGER: 'download:trigger',
  FILE_READ_SAFE: 'file:read-safe',
  FILE_WRITE_SAFE: 'file:write-safe',

  // Clipboard
  CLIPBOARD_WRITE_IMAGE: 'clipboard:write-image',

  // Accessibility Tree (CDP)
  A11Y_SNAPSHOT: 'a11y:snapshot',

  // Print to PDF
  PRINT_TO_PDF: 'print:to-pdf',

  // File Operations
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

  // Session Memory
  MEMORY_LIST: 'memory:list',
  MEMORY_ADD: 'memory:add',
  MEMORY_CLEAR: 'memory:clear',

  // Containers
  CONTAINER_LIST: 'container:list',
  CONTAINER_CREATE: 'container:create',
  CONTAINER_UPDATE: 'container:update',
  CONTAINER_DELETE: 'container:delete',

  // Cards / AI Skills
  CARD_LIST: 'card:list',
  CARD_CREATE: 'card:create',
  CARD_UPDATE: 'card:update',
  CARD_DELETE: 'card:delete',
  CARD_ACTIVATE: 'card:activate',

  // Workspaces
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_SWITCH: 'workspace:switch',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_SAVE: 'workspace:save',

  // Macros
  MACRO_LIST: 'macro:list',
  MACRO_CREATE: 'macro:create',
  MACRO_UPDATE: 'macro:update',
  MACRO_DELETE: 'macro:delete',
  MACRO_EXECUTE: 'macro:execute',

  // Pipelines / Run Cache
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

  // Text Selection
  TEXT_SELECTED: 'text:selected',

  // Focus Mode
  FOCUS_MODE: 'focus-mode',

  // Session Cookies
  COOKIES_EXPORT: 'cookies:export',
  COOKIES_IMPORT: 'cookies:import',

  // Pinned Sidebar Apps
  PINNED_APP_LIST: 'pinned-app:list',
  PINNED_APP_ADD: 'pinned-app:add',
  PINNED_APP_REMOVE: 'pinned-app:remove',
  PINNED_APP_UPDATE: 'pinned-app:update',
  PINNED_APP_SAVE: 'pinned-app:save',
} as const

// Webview registry - stores references to webview DOM elements
// so the MCP engine can execute JavaScript in them
const webviewRegistry = new Map<string, any>()

const api = {
  // === Tab Management (from main process) ===
  onNewTab: (callback: (url?: string, openerId?: number) => void) => {
    const handler = (_: any, url?: string, openerId?: number) => callback(url, openerId)
    ipcRenderer.on(IPC.TAB_CREATE, handler)
    return () => { ipcRenderer.removeListener(IPC.TAB_CREATE, handler) }
  },
  onCloseActiveTab: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('close-active-tab', handler)
    return () => { ipcRenderer.removeListener('close-active-tab', handler) }
  },

  // === Navigation ===
  goBack: (tabId: string) => {
    const wv = webviewRegistry.get(tabId)
    try { if (wv && wv.canGoBack()) wv.goBack() } catch { /* not ready */ }
  },
  goForward: (tabId: string) => {
    const wv = webviewRegistry.get(tabId)
    try { if (wv && wv.canGoForward()) wv.goForward() } catch { /* not ready */ }
  },
  reload: (tabId: string) => {
    const wv = webviewRegistry.get(tabId)
    try { if (wv) wv.reload() } catch { /* not ready */ }
  },
  onGoBack: (callback: (tabId: string) => void) => {
    const handler = (_: any, tabId: string) => callback(tabId)
    ipcRenderer.on(IPC.NAV_BACK, handler)
    return () => { ipcRenderer.removeListener(IPC.NAV_BACK, handler) }
  },
  onGoForward: (callback: (tabId: string) => void) => {
    const handler = (_: any, tabId: string) => callback(tabId)
    ipcRenderer.on(IPC.NAV_FORWARD, handler)
    return () => { ipcRenderer.removeListener(IPC.NAV_FORWARD, handler) }
  },
  onReload: (callback: (tabId: string) => void) => {
    const handler = (_: any, tabId: string) => callback(tabId)
    ipcRenderer.on(IPC.NAV_RELOAD, handler)
    return () => { ipcRenderer.removeListener(IPC.NAV_RELOAD, handler) }
  },

  // === Webview Registry (for MCP engine access) ===
  registerWebview: (tabId: string, webview: any) => {
    webviewRegistry.set(tabId, webview)
    // Notify main process that a webview is available
    ipcRenderer.send('webview:registered', tabId)
  },
  unregisterWebview: (tabId: string) => {
    webviewRegistry.delete(tabId)
    ipcRenderer.send('webview:unregistered', tabId)
  },

  // Execute JavaScript in a specific webview (called by MCP engine via main process)
  executeInWebview: async (tabId: string, code: string): Promise<any> => {
    const wv = webviewRegistry.get(tabId)
    if (!wv) throw new Error(`No webview for tab ${tabId}`)
    return wv.executeJavaScript(code)
  },

  // Get webview info
  getWebviewInfo: (tabId: string): { url: string; title: string } | null => {
    const wv = webviewRegistry.get(tabId)
    if (!wv) return null
    try { return { url: wv.getURL(), title: wv.getTitle() } }
    catch { return null }
  },

  // List registered webview tab IDs
  listWebviews: (): string[] => Array.from(webviewRegistry.keys()),

  // Get the last registered webview (typically the active one)
  getActiveWebviewId: (): string | null => {
    const keys = Array.from(webviewRegistry.keys())
    return keys.length > 0 ? keys[keys.length - 1] : null
  },

  // === Permission Handling ===
  onPermissionRequest: (callback: (data: { action: string; details: string }) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on(IPC.PERMISSION_REQUEST, handler)
    return () => { ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler) }
  },
  respondToPermission: (approved: boolean) => {
    ipcRenderer.send(IPC.PERMISSION_RESPONSE, approved)
  },

  // === Settings ===
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings: any) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),

  // === MCP ===
  getMcpStatus: () => ipcRenderer.invoke(IPC.MCP_STATUS),

  // === Vault ===
  listCredentials: () => ipcRenderer.invoke(IPC.VAULT_LIST),
  addCredential: (domain: string, username: string, password: string) =>
    ipcRenderer.invoke(IPC.VAULT_ADD, domain, username, password),
  deleteCredential: (id: string) => ipcRenderer.invoke(IPC.VAULT_DELETE, id),

  // === Vault Get (for auto-login) ===
  vaultGet: (domain: string) => ipcRenderer.invoke(IPC.VAULT_GET, domain),

  // === TOTP ===
  vaultTotp: (domain: string): Promise<{ code: string; remainingSeconds: number } | null> =>
    ipcRenderer.invoke(IPC.VAULT_TOTP, domain),
  vaultSetTotp: (domain: string, secret: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.VAULT_SET_TOTP, domain, secret),

  // === Audit ===
  getAuditLog: (limit?: number) => ipcRenderer.invoke(IPC.AUDIT_QUERY, limit),

  // === Settings menu ===
  onOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('open-settings', handler)
    return () => { ipcRenderer.removeListener('open-settings', handler) }
  },

  // === Chat Panel ===
  sendChatMessage: (message: string) => ipcRenderer.invoke(IPC.CHAT_SEND, message),
  clearChat: () => ipcRenderer.invoke(IPC.CHAT_CLEAR),
  abortChat: () => ipcRenderer.invoke(IPC.CHAT_ABORT),
  getChatStatus: () => ipcRenderer.invoke(IPC.CHAT_GET_STATUS),
  onChatStream: (callback: (event: any) => void) => {
    const handler = (_: any, event: any) => callback(event)
    ipcRenderer.on(IPC.CHAT_STREAM, handler)
    return () => { ipcRenderer.removeListener(IPC.CHAT_STREAM, handler) }
  },
  onToggleChat: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('toggle-chat', handler)
    return () => { ipcRenderer.removeListener('toggle-chat', handler) }
  },
  onFocusAddressBar: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('focus-address-bar', handler)
    return () => { ipcRenderer.removeListener('focus-address-bar', handler) }
  },

  // Notify main process which tab/webview is active (for MCP tool routing)
  notifyActiveTab: (webContentsId: number) => {
    ipcRenderer.send('webview:tab-activated', webContentsId)
  },

  // === Zoom ===
  zoomGet: (domain: string) => ipcRenderer.invoke(IPC.ZOOM_GET, domain),
  zoomSet: (domain: string, level: number) => ipcRenderer.invoke(IPC.ZOOM_SET, domain, level),
  zoomReset: (domain: string) => ipcRenderer.invoke(IPC.ZOOM_RESET, domain),
  onZoomIn: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('zoom-in', handler)
    return () => { ipcRenderer.removeListener('zoom-in', handler) }
  },
  onZoomOut: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('zoom-out', handler)
    return () => { ipcRenderer.removeListener('zoom-out', handler) }
  },
  onZoomReset: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('zoom-reset', handler)
    return () => { ipcRenderer.removeListener('zoom-reset', handler) }
  },
  onReaderMode: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('reader-mode', handler)
    return () => { ipcRenderer.removeListener('reader-mode', handler) }
  },
  onSplitView: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('split-view', handler)
    return () => { ipcRenderer.removeListener('split-view', handler) }
  },
  onToggleBookmarksBar: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('toggle-bookmarks-bar', handler)
    return () => { ipcRenderer.removeListener('toggle-bookmarks-bar', handler) }
  },

  // === AI Provider Management ===
  aiSetProvider: (providerId: string, modelId?: string) =>
    ipcRenderer.invoke(IPC.AI_SET_PROVIDER, providerId, modelId),
  aiSetConfig: (config: any) => ipcRenderer.invoke(IPC.AI_SET_CONFIG, config),
  aiGetProviderStatus: (providerId: string) =>
    ipcRenderer.invoke(IPC.AI_GET_PROVIDER_STATUS, providerId),
  aiGetActive: () => ipcRenderer.invoke(IPC.AI_GET_ACTIVE),

  // === Bookmarks ===
  bookmarksList: () => ipcRenderer.invoke(IPC.BOOKMARKS_LIST),
  bookmarksAdd: (title: string, url: string, favicon?: string) =>
    ipcRenderer.invoke(IPC.BOOKMARKS_ADD, title, url, favicon),
  bookmarksUpdate: (id: string, updates: any) =>
    ipcRenderer.invoke(IPC.BOOKMARKS_UPDATE, id, updates),
  bookmarksDelete: (id: string) => ipcRenderer.invoke(IPC.BOOKMARKS_DELETE, id),
  bookmarksFindUrl: (url: string) => ipcRenderer.invoke(IPC.BOOKMARKS_FIND_URL, url),

  // === History ===
  historyAdd: (url: string, title: string, favicon?: string) =>
    ipcRenderer.invoke(IPC.HISTORY_ADD, url, title, favicon),
  historyList: (query?: string, limit?: number) =>
    ipcRenderer.invoke(IPC.HISTORY_LIST, query, limit),
  historyClear: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  historyDeleteUrl: (url: string) => ipcRenderer.invoke(IPC.HISTORY_DELETE_URL, url),

  // === Downloads ===
  downloadsList: () => ipcRenderer.invoke(IPC.DOWNLOADS_LIST),
  downloadsCancel: (id: string) => ipcRenderer.invoke(IPC.DOWNLOADS_CANCEL, id),
  downloadsOpen: (savePath: string) => ipcRenderer.invoke(IPC.DOWNLOADS_OPEN, savePath),

  // === Menu events ===
  onFindInPage: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.FIND_IN_PAGE, handler)
    return () => { ipcRenderer.removeListener(IPC.FIND_IN_PAGE, handler) }
  },
  onToggleDevTools: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('toggle-page-devtools', handler)
    return () => { ipcRenderer.removeListener('toggle-page-devtools', handler) }
  },
  onInspectElement: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('inspect-element', handler)
    return () => { ipcRenderer.removeListener('inspect-element', handler) }
  },
  onViewPageSource: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('view-page-source', handler)
    return () => { ipcRenderer.removeListener('view-page-source', handler) }
  },
  onToggleDevToolsMode: (callback: (mode: string) => void) => {
    const handler = (_: any, mode: string) => callback(mode)
    ipcRenderer.on('toggle-page-devtools-mode', handler)
    return () => { ipcRenderer.removeListener('toggle-page-devtools-mode', handler) }
  },
  toggleDevToolsWithMode: (mode: string) => {
    ipcRenderer.send('devtools:toggle', mode)
  },
  onCommandPalette: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.COMMAND_PALETTE, handler)
    return () => { ipcRenderer.removeListener(IPC.COMMAND_PALETTE, handler) }
  },
  onAddBookmark: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('add-bookmark', handler)
    return () => { ipcRenderer.removeListener('add-bookmark', handler) }
  },
  onReopenClosedTab: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('reopen-closed-tab', handler)
    return () => { ipcRenderer.removeListener('reopen-closed-tab', handler) }
  },
  onNavBack: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('nav-back', handler)
    return () => { ipcRenderer.removeListener('nav-back', handler) }
  },
  onNavForward: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('nav-forward', handler)
    return () => { ipcRenderer.removeListener('nav-forward', handler) }
  },

  // === MCP Navigation (AI-triggered) ===
  onMcpNavigate: (callback: (url: string) => void) => {
    const handler = (_: any, url: string) => callback(url)
    ipcRenderer.on('mcp:navigate', handler)
    return () => { ipcRenderer.removeListener('mcp:navigate', handler) }
  },

  // === MCP Tool Execution (AI-triggered, runs in renderer where webview is accessible) ===
  onMcpToolCall: (callback: (callId: string, toolName: string, args: any) => void) => {
    const handler = (_: any, callId: string, toolName: string, args: any) => callback(callId, toolName, args)
    ipcRenderer.on(IPC.MCP_TOOL_CALL, handler)
    return () => { ipcRenderer.removeListener(IPC.MCP_TOOL_CALL, handler) }
  },
  sendMcpToolResult: (callId: string, result: string) => {
    ipcRenderer.send('mcp:tool-result', callId, result)
  },

  // Open/close webview DevTools docked at bottom (like Chrome)
  openWebviewDevTools: (tabId: string) => {
    // Get webContentsId directly from the webview element and pass it to main
    const wv = webviewRegistry.get(tabId)
    let wcId: number | null = null
    try { wcId = wv?.getWebContentsId?.() ?? null } catch { /* not ready */ }
    ipcRenderer.send('devtools:open', wcId, 'bottom')
  },

  // Open DevTools with explicit webContentsId (for AI tool calls)
  openDevToolsById: (webContentsId: number, mode?: string) => {
    ipcRenderer.send('devtools:open', webContentsId, mode || 'bottom')
  },

  closeDevToolsById: (webContentsId: number) => {
    ipcRenderer.send('devtools:close', webContentsId)
  },

  // Open devtools in inspect-element mode
  inspectElement: (tabId: string) => {
    const wv = webviewRegistry.get(tabId)
    let wcId: number | null = null
    try { wcId = wv?.getWebContentsId?.() ?? null } catch { /* not ready */ }
    ipcRenderer.send('devtools:open', wcId, 'bottom')
  },

  // === Navigate to internal page (from menu) ===
  onNavigateTo: (callback: (url: string) => void) => {
    const handler = (_: any, url: string) => callback(url)
    ipcRenderer.on(IPC.NAVIGATE_TO, handler)
    return () => { ipcRenderer.removeListener(IPC.NAVIGATE_TO, handler) }
  },

  // === External URLs ===
  openExternal: (url: string) => ipcRenderer.send(IPC.OPEN_EXTERNAL, url),

  // === Auth (in-app OAuth login) ===
  authLogin: (providerId: string) => ipcRenderer.invoke(IPC.AUTH_LOGIN, providerId),
  authLogout: (providerId: string) => ipcRenderer.invoke(IPC.AUTH_LOGOUT, providerId),
  authStatus: () => ipcRenderer.invoke(IPC.AUTH_STATUS),

  // === DevTools panel resize events ===
  onDevToolsResized: (callback: (height: number) => void) => {
    const handler = (_: any, height: number) => callback(height)
    ipcRenderer.on('devtools:resized', handler)
    return () => { ipcRenderer.removeListener('devtools:resized', handler) }
  },

  // Get page source for viewing
  getPageSource: async (tabId: string): Promise<string> => {
    const wv = webviewRegistry.get(tabId)
    if (!wv) return ''
    try {
      return await wv.executeJavaScript('document.documentElement.outerHTML')
    } catch { return '' }
  },

  // === Screenshot (Phase 1) ===
  screenshotSave: (base64Png: string): Promise<string> =>
    ipcRenderer.invoke(IPC.SCREENSHOT_SAVE, base64Png),

  // === File Upload via CDP (Phase 2) ===
  fileUpload: (webContentsId: number, selector: string, filePaths: string[]): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_UPLOAD, webContentsId, selector, filePaths),

  // === Download trigger (Phase 4) ===
  downloadTrigger: (url: string): Promise<string> =>
    ipcRenderer.invoke(IPC.DOWNLOAD_TRIGGER, url),

  // === Sandboxed file read (Phase 4) ===
  fileReadSafe: (filePath: string, pageUrl?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_READ_SAFE, filePath, pageUrl),

  // === Sandboxed file write (local file editing) ===
  fileWriteSafe: (filePath: string, content: string, pageUrl?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_WRITE_SAFE, filePath, content, pageUrl),

  // === Clipboard image (Phase 5) ===
  clipboardWriteImage: (base64Png: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_IMAGE, base64Png),

  // === Open file with system default app ===
  openFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.OPEN_FILE, filePath),

  // === File dialog (pick files for chat attachments) ===
  fileDialogOpen: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC.FILE_DIALOG_OPEN),

  // === Get webContentsId for active webview (Phase 2 helper) ===
  getWebContentsId: (tabId: string): number | null => {
    const wv = webviewRegistry.get(tabId)
    try { return wv?.getWebContentsId?.() ?? null } catch { return null }
  },

  // === Accessibility Tree Snapshot (CDP) ===
  a11ySnapshot: (webContentsId: number): Promise<string> =>
    ipcRenderer.invoke(IPC.A11Y_SNAPSHOT, webContentsId),

  // === Run Cache (Compile-to-Code) ===
  runCacheSave: (url: string, steps: any[], description?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_SAVE, url, steps, description),
  runCacheFind: (url: string): Promise<any[]> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_FIND, url),
  runCacheGet: (id: string): Promise<any> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_GET, id),
  runCacheMarkFailed: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_MARK_FAILED, id),
  runCacheMarkSuccess: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_MARK_SUCCESS, id),
  runCacheSummary: (domain: string): Promise<string> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_SUMMARY, domain),

  // === Skills (tested workflows) ===
  runCacheSkills: (domain?: string): Promise<any> =>
    ipcRenderer.invoke(IPC.RUN_CACHE_SKILLS, domain),

  // === Lessons for MCP ===
  lessonsForDomain: (domain: string): Promise<string> =>
    ipcRenderer.invoke(IPC.LESSONS_FOR_DOMAIN, domain),

  // === Network Interception (CDP) ===
  networkIntercept: (webContentsId: number, enable: boolean): Promise<string> =>
    ipcRenderer.invoke(IPC.NETWORK_INTERCEPT, webContentsId, enable),
  networkGetBody: (webContentsId: number, requestId: string): Promise<string> =>
    ipcRenderer.invoke(IPC.NETWORK_GET_BODY, webContentsId, requestId),

  // === Print to PDF ===
  printToPDF: (webContentsId: number): Promise<string> =>
    ipcRenderer.invoke(IPC.PRINT_TO_PDF, webContentsId),

  // === PTY Terminal ===
  ptySpawn: (cols: number, rows: number): void =>
    ipcRenderer.send(IPC.PTY_SPAWN, cols, rows),
  ptyWrite: (data: string): void =>
    ipcRenderer.send(IPC.PTY_DATA, data),
  ptyResize: (cols: number, rows: number): void =>
    ipcRenderer.send(IPC.PTY_RESIZE, cols, rows),
  ptyKill: (): void =>
    ipcRenderer.send(IPC.PTY_KILL),
  onPtyData: (callback: (data: string) => void): (() => void) => {
    const handler = (_: any, data: string) => callback(data)
    ipcRenderer.on(IPC.PTY_DATA, handler)
    return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler)
  },
  onPtyExit: (callback: (exitCode: number, signal?: number) => void): (() => void) => {
    const handler = (_: any, exitCode: number, signal?: number) => callback(exitCode, signal)
    ipcRenderer.on(IPC.PTY_EXIT, handler)
    return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler)
  },

  // === MCP Client (Connected Apps) ===
  mcpClientList: (): Promise<any[]> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_LIST),
  mcpClientAdd: (config: any): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_ADD, config),
  mcpClientRemove: (serverId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_REMOVE, serverId),
  mcpClientToggle: (serverId: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_TOGGLE, serverId, enabled),
  mcpClientStatus: (): Promise<any[]> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_STATUS),
  mcpClientTools: (): Promise<any[]> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_TOOLS),
  mcpClientCall: (name: string, args: any): Promise<string> =>
    ipcRenderer.invoke(IPC.MCP_CLIENT_CALL, name, args),

  // === Session Memory ===
  memoryList: (): Promise<any[]> => ipcRenderer.invoke(IPC.MEMORY_LIST),
  memoryAdd: (summary: string, urls: string[], tags?: string[]): Promise<any> =>
    ipcRenderer.invoke(IPC.MEMORY_ADD, summary, urls, tags),
  memoryClear: (): Promise<boolean> => ipcRenderer.invoke(IPC.MEMORY_CLEAR),

  // === Containers ===
  containerList: (): Promise<any[]> => ipcRenderer.invoke(IPC.CONTAINER_LIST),
  containerCreate: (name: string, color: string, icon: string): Promise<any> =>
    ipcRenderer.invoke(IPC.CONTAINER_CREATE, name, color, icon),
  containerUpdate: (id: string, updates: any): Promise<any> =>
    ipcRenderer.invoke(IPC.CONTAINER_UPDATE, id, updates),
  containerDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CONTAINER_DELETE, id),

  // === Cards / AI Skills ===
  cardList: (): Promise<any[]> => ipcRenderer.invoke(IPC.CARD_LIST),
  cardCreate: (name: string, icon: string, systemInstruction: string, triggerDomains?: string[]): Promise<any> =>
    ipcRenderer.invoke(IPC.CARD_CREATE, name, icon, systemInstruction, triggerDomains),
  cardUpdate: (id: string, updates: any): Promise<any> =>
    ipcRenderer.invoke(IPC.CARD_UPDATE, id, updates),
  cardDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CARD_DELETE, id),
  cardActivate: (id: string): Promise<any> =>
    ipcRenderer.invoke(IPC.CARD_ACTIVATE, id),

  // === Workspaces ===
  workspaceList: (): Promise<any[]> => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
  workspaceCreate: (name: string, color: string): Promise<any> =>
    ipcRenderer.invoke(IPC.WORKSPACE_CREATE, name, color),
  workspaceSwitch: (id: string): Promise<any> =>
    ipcRenderer.invoke(IPC.WORKSPACE_SWITCH, id),
  workspaceDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WORKSPACE_DELETE, id),
  workspaceSave: (id: string, tabIds: string[], tabUrls: string[], aiHistory: any[]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WORKSPACE_SAVE, id, tabIds, tabUrls, aiHistory),

  // === Macros ===
  macroList: (): Promise<any[]> => ipcRenderer.invoke(IPC.MACRO_LIST),
  macroCreate: (name: string, steps: any[], shortcut?: string, description?: string): Promise<any> =>
    ipcRenderer.invoke(IPC.MACRO_CREATE, name, steps, shortcut, description),
  macroUpdate: (id: string, updates: any): Promise<any> =>
    ipcRenderer.invoke(IPC.MACRO_UPDATE, id, updates),
  macroDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MACRO_DELETE, id),
  macroExecute: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MACRO_EXECUTE, id),

  // === Run Cache (Pipelines Panel) ===
  runCacheList: (): Promise<any[]> => ipcRenderer.invoke(IPC.RUN_CACHE_LIST),
  runCacheDelete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.RUN_CACHE_DELETE, id),

  // === Pipeline Pattern Detection ===
  onPipelineSuggest: (callback: (suggestion: any) => void): (() => void) => {
    const handler = (_: any, suggestion: any) => callback(suggestion)
    ipcRenderer.on(IPC.PIPELINE_SUGGEST, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_SUGGEST, handler)
  },
  pipelineDismiss: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PIPELINE_DISMISS, id),
  onMacroExecute: (callback: (macro: any) => void): (() => void) => {
    const handler = (_: any, macro: any) => callback(macro)
    ipcRenderer.on(IPC.MACRO_EXECUTE, handler)
    return () => ipcRenderer.removeListener(IPC.MACRO_EXECUTE, handler)
  },

  // === Pinned Sidebar Apps ===
  pinnedAppList: (): Promise<any[]> => ipcRenderer.invoke(IPC.PINNED_APP_LIST),
  pinnedAppAdd: (url: string, title: string, favicon?: string, width?: number): Promise<any> =>
    ipcRenderer.invoke(IPC.PINNED_APP_ADD, url, title, favicon, width),
  pinnedAppRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PINNED_APP_REMOVE, id),
  pinnedAppUpdate: (id: string, updates: any): Promise<any> =>
    ipcRenderer.invoke(IPC.PINNED_APP_UPDATE, id, updates),
  pinnedAppSave: (apps: any[]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PINNED_APP_SAVE, apps),

  // === Session Cookies ===
  cookiesExport: (url?: string): Promise<any[]> =>
    ipcRenderer.invoke(IPC.COOKIES_EXPORT, url),
  cookiesImport: (cookies: any[]): Promise<any> =>
    ipcRenderer.invoke(IPC.COOKIES_IMPORT, cookies),

  // === CAPTCHA Solving ===
  captchaSolve: (webContentsId: number): Promise<any> =>
    ipcRenderer.invoke(IPC.CAPTCHA_SOLVE, webContentsId),

  // === Focus Mode ===
  onFocusMode: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.FOCUS_MODE, handler)
    return () => { ipcRenderer.removeListener(IPC.FOCUS_MODE, handler) }
  },

  // === Webview preload script path (for <webview preload="..."> attribute) ===
  webviewPreloadPath: path.join(__dirname, 'webview-preload.js'),
}

contextBridge.exposeInMainWorld('oculo', api)

export type OculoAPI = typeof api
