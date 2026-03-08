# Oculo Python SDK

Control the [Oculo AI Browser](https://getoculo.com) programmatically from Python.

Oculo exposes a local HTTP MCP server on `127.0.0.1:19516`. This SDK auto-discovers the port and auth token from `~/.oculo-port` and provides a clean Python API for all 7 browser tools.

## Installation

```bash
pip install oculo
```

Or install from source:

```bash
cd sdk/python
pip install -e .
```

## Quick Start

```python
from oculo import OculoClient

with OculoClient() as browser:
    # Navigate to a page
    browser.navigate("https://news.ycombinator.com")

    # Describe the page (compact, a11y, or markdown)
    print(browser.page(detail="a11y"))

    # Click an element by ref from a11y tree
    browser.click(ref="e5")

    # Fill a form
    browser.fill({"Search": "oculo browser"}, submit=True)

    # Extract structured data
    results = browser.read("search results", limit=5)
    print(results)

    # Run a multi-step pipeline
    browser.run(steps=[
        {"act": {"action": "navigate", "url": "https://example.com"}},
        {"page": {"detail": "a11y"}},
        {"act": {"action": "click", "text": "More information"}},
    ])

    # Generate an image
    browser.media(type="image", prompt="A sunset over mountains")

    # Execute a shell command
    print(browser.shell("ls -la"))
```

## Async Usage

```python
import asyncio
from oculo import AsyncOculoClient

async def main():
    async with AsyncOculoClient() as browser:
        await browser.navigate("https://example.com")
        page = await browser.page(detail="markdown")
        print(page)

asyncio.run(main())
```

## API Reference

### OculoClient / AsyncOculoClient

Both clients share the same API. The async client returns coroutines.

#### Constructor

```python
OculoClient(
    port=None,          # Override port (auto-discovered from ~/.oculo-port)
    token=None,         # Override auth token
    timeout=600.0,      # Request timeout in seconds (10 min default)
    max_retries=3,      # Connection retry attempts
    retry_delay=1.0,    # Delay between retries
    raise_on_error=True # Raise OculoToolError on tool errors
)
```

#### Core Tools

| Method | Description |
|--------|-------------|
| `page(detail, scope, include, screenshot)` | Describe the current page |
| `act(action, ref, text, url, ...)` | Perform a browser action |
| `fill(fields, submit, screenshot)` | Fill form fields by label |
| `read(what, scope, fields, limit, format)` | Extract structured data |
| `run(steps, workflow, description, return_all)` | Execute a multi-step pipeline |
| `media(type, prompt, model, size, style)` | Generate images or videos |
| `shell(command, timeout)` | Execute a shell command |

#### Convenience Methods

| Method | Equivalent |
|--------|-----------|
| `navigate(url)` | `act("navigate", url=url)` |
| `click(ref, text, selector)` | `act("click", ...)` |
| `type_text(text, ref, selector, clear)` | `act("type", ...)` |
| `press(key, modifiers)` | `act("press", ...)` |
| `scroll(direction, amount)` | `act("scroll", ...)` |
| `screenshot()` | `act("screenshot")` |
| `evaluate(expression)` | `act("evaluate", ...)` |

#### Connection

| Method | Description |
|--------|-------------|
| `is_running()` | Check if Oculo is reachable |
| `list_tools()` | List all available MCP tools |
| `close()` | Close the connection |

### Exceptions

| Exception | When |
|-----------|------|
| `OculoNotRunning` | Oculo browser is not running / port file missing |
| `OculoConnectionRefused` | Connection refused after retries |
| `OculoTimeout` | Request timed out |
| `OculoAuthError` | Authentication failed (HTTP 401) |
| `OculoPermissionDenied` | Action denied by permission gate |
| `OculoToolError` | Tool call returned an error |
| `OculoError` | Base exception for all SDK errors |

## How It Works

```
Python SDK  ──HTTP POST──▶  Oculo Electron App (127.0.0.1:19516)
                              │
                              ├─▶ page/act/fill/read → webview.executeJavaScript()
                              ├─▶ media → Gemini / DALL-E 3 / Veo 3.1
                              └─▶ shell → PTY subprocess
```

The SDK reads `~/.oculo-port` (written by Oculo on startup) to discover the port and auth token, then sends JSON requests to the `/mcp` endpoint using the MCP `tools/call` protocol.

## Requirements

- Python 3.10+
- Oculo browser running locally
- Dependencies: `httpx`, `pydantic>=2.0`

## License

MIT
