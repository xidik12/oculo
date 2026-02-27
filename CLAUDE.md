# Oculo — AI-Powered Native Browser

> Latin: "to see, to give sight" — Cursor:VSCode :: Oculo:Chrome

## Quick Reference

- **App ID:** `com.oculo.browser`
- **Stack:** Electron 34, TypeScript, React 19, Tailwind CSS 3, electron-vite
- **Package manager:** npm (not pnpm)
- **Dev:** `npm run dev` (electron-vite hot reload)
- **Build:** `npm run build` → `npm run dist:mac`
- **Typecheck:** `npm run typecheck`
- **Lint:** `npm run lint`
- **Clean:** `npm run clean`

## Architecture

### MCP Transport (HTTP, not stdio)

Electron's `<webview>` is only accessible from the renderer process, so we use HTTP:

```
Claude Code → bin/oculo-mcp.mjs (stdio bridge) → HTTP POST :19516/mcp
→ McpServerManager (main) → IPC 'mcp:tool-call' → Renderer → webview.executeJavaScript()
→ IPC 'mcp:tool-result' → HTTP response → stdio bridge → Claude Code
```

- Electron app starts HTTP server on ports 19516-19520, writes `~/.oculo-port` (`port:authtoken`)
- `bin/oculo-mcp.mjs` is the stdio MCP bridge that Claude Code connects to — it reads `~/.oculo-port` and proxies

### Register with Claude Code

```bash
claude mcp add oculo -- node ~/Desktop/oculo/bin/oculo-mcp.mjs
```

Tools are always discoverable (static definitions in bridge), but Oculo must be running for tool calls to succeed.

### 6 MCP Tools

| Tool | What it does | Token cost |
|------|-------------|------------|
| `page` | Describe current page (headings, forms, buttons, links, text) | ~30-80 tokens |
| `act` | Navigate, click, hover, scroll, press keys, login (vault) | ~1 line |
| `fill` | Fill form fields by label matching, optional submit | ~1 line |
| `read` | Extract structured data (lists, tables, cards) | compact |
| `run` | Multi-step pipeline with conditionals (page/act/fill/read/wait/if) | header + last |
| `media` | Generate images (Nano Banana / DALL-E 3) or videos (Veo 3.1) | file path |

### Directory Structure

```
src/
├── main/                  # Electron main process
│   ├── index.ts           # App entry, initializes all subsystems
│   ├── ipc.ts             # All IPC handlers (main ↔ renderer)
│   ├── menu.ts            # Native app menu
│   ├── ai/
│   │   └── agent.ts       # AgentController — multi-provider AI (largest file, ~71KB)
│   ├── captcha/           # CAPTCHA detection + solvers (audio, text, slider)
│   ├── data/              # bookmarks, downloads, history, zoom stores
│   ├── engine/
│   │   ├── describer.ts   # Page describer (JS-in-webview, powers `page` tool)
│   │   ├── extractor.ts   # Structured data extractor (powers `read` tool)
│   │   ├── form-detector.ts # Form field detection + filling (powers `fill` tool)
│   │   ├── pipeline.ts    # Multi-step pipeline runner (powers `run` tool)
│   │   └── resolver.ts    # Element resolver by text/role/label/placeholder (powers `act` tool)
│   ├── mcp/
│   │   ├── server.ts      # HTTP MCP server (port 19516-19520, auth token)
│   │   └── tools/         # act.ts, fill.ts, page.ts, read.ts, run.ts
│   └── security/
│       ├── anti-injection.ts  # MCP content boundary markers + injection detection
│       ├── audit.ts           # Action audit log (in-memory, TODO: SQLite)
│       ├── permissions.ts     # PermissionGate (auto/notify/confirm/blocked)
│       ├── redactor.ts        # PII/secret redaction on MCP responses
│       └── vault.ts           # Credential vault (electron.safeStorage → OS keychain)
├── preload/
│   └── index.ts           # contextBridge → window.oculo API
├── renderer/
│   ├── App.tsx            # Root React component (~67KB, full browser UI)
│   ├── components/
│   │   ├── AddressBar.tsx, TabBar.tsx, WebViewContainer.tsx
│   │   ├── ChatPanel.tsx      # Built-in AI sidebar (multi-provider)
│   │   ├── SettingsPanel.tsx, StatusBar.tsx
│   │   ├── bookmarks/        # BookmarksBar, BookmarksSidebar, AddBookmarkPopover
│   │   ├── common/           # CommandPalette, ContextMenu, NewTabPage, ReaderMode, Toast
│   │   ├── downloads/, find/, history/
│   │   └── layout/           # BottomBar, ContentArea, Sidebar, SplitView, Toolbar
│   └── styles/global.css
└── shared/
    ├── ai-types.ts        # AI provider definitions (Claude, OpenAI, Gemini, Grok, OpenClaw)
    ├── constants.ts       # Permission map, redaction patterns, app constants
    ├── ipc-channels.ts    # All typed IPC channel names
    └── types.ts           # All TypeScript types
```

