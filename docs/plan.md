# Oculo — AI-Powered Native Browser

> *Latin: "to see, to give sight"*
> The browser that gives AI vision.

## Product Vision

Oculo is a native desktop browser with a built-in MCP server that lets Claude Code (or any MCP-compatible AI) see, understand, and interact with the web. Like Cursor is to VS Code, Oculo is to Chrome — an AI-native browser.

**Key Differentiators:**
- AI never sees raw DOM/snapshots — the browser describes pages in 30-50 tokens
- Credentials never leave the device — vault-based auth, Claude says "login" not passwords
- CAPTCHA solved autonomously — audio+Whisper on-device, zero tokens
- 5 MCP tools instead of 36 — ~99% token reduction vs current approaches
- Installable via `npm install -g oculo` — one command, ready to use
- Open source, permissively licensed, fully commercializable

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 Oculo Browser                    │
│                                                  │
│  ┌───────────────────────────────────────────┐   │
│  │          Electron + Chromium               │   │
│  │     (real browser, tabs, bookmarks)        │   │
│  └──────────────┬────────────────────────────┘   │
│                 │                                 │
│  ┌──────────────▼────────────────────────────┐   │
│  │       Page Intelligence Engine (Local)     │   │
│  │                                            │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Smart Describer                      │  │   │
│  │  │ Generates 30-50 token page summaries │  │   │
│  │  │ Runs in V8, zero tokens              │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Element Resolver                     │  │   │
│  │  │ Finds elements by text/role/label    │  │   │
│  │  │ No refs needed, no snapshots         │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Form Detector                        │  │   │
│  │  │ Identifies all fields + labels       │  │   │
│  │  │ Maps field names for fill_form       │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Action Mapper                        │  │   │
│  │  │ Lists clickable/interactive elements │  │   │
│  │  │ Groups by semantic meaning           │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  └──────────────┬────────────────────────────┘   │
│                 │                                 │
│  ┌──────────────▼────────────────────────────┐   │
│  │       Security Layer                       │   │
│  │                                            │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Credential Vault                     │  │   │
│  │  │ macOS Keychain / OS secure store     │  │   │
│  │  │ AES-256, biometric unlock            │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Redaction Engine                     │  │   │
│  │  │ Strips passwords, tokens, cards      │  │   │
│  │  │ from ALL MCP responses               │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Permission Gates                     │  │   │
│  │  │ AUTO / NOTIFY / CONFIRM / BLOCKED    │  │   │
│  │  │ Touch ID for sensitive actions       │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Anti-Injection                       │  │   │
│  │  │ Content boundaries, hidden stripping │  │   │
│  │  │ Instruction detection                │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │ Audit Log                            │  │   │
│  │  │ Encrypted, local, every action       │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  └──────────────┬────────────────────────────┘   │
│                 │                                 │
│  ┌──────────────▼────────────────────────────┐   │
│  │       CAPTCHA Engine (Local)               │   │
│  │                                            │   │
│  │  Detector → Strategy Selector → Solver     │   │
│  │  • Invisible: auto-pass (real browser)     │   │
│  │  • Audio: Whisper MLX (on-device, 0 tok)   │   │
│  │  • Image: Claude vision (fallback, rare)   │   │
│  │  • Text/Math: local OCR                    │   │
│  │  • Slider: human-like mouse simulation     │   │
│  └──────────────┬────────────────────────────┘   │
│                 │                                 │
│  ┌──────────────▼────────────────────────────┐   │
│  │       MCP Server (5 tools, stdio)          │   │
│  │                                            │   │
│  │  page  — describe current page (~30 tok)   │   │
│  │  act   — perform action by intent          │   │
│  │  fill  — fill form fields by label         │   │
│  │  read  — extract structured data           │   │
│  │  run   — multi-step pipeline               │   │
│  │                                            │   │
│  │  (screenshot as optional param on any tool)│   │
│  └──────────────┬────────────────────────────┘   │
│                 │ stdio                           │
└─────────────────┼───────────────────────────────┘
                  │
       ┌──────────▼──────────┐
       │   Claude Code CLI   │
       │   (or any MCP       │
       │    compatible AI)   │
       └─────────────────────┘
