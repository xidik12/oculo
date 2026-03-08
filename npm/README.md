# oculo-mcp

MCP (Model Context Protocol) server bridge for [Oculo](https://getoculo.com) -- the AI-powered native browser. This lightweight package connects Claude Code (or any MCP client) to a running Oculo instance via stdio-to-HTTP proxy.

## Prerequisites

- **Node.js >= 18**
- **Oculo browser** must be running (download from [getoculo.com](https://getoculo.com))

## Install

```bash
npm install -g oculo-mcp
```

## Register with Claude Code

```bash
claude mcp add oculo -- npx oculo-mcp
```

That's it. Claude Code will now have access to Oculo's browser tools.

## How it works

Oculo writes its port to `~/.oculo-port` on startup. This bridge reads that file, speaks MCP over stdio with Claude Code, and forwards tool calls to Oculo's HTTP server. Tools are always discoverable (even when Oculo isn't running) -- errors surface at call time with clear instructions.

## Available Tools

| Tool | Description |
|------|-------------|
| `page` | Describe current page (compact, a11y tree, or markdown) |
| `act` | Click, navigate, scroll, type, login, and 50+ browser actions |
| `fill` | Fill form fields by visible label |
| `read` | Extract structured data (tables, lists, search results) |
| `run` | Multi-step pipelines with conditionals |
| `media` | Generate images or videos |
| `shell` | Execute shell commands |
| `tabs` | List open browser tabs |
| `research` | Deep web research across multiple tabs |
| `preview` | Pre-fetch a URL without navigating |
| `translate` | Translate page content or text |
| `lens` | Visual analysis via screenshot |

## Links

- **Website:** [getoculo.com](https://getoculo.com)
- **Source:** [github.com/xidik12/oculo](https://github.com/xidik12/oculo)
- **Issues:** [github.com/xidik12/oculo/issues](https://github.com/xidik12/oculo/issues)

## License

MIT
