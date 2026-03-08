# Contributing to Oculo

Thanks for your interest in contributing to Oculo! This guide covers development setup, architecture, and how to add new MCP tools.

## Development Setup

```bash
git clone https://github.com/xidik12/oculo.git
cd oculo
npm install
npm run dev
```

This starts the Electron app with hot reload via electron-vite.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development with hot reload |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run test` | Run tests |
| `npm run dist:mac` | Build macOS .dmg |
| `npm run dist:win` | Build Windows installer |
| `npm run dist:linux` | Build Linux AppImage |

### Prerequisites

- Node.js 20+
- npm (not pnpm/yarn — native modules need npm)
- macOS, Windows, or Linux

## Architecture

Oculo is an Electron app with three processes:

```
Main Process (Node.js)
├── AI Agent Controller — multi-provider chat (Claude, OpenAI, Gemini, Grok, Ollama)
├── MCP HTTP Server — exposes browser tools on localhost:19516
├── Security — permission gate, credential vault, PII redaction
└── Engine — page description, data extraction, form filling, pipelines

Preload (Bridge)
└── contextBridge → window.oculo API

Renderer (Chromium)
├── App.tsx — full browser UI (tabs, address bar, bookmarks, etc.)
├── ChatPanel.tsx — built-in AI sidebar
├── WebViewContainer.tsx — wraps <webview> tags
└── MCP tool execution — runs JS inside webviews
```

### Why HTTP MCP?

Electron's `<webview>` is only accessible from the renderer process. The main process (stdio) can't touch page content. So we run an HTTP server that bridges main ↔ renderer via IPC:

```
Claude Code → stdio → oculo-mcp.mjs → HTTP → Main → IPC → Renderer → webview
```

### Key Files

| File | Purpose |
|------|---------|
| `src/main/ai/agent.ts` | AI controller — provider routing, streaming, tool-use loops |
| `src/main/mcp/server.ts` | HTTP MCP server (port discovery, auth) |
| `src/main/mcp/tools/` | MCP tool handlers (act, fill, page, read, run) |
| `src/main/engine/` | Browser intelligence (describer, extractor, resolver, pipeline) |
| `src/main/security/` | Permission gate, vault, redactor, audit |
| `src/renderer/App.tsx` | Main browser UI |
| `src/renderer/components/ChatPanel.tsx` | AI chat sidebar |
| `bin/oculo-mcp.mjs` | stdio-to-HTTP MCP bridge for Claude Code |

## Adding a New MCP Tool

1. **Define the tool** in `src/main/mcp/tools/` — create a new file or add to an existing one
2. **Register it** in `src/main/mcp/server.ts` — add to the tool list and call handler
3. **Add the Anthropic tool definition** in `src/main/ai/agent.ts` — the `ANTHROPIC_TOOLS` array
4. **Set permissions** in `src/shared/constants.ts` — `PERMISSION_MAP`
5. **Implement the renderer side** if the tool needs webview access — handle the IPC call in `App.tsx`

## Coding Conventions

- TypeScript strict mode
- React 19 functional components + hooks
- Tailwind CSS for styling
- IPC channels defined in `src/shared/ipc-channels.ts`
- Types centralized in `src/shared/types.ts`
- Path aliases: `@shared` → `src/shared`, `@renderer` → `src/renderer`

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `npm run typecheck` and `npm run build` to verify
4. Open a pull request with a clear description

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