```

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Desktop Shell | Electron 34+ | Chromium-based, mature, huge ecosystem |
| Browser Engine | Chromium (via Electron) | Real browser, no automation flags |
| Language | TypeScript | Type safety, matches Claude Code ecosystem |
| MCP Server | @modelcontextprotocol/sdk | Official MCP SDK, stdio transport |
| Credential Store | keytar / electron-safeStorage | OS-native encryption (Keychain/DPAPI) |
| CAPTCHA Audio | whisper.cpp / whisper-node | Local Whisper, no API calls |
| Build Tool | electron-builder | Cross-platform packaging |
| Package Manager | pnpm | Fast, disk efficient |
| Monorepo | Turborepo | Parallel builds |

---

## MCP Tool API — Complete Specification

### Tool 1: `page`
**Purpose:** Describe current page in minimal tokens.
**When to use:** When Claude needs to understand what's on screen.

```typescript
// Request
{
  scope?: string       // CSS selector to scope description
  include?: string[]   // what to include: "forms", "buttons", "links", "headings", "text", "images"
  screenshot?: boolean // attach screenshot (default: false)
}

// Response (typical ~30-80 tokens)
"Login Page | https://gmail.com/signin

 Forms: email (text, empty), password (password, empty), remember-me (checkbox, unchecked)
 Buttons: [Next] [Create account] [Forgot email?]
 Links: Privacy, Terms, Help"
```

**How it works internally:**
1. Runs JavaScript in the page's V8 context
2. Collects: URL, title, headings, form fields (label + type + value), buttons (text), links (text)
3. Formats as compact text
4. Redacts any sensitive field values (password fields always show "***")
5. Returns. Zero external API calls.

### Tool 2: `act`
**Purpose:** Perform a single action on the page by intent.
**When to use:** Click something, press a key, scroll, navigate.

```typescript
// Request
{
  // What to do
  action: "click" | "navigate" | "back" | "forward" | "scroll" | "press" | "hover" | "select" | "login"

  // Element targeting (for click/hover/select) — server resolves these
  text?: string           // visible text on the element
  role?: string           // ARIA role (button, link, textbox, etc.)
  name?: string           // accessible name
  label?: string          // associated label text
  placeholder?: string    // placeholder text
  selector?: string       // CSS selector (fallback)
  nth?: number            // which match (0-indexed, default 0)

  // Action-specific
  url?: string            // for navigate
  direction?: string      // for scroll: up/down/left/right
  amount?: number         // for scroll: pixels
  key?: string            // for press: Enter, Tab, Escape, etc.
  modifiers?: string[]    // Ctrl, Shift, Alt, Meta
  site?: string           // for login: which site to login to (uses vault)

  // Options
  screenshot?: boolean    // attach screenshot after action
}

// Response (typical ~10-20 tokens)
"Clicked button 'Next'. Page changed → Inbox (47 unread)"
```

**Server-side element resolution flow:**
```
Claude says: act({ action: "click", text: "Sign In" })

Server internally:
  1. page.getByText("Sign In", { exact: false })      → found? click it
  2. page.getByRole("button", { name: "Sign In" })    → fallback
  3. page.getByRole("link", { name: "Sign In" })      → fallback
  4. page.locator("text=Sign In")                      → fallback
  5. If none found → return error with nearby elements:
     "Could not find 'Sign In'. Similar: [Log In] [Sign Up] [Register]"
     (helpful error, ~20 tokens, no full snapshot needed)
```

### Tool 3: `fill`
**Purpose:** Fill multiple form fields at once by label/name.
**When to use:** Registration forms, search forms, any multi-field input.

```typescript
// Request
{
  fields: Record<string, string | boolean>  // label → value
  submit?: boolean | string                  // auto-submit: true clicks first submit button, string clicks by text
  screenshot?: boolean
}

// Example
{
  fields: {
    "First Name": "John",
    "Last Name": "Doe",
    "Email": "john@example.com",
    "Country": "Cambodia",
    "I agree to terms": true
  },
  submit: "Register"
}

// Response (~15 tokens)
"Filled 5/5 fields. Clicked 'Register'. Page changed → Welcome, John!"
```

**How field matching works internally:**
```
For each field label:
  1. page.getByLabel(label)              → exact label match
  2. page.getByPlaceholder(label)        → placeholder match
  3. page.locator(`[name*="${label}"]`)   → name attribute contains
  4. page.locator(`[id*="${label}"]`)     → id attribute contains
  5. Fuzzy: find closest label by Levenshtein distance

For boolean values (checkboxes):
  - true → check if unchecked
  - false → uncheck if checked

For select/dropdown values:
  - Auto-detected by element type
  - Selects option by visible text
