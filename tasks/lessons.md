# Oculo — Lessons Learned

> Record insights and corrections as we build.

## Architecture Decisions

1. **Electron over Tauri** — Chose Electron because it provides Chromium (same engine as Chrome), giving us a real browser with full web compatibility. Tauri uses system WebView (WebKit on macOS) which has different rendering behavior.

2. **5 tools, not 36** — Learned from WebPilot that tool proliferation wastes tokens on schema loading alone. 5 tools at ~40 tokens each = 200 tokens vs 36 tools at ~100 tokens each = 3600 tokens.

3. **Server-side resolution, not snapshots** — The biggest token waste in browser automation is sending full DOM/accessibility trees to the AI. Moving element resolution to the server (browser-side JS) eliminates 95%+ of token usage.

4. **Credential vault, not inline passwords** — Never pass credentials through MCP. The browser manages auth internally using OS-level secure storage.

## Gotchas

(To be filled as we encounter issues during development)