### Path Aliases

- `@shared` → `src/shared`
- `@renderer` → `src/renderer`

## AI Provider System

Built-in AI chat panel supports 5 providers (`src/shared/ai-types.ts`):

- **Claude** — API key OR Claude Code CLI subscription (dual auth)
- **OpenAI** — API key OR Codex CLI subscription (dual auth)
- **Gemini** — API key only
- **Grok** — API key only
- **OpenClaw** — API key only

The `AgentController` (`src/main/ai/agent.ts`) handles streaming, tool calls, and provider switching.

## Security Model

### Permission Levels (PERMISSION_MAP in constants.ts)
- **AUTO:** navigate, page, read, scroll, screenshot, back, forward, reload, hover
- **NOTIFY:** click, type, fill, select, login, press, submit (OS notification)
- **CONFIRM:** payment, delete_account, change_password, send_email, download, oauth (native dialog)
- **BLOCKED:** read_vault, export_cookies, export_tokens, disable_security

### Vault
- `electron.safeStorage` → OS Keychain (macOS) / DPAPI (Windows)
- Stored at: `~/Library/Application Support/oculo/oculo-data/vault.enc`
- Passwords NEVER returned via IPC/MCP — only domain + username exposed

### Redaction
- All MCP responses pass through `Redactor` before reaching Claude Code
- Strips: credit cards, SSN, JWT, API keys, private keys, Bearer tokens

### Anti-Injection
- MCP content wrapped in boundary markers
- Regex-based injection pattern detection

## Data Storage

All persisted in `~/Library/Application Support/oculo/oculo-data/`:
- `vault.enc` — encrypted credentials
- `settings.json` — app settings
- Bookmarks, history, downloads — JSON files via data stores

## Coding Conventions

- TypeScript strict mode (ES2022 target)
- React 19 with functional components + hooks
- Tailwind CSS for all styling
- IPC channels defined centrally in `src/shared/ipc-channels.ts` — always add new channels there
- Types centralized in `src/shared/types.ts`
- Security-first: all MCP outputs go through redactor, all actions go through permission gate
- Page intelligence runs entirely via `webview.executeJavaScript()` — no external dependencies

## Key Design Decisions

1. **HTTP MCP over stdio** — Electron's webview requires renderer process access; stdio from main process can't reach it
2. **electron.safeStorage over keytar** — Native Electron API, no native module compilation needed
3. **In-memory audit log** — Simpler than SQLite for now; migration planned
4. **Single App.tsx** — Monolithic renderer component (~67KB); works for current scale, refactor when needed
5. **electron-vite over Turborepo** — Simpler build, single package, no monorepo overhead needed yet

## What's NOT Done Yet

- No ESLint/Prettier config
- Whisper model integration incomplete (CAPTCHA audio solving)
- No code signing / notarization (Apple Developer account expired)
- Audit log should migrate to SQLite
- Touch ID for confirm-level permissions
- TOTP / 2FA vault support
- Windows/Linux builds
- Auto-updater integration
- npm package publication
