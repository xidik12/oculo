# Oculo — Development Todo

> Track: ⬜ todo | 🔄 in progress | ✅ done | ❌ blocked

---

## Phase 1: Foundation (Core Browser App)

### 1.1 Project Setup
- ⬜ Initialize git repo
- ⬜ Create package.json with project metadata (name: oculo, author, license: MIT)
- ⬜ Setup pnpm workspace
- ⬜ Configure TypeScript (tsconfig.json — strict, ESM, paths)
- ⬜ Setup Electron 34+ with electron-builder
- ⬜ Configure electron-vite for fast dev builds
- ⬜ Setup ESLint + Prettier
- ⬜ Create .gitignore (node_modules, dist, out, models/)
- ⬜ Create CLAUDE.md with project conventions

### 1.2 Main Process
- ⬜ Create main/index.ts — app entry point, single instance lock
- ⬜ Create main/browser-window.ts — BrowserWindow with webview preferences
- ⬜ Create main/menu.ts — native macOS menu (File, Edit, View, Window, Help)
- ⬜ Create main/tray.ts — system tray with status icon
- ⬜ Create main/ipc.ts — IPC channel setup (main ↔ renderer)

### 1.3 Renderer (Browser UI)
- ⬜ Setup React 19 + Tailwind CSS in renderer
- ⬜ Create renderer/App.tsx — root component with layout
- ⬜ Create TabBar.tsx — tab management (new tab, close, switch, drag-reorder)
- ⬜ Create AddressBar.tsx — URL input, back/forward/refresh buttons, SSL indicator
- ⬜ Create WebView.tsx — <webview> tag wrapper with event handlers
- ⬜ Create StatusBar.tsx — MCP connection status, page load progress
- ⬜ Wire up navigation: URL bar → webview.loadURL()
- ⬜ Wire up tab lifecycle: new tab, close tab, switch tab
- ⬜ Wire up back/forward/refresh buttons to webview
- ⬜ Handle webview events: did-navigate, page-title-updated, did-fail-load
- ⬜ Handle new-window event (open in new tab or external browser)
- ⬜ Handle download events
- ⬜ Keyboard shortcuts: Cmd+T (new tab), Cmd+W (close tab), Cmd+L (focus URL), Cmd+R (reload)
- ⬜ Basic dark/light theme based on system preference

### 1.4 Preload Scripts
- ⬜ Create preload/index.ts — contextBridge API for renderer
- ⬜ Create preload/webview-preload.ts — script injected into web pages (for engine)
- ⬜ Expose safe IPC methods via contextBridge

### 1.5 Shared Types
- ⬜ Create shared/types.ts — Tab, Page, Action, FormField, PipelineStep, etc.
- ⬜ Create shared/constants.ts — default viewport, app name, version
- ⬜ Create shared/ipc-channels.ts — typed IPC channel names

### 1.6 Phase 1 Verification
- ⬜ App launches and shows a browser window
- ⬜ Can navigate to any URL
- ⬜ Tabs work (open, close, switch)
- ⬜ Back/forward/refresh work
- ⬜ Address bar shows current URL and updates on navigation
- ⬜ Page titles show in tabs
- ⬜ Keyboard shortcuts work
- ⬜ No Electron security warnings in console

---

## Phase 2: Page Intelligence Engine

### 2.1 Smart Describer
- ⬜ Create engine/describer.ts
- ⬜ Implement page summary extraction via webview.executeJavaScript()
- ⬜ Extract: URL, title, meta description
- ⬜ Extract: heading hierarchy (h1, h2, h3 — text only)
- ⬜ Extract: form fields (label, type, value, required, placeholder)
- ⬜ Extract: buttons (text, type, disabled state)
- ⬜ Extract: links (text, href — main nav only, skip footer/sidebar)
- ⬜ Extract: images with alt text (main content only)
- ⬜ Format output as compact text (target: 30-80 tokens)
- ⬜ Implement scope parameter (CSS selector to narrow extraction)
- ⬜ Implement include filter (only return requested categories)
- ⬜ Password fields always show "***" in output
- ⬜ Test on 10+ real websites for output quality

### 2.2 Element Resolver
- ⬜ Create engine/resolver.ts
- ⬜ Implement resolution chain:
  - ⬜ By visible text (case-insensitive, partial match)
  - ⬜ By ARIA role + accessible name
  - ⬜ By associated label (for/id association, wrapping label)
  - ⬜ By placeholder text
  - ⬜ By CSS selector (fallback)
  - ⬜ By nth match (when multiple matches)