```

### Tool 4: `read`
**Purpose:** Extract structured data from the page.
**When to use:** Reading search results, tables, lists, articles, emails.

```typescript
// Request
{
  what: string            // natural description: "search results", "email list", "product details"
  scope?: string          // CSS selector to narrow scope
  fields?: string[]       // specific fields to extract
  limit?: number          // max items (default: 10)
  format?: "text" | "json" // output format (default: text)
}

// Example
{ what: "search results", limit: 5 }

// Response (~100 tokens)
"5 results:
 1. Ibuprofen 200 | Mongkul Pharmacy | 2.5km | In stock | $1.20
 2. Ibuprofen 8mg | Mongkul Pharmacy | 2.5km | In stock | $0.80
 3. Ibuprofen Denk 400 | Rotha 2 | 7.3km | In stock | $2.50
 4. AdvilMed 400mg | Care Pharmacy | 1.7km | In stock | $3.00
 5. Alaxan FR | Care Pharmacy | 1.7km | In stock | $1.50"
```

**How it works internally:**
1. If `scope` provided, narrow DOM to that subtree
2. If not, use heuristics to find the "main content" area
3. Identify repeated patterns (list items, table rows, cards)
4. Extract text content from each item
5. If `fields` specified, extract matching data points
6. Format compactly and return
7. All processing happens in-page JavaScript, zero tokens

### Tool 5: `run`
**Purpose:** Execute a multi-step pipeline in one call.
**When to use:** Complex flows that would need multiple tool calls.

```typescript
// Request
{
  steps: Array<{
    // Any action from the other tools
    page?: object        // describe page
    act?: object         // perform action
    fill?: object        // fill form
    read?: object        // extract data
    wait?: {             // wait for condition
      text?: string      // wait for text to appear
      url?: string       // wait for URL pattern
      selector?: string  // wait for element
      timeout?: number   // max wait ms (default: 5000)
    }
    if?: {               // conditional step
      text?: string      // if text exists on page
      url?: string       // if URL matches
      then: object       // step to execute if true
      else?: object      // step to execute if false
    }
  }>
  returnAll?: boolean    // return results from all steps (default: false, returns last only)
}

// Example: Search PharmKulen
{
  steps: [
    { act: { action: "navigate", url: "https://pharmkulen.com" } },
    { fill: { fields: { "Search for medicines": "Ibuprofen" } } },
    { act: { action: "click", text: "Search" } },
    { wait: { text: "In stock" } },
    { read: { what: "search results", limit: 5 } }
  ]
}

