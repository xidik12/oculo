# oculo-mcp

[![npm version](https://img.shields.io/npm/v/oculo-mcp.svg)](https://www.npmjs.com/package/oculo-mcp)
[![npm downloads](https://img.shields.io/npm/dm/oculo-mcp.svg)](https://www.npmjs.com/package/oculo-mcp)

MCP (Model Context Protocol) server for [Oculo](https://getoculo.com) — the AI-powered native browser. This package connects any MCP client (Claude Code, Claude Desktop, Cursor, Windsurf) to a running Oculo instance via stdio transport.

## Prerequisites

- **Node.js >= 18**
- **Oculo browser** must be running ([download from getoculo.com](https://getoculo.com))

## Quick Start

### Claude Code

```bash
claude mcp add oculo -- npx oculo-mcp
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oculo": {
      "command": "npx",
      "args": ["-y", "oculo-mcp"]
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP settings:

```json
{
  "oculo": {
    "command": "npx",
    "args": ["-y", "oculo-mcp"]
  }
}
```

### Global Install (alternative)

```bash
npm install -g oculo-mcp
```

Then use `oculo-mcp` as the command instead of `npx oculo-mcp`.

## How It Works

Oculo writes its port to `~/.oculo-port` on startup. This bridge reads that file, speaks MCP over stdio, and forwards tool calls to Oculo's HTTP server. Tools are always discoverable (even when Oculo isn't running) — errors surface at call time with clear instructions.

## Available Tools (16)

| Tool | Description |
|------|-------------|
| `page` | Describe current page (compact, a11y tree, or markdown extraction) |
| `act` | Click, navigate, scroll, type, login, screenshot, and 50+ browser actions |
| `fill` | Fill form fields by visible label (text, select, checkbox, contenteditable) |
| `read` | Extract structured data (tables, lists, search results, articles) |
| `run` | Multi-step pipelines with conditionals — cached for replay |
| `media` | Generate images (Nano Banana / DALL-E 3) or videos (Veo 3.1) |
| `shell` | Execute shell commands non-interactively |
| `tabs` | List and manage open browser tabs |
| `research` | Deep web research across multiple tabs |
| `preview` | Pre-fetch a URL without navigating |
| `translate` | Translate page content or text |
| `lens` | Visual analysis via screenshot |
| `abort` | Cancel pending tool calls |
| `status` | List pending tool calls |
| `webmcp_list` | Discover WebMCP tools registered by the page |
| `webmcp_call` | Call a WebMCP tool from the page |

## Example Usage

Once connected, your AI assistant can:

```
"Navigate to github.com and star the oculo repo"
"Fill out the contact form on this page"
"Extract all product prices from this table"
"Take a screenshot and describe what you see"
"Research the latest news about AI browsers"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Oculo browser is not running" | Launch the Oculo app first |
| "Connection refused" | Oculo may have crashed — restart it |
| Stale port file | The bridge auto-cleans `~/.oculo-port` if Oculo isn't responding |
| Tools show but calls fail | Make sure Oculo is in the foreground with a page loaded |

## Links

- **Website:** [getoculo.com](https://getoculo.com)
- **Source:** [github.com/xidik12/oculo](https://github.com/xidik12/oculo)
- **Issues:** [github.com/xidik12/oculo/issues](https://github.com/xidik12/oculo/issues)
- **MCP Directory:** [mcp.so](https://mcp.so)

## License

MIT