- ⬜ Implement fuzzy matching for text resolution (Levenshtein distance)
- ⬜ Return helpful error when element not found:
  "Could not find 'Submit'. Similar: [Sign Up] [Send] [Continue]"
- ⬜ Handle dynamic elements (wait up to 3s for element to appear)
- ⬜ All resolution runs via executeJavaScript() in webview — no MCP tokens
- ⬜ Test resolution on complex forms (10+ test pages)

### 2.3 Form Detector
- ⬜ Create engine/form-detector.ts
- ⬜ Scan page for all <form> elements
- ⬜ For each form, extract:
  - ⬜ All input fields with labels (by for/id, wrapping, aria-label, placeholder)
  - ⬜ Field types (text, email, password, checkbox, radio, select, textarea)
  - ⬜ Current values (redacted for password type)
  - ⬜ Required/optional status
  - ⬜ Select/dropdown options
  - ⬜ Submit button text
- ⬜ Handle forms without <form> tags (common in SPAs)
- ⬜ Label-to-field mapping for the `fill` tool
- ⬜ Test on: login forms, registration forms, search bars, checkout forms

### 2.4 Action Mapper
- ⬜ Create engine/action-mapper.ts
- ⬜ Scan page for interactive elements:
  - ⬜ Buttons (text, enabled/disabled)
  - ⬜ Links (text, distinguishing nav vs content)
  - ⬜ Inputs (label, type)
  - ⬜ Menus/dropdowns (if visible)
- ⬜ Group by page region (header, main, footer, sidebar)
- ⬜ Compact output format: "[Nav: Home, About, Contact] [Main: Search, Filter] [Actions: Add to Cart, Buy Now]"

### 2.5 Data Extractor
- ⬜ Create engine/extractor.ts
- ⬜ Identify repeated patterns on page (list items, table rows, cards)
- ⬜ Auto-detect data structure:
  - ⬜ Table → extract rows with column headers
  - ⬜ List → extract items with sub-fields
  - ⬜ Cards → extract title, description, metadata
- ⬜ Support scope parameter (CSS selector)
- ⬜ Support limit parameter (max items)
- ⬜ Support field extraction (extract specific named fields)
- ⬜ Handle pagination hints ("Page 1 of 5", "Next" button exists)
- ⬜ Test on: search results, product listings, email inboxes, data tables

### 2.6 Pipeline Runner
- ⬜ Create engine/pipeline.ts
- ⬜ Sequential step execution with error handling
- ⬜ Step types: page, act, fill, read, wait, if/else
- ⬜ Wait step: wait for text, URL, or selector with timeout
- ⬜ Conditional step: if text/URL exists, execute then/else
- ⬜ Return results from last step by default
- ⬜ Optional returnAll for all step results
- ⬜ Partial results on failure: "Pipeline stopped at step 3/5"
- ⬜ Auto-wait between navigation and interaction steps (smart delays)
- ⬜ Test multi-step flows on 5+ real websites

### 2.7 Phase 2 Verification
- ⬜ Smart Describer produces <80 token descriptions for any page
- ⬜ Element Resolver finds correct elements >95% of the time
- ⬜ Form Detector maps all fields correctly on common form types
- ⬜ Data Extractor pulls structured data from lists/tables
- ⬜ Pipeline runs multi-step flows end-to-end

---

## Phase 3: MCP Server

### 3.1 Server Setup
- ⬜ Install @modelcontextprotocol/sdk
- ⬜ Create mcp/server.ts — MCP server with stdio transport
- ⬜ Wire MCP server to Electron main process
- ⬜ Auto-start MCP server when browser launches
- ⬜ Handle stdio communication (stdin/stdout)
- ⬜ Implement server info (name: "oculo", version)
- ⬜ Test: Claude Code can connect via `claude mcp add oculo -- oculo --mcp-only`

### 3.2 Tool Schemas
- ⬜ Create mcp/schemas.ts with Zod schemas for all 5 tools
- ⬜ Schema: page (scope?, include?, screenshot?)
- ⬜ Schema: act (action, targeting, options)
- ⬜ Schema: fill (fields, submit?, screenshot?)
- ⬜ Schema: read (what, scope?, fields?, limit?, format?)
- ⬜ Schema: run (steps[], returnAll?)
- ⬜ Keep schemas minimal — target <200 tokens total for all tool definitions