// Response (~120 tokens)
"Pipeline 5/5 OK
 [URL: https://pharmkulen.com]

 5 results:
 1. Ibuprofen 200 | Mongkul Pharmacy | 2.5km | In stock
 2. Ibuprofen 8mg | Mongkul Pharmacy | 2.5km | In stock
 3. Ibuprofen Denk 400 | Rotha 2 | 7.3km | In stock
 4. AdvilMed 400mg | Care Pharmacy | 1.7km | In stock
 5. Alaxan FR | Care Pharmacy | 1.7km | In stock"
```

---

## Security Model — Complete Specification

### Credential Vault

**Storage:** macOS Keychain via `electron.safeStorage` API
- Encrypts data with OS-level encryption (AES-256)
- Locked behind user's login password / Touch ID
- Never stored in plaintext anywhere
- No way for MCP tools to read vault contents

**Schema:**
```typescript
interface VaultEntry {
  id: string
  domain: string           // e.g., "gmail.com"
  username: string         // shown to Claude (not sensitive)
  password: string         // NEVER shown to Claude
  totp_secret?: string     // for 2FA
  notes?: string
  created: Date
  updated: Date
}
```

**MCP Interaction:**
- Claude can call: `act({ action: "login", site: "gmail.com" })`
- Browser looks up vault, fills credentials, submits
- Response: `"Logged in to gmail.com as john@example.com"`
- Password never appears in any MCP request or response

**Vault Management:**
- User manages vault through browser's UI (not through Claude)
- Settings → Passwords → Add/Edit/Delete
- Import from Chrome/Firefox/1Password/Bitwarden
- Export encrypted backup

### Redaction Engine

**Runs on every MCP response before it reaches Claude:**

```typescript
interface RedactionRules {
  // Field-level redaction (DOM-aware)
  passwordFields: true           // input[type="password"] values → "***"
  hiddenFields: true             // input[type="hidden"] values → "[HIDDEN]"

  // Pattern-based redaction
  creditCards: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g
  jwt: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/g
  apiKeys: /(?:api[_-]?key|token|secret|password|auth)["\s:=]+["']?([a-zA-Z0-9_\-]{20,})["']?/gi
  privateKeys: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END/g

  // Header redaction
  cookies: true                  // Set-Cookie values → "[REDACTED]"
  authorization: true            // Authorization header values → "[REDACTED]"

  // Custom user-defined patterns
  customPatterns: RegExp[]
}
```

### Permission Gates

```typescript
interface PermissionConfig {
  // GREEN: Auto-allowed, no confirmation
  auto: [
    "navigate",
    "read_page",
    "extract_data",
    "fill_search_forms",
    "click_links",
    "scroll",
    "screenshot",
    "back_forward"
  ]

  // YELLOW: Execute but notify user via browser notification
  notify: [
    "login_saved_account",
    "post_comment",
    "send_message",
    "fill_non_sensitive_form",
    "submit_form"
  ]

  // RED: Require explicit user confirmation (native OS dialog + Touch ID)
  confirm: [
    "payment_purchase",
    "delete_account",
    "change_password",
    "send_email",
    "download_executable",
    "financial_site_action",
    "grant_permission",
    "oauth_authorize"
  ]

  // BLACK: Never allowed, even if asked
  blocked: [
    "read_vault_passwords",
    "export_cookies",
    "export_tokens",
    "disable_security",
    "execute_untrusted_scripts",
    "access_filesystem",
    "modify_browser_settings_via_mcp"
  ]
}
```

### Anti-Prompt-Injection

```typescript
interface InjectionProtection {
  // Content boundary markers
  wrapPageContent: true    // Wrap in ---UNTRUSTED PAGE CONTENT--- markers

  // DOM sanitization before describing to Claude
  stripHidden: true        // Remove display:none, visibility:hidden, opacity:0
  stripOffscreen: true     // Remove elements positioned off-screen
  stripMicroText: true     // Remove font-size:0, color matching background
  stripAriaHidden: true    // Remove aria-hidden="true" elements

  // Instruction detection
  scanForInstructions: true // Flag text containing "ignore previous", "you are now", etc.
  instructionPatterns: [
    /ignore\s+(previous|prior|above)\s+(instructions|prompt)/i,
    /you\s+are\s+now\s+(in|an?)\s+/i,
    /system\s*:\s*/i,
    /\[INST\]/i,
    /send\s+(all|every|the)\s+.*(password|credential|secret|token)/i
  ]
}
```

### Audit Log

```typescript
interface AuditEntry {
  timestamp: Date
  action: string           // "navigate", "click", "fill", "login", etc.
  target: string            // URL, element description, etc.
  result: "success" | "failed" | "blocked" | "confirmed" | "denied"
  details?: string          // Additional context
  // NEVER logs: passwords, tokens, sensitive field values
}

// Storage: encrypted SQLite in app data directory
// Retention: 30 days by default, configurable
// Access: User can view via browser Settings → Audit Log
// Export: User can export as JSON (no sensitive data included)
```

---

## CAPTCHA Engine — Complete Specification

### Detection

```typescript
interface CAPTCHADetector {
  // Monitor for CAPTCHA iframes
  watchSelectors: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="turnstile"]',
    'iframe[src*="captcha"]',
    '.g-recaptcha',
    '.h-captcha',
    '[data-sitekey]',
    '#captcha',
    '.captcha'
  ]

  // Monitor for challenge popups
  watchMutations: true     // MutationObserver on document.body

  // Identify CAPTCHA type
  identifyType(): "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "turnstile" | "text" | "math" | "slider" | "unknown"
}
```

### Strategy Selection

```
Priority order (cheapest first):

1. INVISIBLE (reCAPTCHA v3, Turnstile)
   → Do nothing. Real browser passes automatically.
   → Cost: 0 tokens, 0 seconds

2. TEXT/MATH CAPTCHA
   → Read text with local OCR, solve math
   → Cost: 0 tokens, <1 second

3. SLIDER CAPTCHA
   → Simulate human-like mouse drag
   → Bezier curve movement, random speed variation
   → Cost: 0 tokens, 1-2 seconds

4. AUDIO CAPTCHA (reCAPTCHA v2, hCaptcha)
   → Click "Audio challenge" button
   → Download audio file
   → Transcribe with Whisper (local, Apple Silicon MLX)
   → Type transcription
   → Cost: 0 tokens, 2-3 seconds

5. IMAGE CAPTCHA (fallback — only if audio unavailable)
   → Screenshot the CAPTCHA grid only (small crop)
   → Send to Claude: "Select squares containing: [target]"
   → Click identified squares
   → Cost: ~500 tokens, 3-5 seconds

