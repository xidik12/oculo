<p align="center">
  <img src="docs/logo.png" alt="Oculo" width="120">
</p>

<h1 align="center">Oculo</h1>
<p align="center"><strong>AI-Powered Native Browser</strong></p>

<p align="center">
  <a href="https://github.com/xidik12/oculo/stargazers"><img src="https://img.shields.io/github/stars/xidik12/oculo?style=flat" alt="Stars"></a>
  <a href="https://github.com/xidik12/oculo/releases"><img src="https://img.shields.io/github/v/release/xidik12/oculo" alt="Release"></a>
  <img src="https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/MCP-12%20tools-orange" alt="MCP Tools">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

<p align="center">
  <a href="https://getoculo.com">Website</a> &middot;
  <a href="https://github.com/xidik12/oculo/releases">Download</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#12-mcp-tools">MCP Tools</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

> *Cursor : VSCode :: Oculo : Chrome*

Open-source AI browser that gives **Claude Code**, **Cursor**, **Windsurf**, and any MCP client the ability to see and interact with any website. 12 tools, under 300 tokens per flow.

## Why Oculo?

| | Feature |
|---|---|
| **Native browser** | Full Chromium engine -- not a wrapper, extension, or headless scraper |
| **12 MCP tools** | page, act, fill, read, run, media, shell, tabs, research, preview, translate, lens |
| **< 300 tokens/flow** | Compact responses by default -- cheaper than screenshot-based approaches |
| **Self-healing automation** | Selector caching + DOM diffing -- 44%+ faster on repeated workflows |
| **Multi-provider AI** | Built-in chat with Claude, OpenAI, Gemini, Grok, OpenClaw, Ollama |
| **4-level security** | auto / notify / confirm / blocked permission gate on every action |
| **OS keychain vault** | Credentials encrypted via `electron.safeStorage` (macOS Keychain / Windows DPAPI) |
| **PII redaction** | Credit cards, SSNs, JWTs, API keys, Bearer tokens stripped from all MCP responses |
| **Anti-injection** | Content boundary markers + regex-based injection detection |
| **19 stealth patches** | Navigator, WebGL, canvas, WebRTC, audio, font, battery, screen fingerprint defenses |
| **Headless mode** | Run without UI -- Docker support included |
| **Cross-platform** | macOS, Windows, Linux |
| **Python SDK** | `pip install oculo` -- sync and async clients |

## Quick Start

### Download

