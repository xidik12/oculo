# Oculo — Development Todo

> Track: ⬜ todo | 🔄 in progress | ✅ done | ❌ blocked

---

## Shipped (v0.1.0)

### Phase 1: Foundation — Core Browser App ✅
- ✅ Electron 34 + React 19 + TypeScript + electron-vite
- ✅ Tab management (new, close, switch, Cmd+T/W)
- ✅ Address bar with navigation, SSL indicator, back/forward/refresh
- ✅ WebView container with all events wired
- ✅ Native macOS menu, keyboard shortcuts
- ✅ Dark/light theme (system preference + manual toggle)
- ✅ Preload scripts (contextBridge API, webview injection)
- ✅ Shared types, constants, IPC channels

### Phase 2: Page Intelligence Engine ✅
- ✅ Smart Describer — compact page summaries (~30-80 tokens)
- ✅ Element Resolver — find by text/role/label/placeholder/selector
- ✅ Form Detector — label mapping, fill by visible text
- ✅ Data Extractor — structured extraction (lists, tables, cards)
- ✅ Pipeline Runner — multi-step workflows with caching
- ✅ A11y mode — full accessibility tree with numbered elements

### Phase 3: MCP Server ✅
- ✅ HTTP MCP server (ports 19516-19520, auth token)
- ✅ 6 tools: page, act, fill, read, run, media
- ✅ stdio bridge (bin/oculo-mcp.mjs) for Claude Code
- ✅ Static tool definitions in bridge (always discoverable)
- ✅ Stale port file detection and cleanup
- ✅ 40+ actions in `act` tool (click, navigate, cookies, storage, network intercept...)

### Phase 4: Security Layer ✅
- ✅ Credential Vault (electron.safeStorage → OS Keychain)
- ✅ Redactor (credit cards, SSN, JWT, API keys, private keys, Bearer tokens)
- ✅ Permission Gates (AUTO/NOTIFY/CONFIRM/BLOCKED levels)
- ✅ Anti-Prompt-Injection (content boundaries, pattern detection)
- ✅ Audit Log (in-memory)

### Phase 5: CAPTCHA Detection ✅ (partial)
- ✅ CAPTCHA detector (reCAPTCHA, hCaptcha, Turnstile)
- ✅ Strategy selector (priority chain)
- ✅ Text solver (OCR)
- ✅ Slider solver (human-like mouse simulation)
- ✅ Audio solver scaffold (Whisper — files exist, not fully integrated)

### Phase 6: Polish & Distribution ✅ (partial)
- ✅ macOS DMG build (arm64)
- ✅ Website (getoculo.com landing page)
- ✅ New Tab page, History, Bookmarks, Downloads, Find in Page
- ✅ Settings panel (providers, security, about)
- ✅ Reader mode, Split view, Command palette
- ✅ Built-in AI chat panel (Claude, OpenAI, Gemini, Grok, OpenClaw)
- ✅ Media generation (Nano Banana / DALL-E 3 / Stability AI / Veo 3.1)
- ✅ Anti-bot fingerprinting (navigator, WebGL, chrome object spoofing)

---

## Current Session

- ✅ Fix failing media tool test (substring window 1000→2000)
- ✅ Fix MCP bridge: static tool definitions so tools always discoverable
- ✅ Fix MCP bridge: stale port file detection + cleanup
- ✅ Update todo.md to reflect actual shipped state
- ⬜ Commit all changes
- ⬜ Build new DMG

---

## Backlog — Short Term

### MCP Improvements
- ⬜ Test MCP tools end-to-end with Oculo running
- ⬜ Add `initialize` method to bridge for MCP protocol compliance
- ⬜ Better error messages when tool execution times out

### Build & Distribution
- ⬜ Windows build (NSIS installer)
- ⬜ Linux build (AppImage + deb)
- ⬜ macOS universal binary (x64 + arm64)
- ⬜ Configure GoDaddy DNS for getoculo.com (4 A records + CNAME)
- ⬜ Update public repo release with latest DMG

### Code Quality
- ⬜ ESLint + Prettier configuration
- ⬜ Typecheck cleanup (npm run typecheck)
- ⬜ Refactor App.tsx (2,646 lines — split into smaller components)
- ⬜ Refactor agent.ts (1,437 lines — extract provider logic)

---

## Backlog — Medium Term

### Security
- ⬜ Apple Developer account renewal ($99/yr) — needed for notarization + passkey
- ⬜ Touch ID for CONFIRM-level permissions
- ⬜ TOTP / 2FA vault support
- ⬜ Migrate audit log from in-memory to SQLite
- ⬜ Domain-based permission overrides (banking sites always CONFIRM)

### CAPTCHA
- ⬜ Whisper model integration (download + transcription pipeline)
- ⬜ Claude Vision fallback for image CAPTCHAs
- ⬜ Pipeline auto-pause/resume around CAPTCHAs

### Features
- ⬜ Auto-updater (electron-updater, GitHub Releases)
- ⬜ CI/CD with GitHub Actions
- ⬜ npm package publication (`npm install -g oculo`)
- ⬜ Chrome/Firefox password import (CSV)
- ⬜ Extension support (basic manifest v3)

---

## Milestone Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Foundation — working browser app | ✅ Shipped |
| Phase 2 | Intelligence — page understanding engine | ✅ Shipped |
| Phase 3 | MCP — Claude Code integration | ✅ Shipped |
| Phase 4 | Security — vault, redaction, permissions | ✅ Shipped |
| Phase 5 | CAPTCHA — autonomous solving | 🔄 Partial |
| Phase 6 | Polish — packaging and distribution | 🔄 Partial |