6. UNSOLVABLE (last resort)
   → Show native notification: "CAPTCHA needs your help"
   → Pause automation, wait for user
   → Continue after solved
   → Cost: 0 tokens
```

### Whisper Integration

```typescript
interface WhisperConfig {
  model: "tiny" | "base" | "small" | "medium"  // default: "small"
  backend: "mlx" | "cpp" | "node"              // default: "mlx" on Apple Silicon
  modelPath: string                              // ~/.oculo/models/whisper-small.mlx
  language: "en"                                 // CAPTCHA audio is always English

  // Auto-download model on first CAPTCHA encounter
  autoDownload: true
  downloadUrl: string  // GitHub releases or HuggingFace
}
```

---

## Electron App Structure

```
oculo/
├── package.json                 # Root monorepo config
├── pnpm-workspace.yaml
├── turbo.json
├── electron-builder.yml         # Build/packaging config
│
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry point
│   │   ├── browser-window.ts    # Window management
│   │   ├── menu.ts              # App menu (File, Edit, View, etc.)
│   │   ├── tray.ts              # System tray icon
│   │   ├── ipc.ts               # IPC handlers (main ↔ renderer)
│   │   ├── updater.ts           # Auto-update (electron-updater)
│   │   │
│   │   ├── mcp/                 # MCP Server (runs in main process)
│   │   │   ├── server.ts        # MCP server setup (stdio transport)
│   │   │   ├── tools/
│   │   │   │   ├── page.ts      # page tool handler
│   │   │   │   ├── act.ts       # act tool handler
│   │   │   │   ├── fill.ts      # fill tool handler
│   │   │   │   ├── read.ts      # read tool handler
│   │   │   │   └── run.ts       # run (pipeline) tool handler
│   │   │   └── schemas.ts       # Tool schemas (Zod)
│   │   │
│   │   ├── engine/              # Page Intelligence Engine
│   │   │   ├── describer.ts     # Smart page describer (30-token summaries)
│   │   │   ├── resolver.ts      # Element resolver (text/role/label matching)
│   │   │   ├── form-detector.ts # Form field discovery
│   │   │   ├── action-mapper.ts # Interactive element mapping
│   │   │   ├── extractor.ts     # Structured data extraction
│   │   │   └── pipeline.ts      # Multi-step pipeline runner
│   │   │
│   │   ├── security/            # Security Layer
│   │   │   ├── vault.ts         # Credential vault (Keychain)
│   │   │   ├── redactor.ts      # Response redaction engine
│   │   │   ├── permissions.ts   # Permission gates
│   │   │   ├── anti-injection.ts # Prompt injection protection
│   │   │   └── audit.ts         # Audit logging
│   │   │
│   │   └── captcha/             # CAPTCHA Engine
│   │       ├── detector.ts      # CAPTCHA detection
│   │       ├── strategy.ts      # Strategy selector
│   │       ├── audio-solver.ts  # Whisper-based audio solver
│   │       ├── image-solver.ts  # Claude vision fallback
│   │       ├── text-solver.ts   # OCR text/math solver
│   │       ├── slider-solver.ts # Mouse simulation solver
│   │       └── whisper.ts       # Local Whisper bindings
│   │
│   ├── renderer/                # Electron renderer (browser UI)
│   │   ├── index.html           # Main window HTML
│   │   ├── App.tsx              # React root
│   │   ├── components/
│   │   │   ├── TabBar.tsx       # Browser tab bar
│   │   │   ├── AddressBar.tsx   # URL bar + navigation buttons
│   │   │   ├── WebView.tsx      # <webview> wrapper
│   │   │   ├── Sidebar.tsx      # Bookmarks, history, settings
│   │   │   ├── PermissionDialog.tsx  # Confirm action dialog
│   │   │   ├── VaultManager.tsx # Password management UI
│   │   │   ├── AuditViewer.tsx  # Audit log viewer
│   │   │   └── StatusBar.tsx    # MCP connection status
│   │   ├── styles/
│   │   │   └── global.css       # Tailwind CSS
│   │   └── lib/
│   │       ├── ipc.ts           # IPC client helpers
│   │       └── theme.ts         # Dark/light theme
│   │
│   ├── preload/                 # Electron preload scripts
│   │   ├── index.ts             # Main preload (contextBridge)
│   │   └── webview-preload.ts   # Injected into webview pages
│   │
│   └── shared/                  # Shared types and constants
│       ├── types.ts             # TypeScript interfaces
│       ├── constants.ts         # Config constants
│       └── ipc-channels.ts      # IPC channel names
│
├── scripts/
│   ├── download-whisper.ts      # Download Whisper model
│   └── postinstall.ts           # Post-install setup
│
├── assets/
│   ├── icons/                   # App icons (icns, ico, png)
│   ├── tray/                    # Tray icons
│   └── splash/                  # Splash screen
│
├── tests/
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # End-to-end tests
│
└── docs/
    ├── plan.md                  # This file
    ├── security.md              # Security documentation
    └── api.md                   # MCP tool API documentation