### 3.3 Tool Handlers
- ⬜ Create mcp/tools/page.ts
  - ⬜ Calls Smart Describer via IPC to webview
  - ⬜ Returns compact page description
  - ⬜ Optional screenshot attachment
- ⬜ Create mcp/tools/act.ts
  - ⬜ Resolves target element via Element Resolver
  - ⬜ Executes action (click, navigate, scroll, press, hover, login)
  - ⬜ Returns one-line confirmation with URL/title
  - ⬜ For login: uses Credential Vault
- ⬜ Create mcp/tools/fill.ts
  - ⬜ Calls Form Detector to map fields
  - ⬜ Fills each field using label matching
  - ⬜ Handles text, select, checkbox, radio, textarea
  - ⬜ Optional auto-submit
  - ⬜ Returns: "Filled X/Y fields. [Submitted.]"
- ⬜ Create mcp/tools/read.ts
  - ⬜ Calls Data Extractor
  - ⬜ Returns structured data in compact format
  - ⬜ Respects limit and format parameters
- ⬜ Create mcp/tools/run.ts
  - ⬜ Calls Pipeline Runner
  - ⬜ Executes steps sequentially
  - ⬜ Returns aggregated results

### 3.4 MCP Response Format
- ⬜ All responses include URL + title as header
- ⬜ All responses pass through Redaction Engine
- ⬜ All responses are compact (no unnecessary whitespace, headers)
- ⬜ Error responses include helpful context, not stack traces

### 3.5 Phase 3 Verification
- ⬜ Claude Code connects to Oculo MCP server
- ⬜ `page` tool returns <80 token descriptions
- ⬜ `act` tool clicks/navigates by text/role without snapshots
- ⬜ `fill` tool fills forms by label
- ⬜ `read` tool extracts structured data
- ⬜ `run` tool executes multi-step pipelines
- ⬜ PharmKulen search flow works in <300 tokens total
- ⬜ No credentials appear in any MCP response

---

## Phase 4: Security Layer

### 4.1 Credential Vault
- ⬜ Create security/vault.ts
- ⬜ Use electron.safeStorage for encryption (OS Keychain backend)
- ⬜ Implement: addCredential(domain, username, password)
- ⬜ Implement: getCredential(domain) — returns { username, password }
- ⬜ Implement: deleteCredential(domain)
- ⬜ Implement: listCredentials() — returns domains only, no passwords
- ⬜ Store encrypted credentials in app data directory
- ⬜ Implement auto-fill on login pages (detect login forms, offer to save)
- ⬜ Create VaultManager.tsx UI — list saved sites, add/edit/delete
- ⬜ Import from Chrome/Firefox password export (CSV)
- ⬜ TOTP support for 2FA codes
- ⬜ Test: MCP login action uses vault, password never in response

### 4.2 Redaction Engine
- ⬜ Create security/redactor.ts
- ⬜ Implement field-level redaction (password inputs → "***")
- ⬜ Implement pattern-based redaction:
  - ⬜ Credit card numbers
  - ⬜ SSN patterns
  - ⬜ JWT tokens
  - ⬜ API keys (common patterns)
  - ⬜ Private keys (PEM format)
  - ⬜ Bearer tokens
- ⬜ Implement header redaction (Set-Cookie, Authorization)
- ⬜ Support custom user-defined redaction patterns
- ⬜ Wire into all MCP response paths
- ⬜ Test: no sensitive data leaks through any MCP tool

### 4.3 Permission Gates
- ⬜ Create security/permissions.ts
- ⬜ Define permission levels: AUTO, NOTIFY, CONFIRM, BLOCKED
- ⬜ Categorize all possible actions into permission levels
- ⬜ Implement NOTIFY: show native OS notification for action
- ⬜ Implement CONFIRM: show native dialog with action description
- ⬜ Integrate Touch ID / biometric for CONFIRM actions (electron Touch ID API)
- ⬜ Implement BLOCKED: reject with clear error message
- ⬜ Create PermissionDialog.tsx — native-looking confirm dialog
- ⬜ Settings UI for customizing permission levels per action
- ⬜ Domain-based overrides (e.g., always CONFIRM for banking sites)
- ⬜ Test: payment actions require Touch ID, blocked actions are rejected