Grab the latest release from [Releases](https://github.com/xidik12/oculo/releases), or build from source:

```bash
git clone https://github.com/xidik12/oculo.git
cd oculo
npm install
npm run dev
```

### Register with Claude Code

```bash
claude mcp add oculo -- node ~/oculo/bin/oculo-mcp.mjs
```

### Register with Cursor / Windsurf

Add to your MCP config (`.cursor/mcp.json` or equivalent):

```json
{
  "mcpServers": {
    "oculo": {
      "command": "node",
      "args": ["/path/to/oculo/bin/oculo-mcp.mjs"]
    }
  }
}
```

Tools are always discoverable (static definitions in the bridge), but Oculo must be running for tool calls to succeed.

## 12 MCP Tools

| Tool | What it does | Token cost |
|------|-------------|------------|
| `page` | Describe current page -- headings, forms, buttons, links. Supports compact, a11y (ref-tagged), and markdown modes | ~30-80 |
| `act` | Navigate, click, hover, scroll, type, press keys, login via vault, manage tabs, cookies, proxy, recording | ~1 line |
| `fill` | Fill form fields by label/placeholder matching, optional submit. Handles text, select, checkbox, contenteditable | ~1 line |
| `read` | Extract structured data -- search results, tables, lists, articles | compact |
| `run` | Multi-step pipeline with conditionals (`page/act/fill/read/wait/if`). Cached for replay | header + last |
| `media` | Generate images (Nano Banana 2 / DALL-E 3) or videos (Veo 3.1). Image-to-image editing | file path |
| `shell` | Execute shell commands non-interactively (ls, npm, git, python, etc.) | stdout+stderr |
| `tabs` | List all open browser tabs with URLs and titles | compact |
| `research` | Deep web research -- opens multiple tabs, reads pages, synthesizes findings | synthesized |
| `preview` | Pre-fetch a URL without navigating away from the current page | page description |
| `translate` | Translate page content or specific text to any language | translated text |
| `lens` | Visual analysis of the current page via screenshot + AI vision | description |

**Bonus:** `webmcp_list` and `webmcp_call` discover and invoke page-declared tools via the [WebMCP](https://webmcp.org) protocol.

### Example Flows

```
You: "Log into GitHub and star the oculo repo"

Claude Code calls:
  1. act({action: "navigate", url: "https://github.com/login"})
  2. act({action: "login", site: "github.com"})         # vault lookup
  3. act({action: "navigate", url: "https://github.com/xidik12/oculo"})
  4. act({action: "click", text: "Star"})

Total: 4 tool calls, <100 tokens response
```

```
You: "Fill out the contact form on example.com"

Claude Code calls:
  1. act({action: "navigate", url: "https://example.com/contact"})
  2. page()                                               # see the form
  3. fill({fields: {"Name": "...", "Email": "..."}, submit: true})

Total: 3 tool calls
```

## Headless Mode

Run Oculo without a visible window for CI/CD, scraping, or server-side automation:

```bash
# Via convenience script
node bin/oculo-headless.mjs

# Or with flags
npx electron . --headless
npx electron . --headless --headless-auto-approve   # auto-approve CONFIRM actions

# Environment variable
OCULO_HEADLESS=1 npm run dev
```

### Docker

```bash
docker compose up
```

The included `Dockerfile` and `docker-compose.yml` run Oculo headless in a container with Xvfb.

## Python SDK

```python
from oculo import OculoClient

# Auto-discovers port from ~/.oculo-port
client = OculoClient()

# Describe the page
print(client.page())

# Navigate
client.act("navigate", url="https://example.com")

# Fill a form
client.fill({"Email": "hi@oculo.com", "Message": "Hello!"}, submit=True)

# Extract data
results = client.read("search results", format="json")
```

Async version available:

```python
from oculo import AsyncOculoClient

async_client = AsyncOculoClient()
await async_client.act("navigate", url="https://example.com")
```

Install from the SDK directory:

```bash
pip install oculo
```

## Architecture

```
Claude Code / Cursor / Windsurf
        |
        | stdio (MCP protocol)
        v
  bin/oculo-mcp.mjs            <-- stdio-to-HTTP bridge
        |
        | HTTP POST :19516/mcp (auth token)
        v
  McpServerManager              <-- Electron main process
        |
        | IPC
        v
  Renderer (React 19)           <-- Chromium process
        |
        | webview.executeJavaScript()
        v
  <webview> tags                <-- Actual web pages
```

**Why HTTP instead of stdio?** Electron's `<webview>` is only accessible from the renderer process. The main process (where stdio lives) can't touch page content. The HTTP bridge solves this via main-to-renderer IPC.

Port discovery: Oculo writes `port:authtoken` to `~/.oculo-port` on startup. The bridge reads this file automatically.

## Security

### Permission Levels

| Level | Actions | Behavior |
|-------|---------|----------|
| **Auto** | navigate, page, read, scroll, screenshot, back, forward, reload, hover, listTabs, switchTab, preview, translate, lens | Executes silently |
| **Notify** | click, type, fill, select, press, submit, newTab, closeTab | Executes + OS notification |
| **Confirm** | payment, delete_account, change_password, send_email, download, oauth, shell, evaluate, setProxy, startRecording | Native dialog approval required |
| **Blocked** | read_vault, export_cookies, export_tokens, disable_security | Always rejected |

### Credential Vault

- Encrypted with `electron.safeStorage` (OS Keychain on macOS, DPAPI on Windows)
- Passwords **never** returned via IPC or MCP -- only domain + username exposed
- `act({action: "login", site: "github.com"})` retrieves and fills credentials automatically

### PII Redaction

All MCP responses pass through a redactor before reaching the AI client. Stripped patterns: credit card numbers, SSNs, JWTs, API keys, private keys, Bearer tokens.

### Anti-Injection

MCP content is wrapped in boundary markers. Regex-based detection blocks prompt injection attempts embedded in page content.

### Stealth (19 patches)

Navigator (webdriver, languages, plugins, mimeTypes, connection, hardwareConcurrency, deviceMemory), window (chrome API, dimensions), WebGL (vendor/renderer spoofing), canvas (fingerprint randomization), WebRTC (IP leak prevention), AudioContext, font enumeration blocking, Battery API, screen resolution randomization.

## Self-Healing Automation

After successful `act` or `fill` calls, element selectors are cached with stability scores:

| Selector type | Score |
|---------------|-------|
| `id` | 10 |
| `data-testid` | 10 |
| `aria-label` | 9 |
| `role` + `name` | 8 |
| `text` | 7 |
| `css` | 5 |

On subsequent runs, DOM diffing determines the strategy:
- **> 80% similarity** -- replay from cache (no LLM call needed)
- **50-80%** -- fallback to alternative selectors
- **< 50%** -- re-engage AI for fresh resolution

## AI Providers

Built-in chat panel supports multiple providers:

| Provider | Auth | Models |
|----------|------|--------|
| **Claude** | API Key or CLI subscription | Opus, Sonnet, Haiku |
| **OpenAI** | API Key or Codex CLI | GPT-4o, GPT-4o mini, o1, o3 |
| **Gemini** | API Key | 2.0 Flash, 1.5 Pro, 1.5 Flash |
| **Grok** | API Key | Grok 2, Grok 2 Mini |
| **Ollama** | Local (no key) | Any pulled model |
| **OpenClaw** | API Key | OpenClaw models |

## Building

```bash
# Production build
npm run build

# Platform distributables
npm run dist:mac      # macOS DMG + ZIP
npm run dist:win      # Windows NSIS + portable
npm run dist:linux    # Linux AppImage + deb

# Other commands
npm run typecheck     # TypeScript checking
npm run lint          # ESLint
npm run test          # Vitest
npm run clean         # Remove build artifacts
```

### Prerequisites

- Node.js 20+
- npm (not pnpm/yarn -- native modules require npm)
- macOS, Windows, or Linux

## Project Structure

```
src/
  main/                    Electron main process
    ai/agent.ts            Multi-provider AI controller
    captcha/               CAPTCHA detection + solvers
    data/                  Bookmarks, downloads, history, session recording
    engine/                Page describer, extractor, form-detector, pipeline, resolver,
                           selector-cache, dom-differ, tab-manager
    mcp/server.ts          HTTP MCP server (port 19516-19520, auth token)
    mcp/tools/             act, fill, page, read, run tool handlers
    network/proxy.ts       HTTP/SOCKS proxy manager
    security/              Vault, permissions, redactor, audit, anti-injection
  preload/index.ts         contextBridge API
  renderer/
    App.tsx                Root browser UI component
    components/            TabBar, AddressBar, ChatPanel, WebViewContainer,
                           bookmarks, downloads, find, history, layout, common
  shared/                  Types, constants, IPC channels, AI provider definitions
bin/
  oculo-mcp.mjs            stdio-to-HTTP MCP bridge (for Claude Code / Cursor)
  oculo-headless.mjs        Headless mode launcher
sdk/python/                Python SDK (pip install oculo)
Dockerfile                 Container deployment
docker-compose.yml         Docker Compose for headless mode
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture details, and how to add new MCP tools.

## Donate

If Oculo saves you time, consider supporting development:

**BTC:** `12yRGpUfFznzZoz4yVfZKRxLSkAwbanw2B`

## License

[MIT](LICENSE)

---

Built by [Salakhitdinov Khidayotullo](https://github.com/xidik12) | [getoculo.com](https://getoculo.com)