```

---

## Distribution

### npm Global Install
```bash
npm install -g oculo
oculo                           # Launches browser + MCP server
```

### npx (No Install)
```bash
npx oculo                       # Downloads and launches
```

### macOS DMG
```bash
brew install --cask oculo       # Homebrew cask
# Or download DMG from GitHub Releases
```

### Claude Code Registration
```bash
# Auto-register on first launch, or manually:
claude mcp add oculo -- oculo --mcp-only
```

### CLI Flags
```bash
oculo                           # Launch browser + MCP server
oculo --mcp-only                # MCP server only (no browser window)
oculo --headless                # Headless mode (for CI/automation)
oculo --port 3100               # Use HTTP/SSE transport instead of stdio
oculo --profile work            # Use "work" browser profile
oculo --reset                   # Reset all data
```

---

## Implementation Phases

### Phase 1: Foundation (Core Browser)
- Electron app scaffold
- Basic browser UI: tabs, address bar, back/forward, refresh
- WebView management
- Navigation, tab management
- Basic window management (minimize, maximize, close)

### Phase 2: Page Intelligence Engine
- Smart Describer (30-token page summaries)
- Element Resolver (text/role/label/placeholder matching)
- Form Detector (field discovery + label mapping)
- Action Mapper (interactive element listing)
- Data Extractor (structured data from repeated patterns)

### Phase 3: MCP Server
- MCP server setup (stdio transport)
- 5 tool implementations (page, act, fill, read, run)
- Pipeline runner for multi-step flows
- Auto-start MCP server with browser
- Claude Code registration command

### Phase 4: Security Layer
- Credential Vault (electron safeStorage + Keychain)
- Redaction Engine (pattern + DOM-aware)
- Permission Gates (AUTO/NOTIFY/CONFIRM/BLOCKED)
- Anti-Prompt-Injection (content boundaries, DOM sanitization)
- Audit Log (encrypted SQLite)

### Phase 5: CAPTCHA Engine
- CAPTCHA Detector (DOM observer)
- Strategy Selector (cheapest-first priority)
- Audio Solver (Whisper integration)
- Text/Math Solver (local)
- Slider Solver (mouse simulation)
- Image Solver (Claude vision fallback)
- Whisper model download/management

### Phase 6: Polish & Distribution
- App icons and branding
- Dark/light theme
- Settings UI (vault, permissions, audit log)
- Auto-updater
- electron-builder packaging (DMG, AppImage, exe)
- npm publishing
- Documentation
- GitHub repo setup

---

## Token Budget Targets

| Task | Target Tokens | Notes |
|------|--------------|-------|
| Tool schema loading | <200 | 5 tools with minimal schemas |
| Page description | <50 | Smart describer, compact format |
| Single action | <30 | Intent → result, one line |
| Form fill (5 fields) | <50 | Labels → confirmation |
| Data extraction | <100 | Structured, limited items |
| Full pipeline (5 steps) | <200 | One tool call, one response |
| PharmKulen search flow | <300 | vs ~25,000 current |
| Login to saved site | <30 | "Logged in to X as Y" |
| Post a comment | <50 | Intent → confirmation |

---

## Future Phases (Post-MVP)

### Phase 7: Built-in AI Panel
- Claude sidebar (like Cursor's AI panel)
- Chat about current page
- "Explain this page", "Summarize this article"
- Voice input (Whisper for speech-to-text)

### Phase 8: Workflow Recording
- Record user actions as replayable scripts
- "Watch me do this once, then repeat it"
- Export as pipeline JSON or script

### Phase 9: Profiles & Stealth
- Multiple browser profiles
- Fingerprint management
- Proxy support
- Cookie import/export (encrypted)

### Phase 10: Multi-platform
- Windows support (DPAPI for credential storage)
- Linux support (libsecret for credential storage)
- ARM64 support (already native on Apple Silicon)