### 4.4 Anti-Prompt-Injection
- ⬜ Create security/anti-injection.ts
- ⬜ Implement content boundary markers in all page content responses
- ⬜ Strip hidden elements before extracting page content:
  - ⬜ display: none
  - ⬜ visibility: hidden
  - ⬜ opacity: 0
  - ⬜ Off-screen positioned elements
  - ⬜ Zero-size elements
  - ⬜ aria-hidden="true"
- ⬜ Scan extracted text for injection patterns
- ⬜ Flag suspicious content with warning prefix
- ⬜ Test with known prompt injection payloads

### 4.5 Audit Log
- ⬜ Create security/audit.ts
- ⬜ Setup encrypted SQLite database (better-sqlite3 + safeStorage)
- ⬜ Log every MCP action with timestamp, type, target, result
- ⬜ Never log sensitive values (passwords, tokens)
- ⬜ Create AuditViewer.tsx — searchable/filterable log view
- ⬜ 30-day retention with configurable setting
- ⬜ JSON export for review

### 4.6 Phase 4 Verification
- ⬜ Vault stores and retrieves credentials securely
- ⬜ Passwords never appear in any MCP communication
- ⬜ Credit cards, tokens, keys are redacted
- ⬜ Sensitive actions require confirmation
- ⬜ Hidden DOM elements are stripped
- ⬜ Prompt injection payloads are flagged
- ⬜ All actions are audit logged

---

## Phase 5: CAPTCHA Engine

### 5.1 CAPTCHA Detector
- ⬜ Create captcha/detector.ts
- ⬜ Implement DOM observer for CAPTCHA iframes/elements
- ⬜ Detect reCAPTCHA v2 (iframe src, .g-recaptcha class)
- ⬜ Detect reCAPTCHA v3 (invisible, no action needed)
- ⬜ Detect hCaptcha (iframe src, .h-captcha class)
- ⬜ Detect Cloudflare Turnstile (cf-turnstile class)
- ⬜ Detect generic CAPTCHAs (#captcha, .captcha, img[alt*="captcha"])
- ⬜ Classify CAPTCHA type for strategy selection
- ⬜ Use MutationObserver for dynamic CAPTCHA injection

### 5.2 Audio Solver (Whisper)
- ⬜ Create captcha/whisper.ts
- ⬜ Integrate whisper.cpp Node.js bindings (or whisper-node)
- ⬜ Implement model download script (scripts/download-whisper.ts)
  - ⬜ Download whisper-small model on first CAPTCHA encounter
  - ⬜ Store in ~/.oculo/models/
  - ⬜ Progress bar in browser UI
- ⬜ Create captcha/audio-solver.ts
- ⬜ Implement reCAPTCHA audio flow:
  - ⬜ Click "Audio" button in CAPTCHA iframe
  - ⬜ Wait for audio challenge to load
  - ⬜ Download audio file
  - ⬜ Transcribe with Whisper
  - ⬜ Type transcription into input
  - ⬜ Submit
- ⬜ Implement hCaptcha audio flow (similar)
- ⬜ Handle retry on wrong answer
- ⬜ Test on live reCAPTCHA and hCaptcha

### 5.3 Other Solvers
- ⬜ Create captcha/text-solver.ts — OCR for text/math CAPTCHAs
- ⬜ Create captcha/slider-solver.ts — human-like mouse drag simulation
  - ⬜ Bezier curve path generation
  - ⬜ Variable speed (acceleration/deceleration)
  - ⬜ Small random overshoot + correction
- ⬜ Create captcha/image-solver.ts — Claude vision fallback
  - ⬜ Screenshot only the CAPTCHA grid (small crop)
  - ⬜ Send to Claude via MCP response: "CAPTCHA: select [target]"
  - ⬜ Parse Claude's response and click squares
  - ⬜ Only used when audio unavailable

### 5.4 Strategy Selector
- ⬜ Create captcha/strategy.ts
- ⬜ Implement priority chain:
  1. Invisible → skip (real browser passes)
  2. Text/Math → local OCR
  3. Slider → mouse simulation
  4. Audio → Whisper
  5. Image → Claude vision
  6. Unknown → notify user
- ⬜ Retry logic: if strategy fails, try next in chain
- ⬜ Max 3 attempts before asking user
- ⬜ Integrate with Pipeline Runner (pause pipeline on CAPTCHA, resume after solved)

### 5.5 Phase 5 Verification
- ⬜ Invisible CAPTCHAs (Turnstile, reCAPTCHA v3) pass automatically
- ⬜ Audio CAPTCHAs solved via Whisper in <5 seconds
- ⬜ Slider CAPTCHAs solved with human-like movement
- ⬜ CAPTCHA solving is transparent to Claude (0 tokens in most cases)
- ⬜ Fallback chain works (audio → image → user)
- ⬜ Pipeline pauses and resumes around CAPTCHAs

---

## Phase 6: Polish & Distribution

### 6.1 Branding
- ⬜ Design app icon (eye/vision motif, clean, modern)
- ⬜ Create icns (macOS), ico (Windows), png (Linux) icon sets
- ⬜ Tray icon (light + dark variants)
- ⬜ Splash screen (shown during app startup)
- ⬜ About dialog with version and credits

### 6.2 UI Polish
- ⬜ Dark/light theme toggle (system preference + manual)
- ⬜ Settings page:
  - ⬜ General (default search engine, home page, startup behavior)
  - ⬜ Passwords (vault manager)
  - ⬜ Security (permissions, redaction patterns, audit log)
  - ⬜ CAPTCHA (Whisper model, strategy preferences)
  - ⬜ MCP (connection status, tool usage stats, token counter)
  - ⬜ About
- ⬜ New Tab page (favorites, recent, search)
- ⬜ History viewer
- ⬜ Bookmarks bar + manager
- ⬜ Find in page (Cmd+F)
- ⬜ Zoom controls
- ⬜ DevTools toggle (Cmd+Option+I)

### 6.3 Packaging
- ⬜ Configure electron-builder.yml:
  - ⬜ macOS: DMG + zip (universal binary: x64 + arm64)
  - ⬜ Windows: NSIS installer + portable
  - ⬜ Linux: AppImage + deb + rpm
- ⬜ Code signing (macOS: Developer ID, Windows: Authenticode)
- ⬜ Notarization (macOS)
- ⬜ Auto-updater (electron-updater, GitHub Releases)

### 6.4 npm Distribution
- ⬜ Create bin/oculo.js CLI entry point
- ⬜ package.json bin field: { "oculo": "./bin/oculo.js" }
- ⬜ Handle `oculo --mcp-only` for MCP-only mode (no GUI)
- ⬜ Handle `oculo --version`, `oculo --help`
- ⬜ Publish to npm: `npm publish`
- ⬜ Test: `npx oculo` launches correctly

### 6.5 Documentation
- ⬜ README.md: overview, install, quick start, screenshots
- ⬜ docs/api.md: MCP tool API reference
- ⬜ docs/security.md: security model documentation
- ⬜ docs/contributing.md: contribution guidelines
- ⬜ LICENSE (MIT)

### 6.6 Phase 6 Verification
- ⬜ App installs and launches on macOS (Intel + Apple Silicon)
- ⬜ `npm install -g oculo` works
- ⬜ `npx oculo` works
- ⬜ Claude Code connects and all 5 tools work
- ⬜ Auto-updater works
- ⬜ Settings persist across restarts
- ⬜ No security warnings or console errors

---

## Milestone Targets

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Foundation — working browser app | ⬜ |
| Phase 2 | Intelligence — page understanding engine | ⬜ |
| Phase 3 | MCP — Claude Code integration | ⬜ |
| Phase 4 | Security — vault, redaction, permissions | ⬜ |
| Phase 5 | CAPTCHA — autonomous solving | ⬜ |
| Phase 6 | Polish — packaging and distribution | ⬜ |

---

## Definition of Done (MVP)

The MVP is complete when:
1. User can install with `npm install -g oculo` and launch with `oculo`
2. A real browser window opens with tabs, address bar, navigation
3. Claude Code can connect via `claude mcp add oculo`
4. Claude can describe any page in <80 tokens
5. Claude can click, type, fill forms without ever seeing the DOM
6. Credentials are stored in OS Keychain and never exposed to Claude
7. CAPTCHAs are solved autonomously (audio + Whisper)
8. All MCP responses are redacted for sensitive data
9. Sensitive actions require user confirmation
10. Every action is audit logged locally
