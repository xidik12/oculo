"""Synchronous Oculo client.

Usage:
    from oculo import OculoClient

    with OculoClient() as browser:
        print(browser.page())
        browser.act("navigate", url="https://example.com")
        browser.fill({"Search": "oculo browser"}, submit=True)
        results = browser.read("search results", limit=5)
"""

from __future__ import annotations

from typing import Any, Union

from .connection import OculoConnection
from .exceptions import OculoToolError


class OculoClient:
    """Synchronous client for controlling the Oculo AI Browser.

    Connects to the running Oculo Electron app via its local HTTP MCP server.
    Port and auth token are auto-discovered from ~/.oculo-port.
    """

    def __init__(
        self,
        port: int | None = None,
        token: str | None = None,
        timeout: float = 600.0,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        raise_on_error: bool = True,
    ):
        """Initialize the Oculo client.

        Args:
            port: Override port (default: read from ~/.oculo-port).
            token: Override auth token (default: read from ~/.oculo-port).
            timeout: Request timeout in seconds (default: 600s / 10min).
            max_retries: Number of connection retry attempts.
            retry_delay: Delay between retries in seconds.
            raise_on_error: If True, raise OculoToolError on tool errors.
                           If False, return the error text as a string.
        """
        self._conn = OculoConnection(
            port=port,
            token=token,
            timeout=timeout,
            max_retries=max_retries,
            retry_delay=retry_delay,
        )
        self._raise_on_error = raise_on_error

    def _call(self, tool: str, args: dict[str, Any]) -> str:
        """Call a tool and return the text result.

        Strips None values from args before sending.
        """
        # Remove None values — the MCP server doesn't expect them
        clean_args = {k: v for k, v in args.items() if v is not None}
        response = self._conn.call_tool(tool, clean_args)

        if response.error and self._raise_on_error:
            raise OculoToolError(tool, response.text)

        return response.text

    # ── Core Tools ─────────────────────────────────────────────────────────

    def page(
        self,
        detail: str | None = None,
        scope: str | None = None,
        include: list[str] | None = None,
        screenshot: bool | None = None,
        tab_id: str | None = None,
    ) -> str:
        """Describe the current page.

        Args:
            detail: "compact" (~30-80 tokens), "a11y" (ref-tagged tree), or "markdown" (article).
            scope: CSS selector to scope the description.
            include: Categories to include: "forms", "buttons", "links", "headings", "text", "images".
            screenshot: Attach a screenshot.
            tab_id: Target a specific tab by ID.

        Returns:
            Page description text.
        """
        return self._call("page", {
            "detail": detail,
            "scope": scope,
            "include": include,
            "screenshot": screenshot,
            "tabId": tab_id,
        })

    def act(
        self,
        action: str,
        ref: str | None = None,
        text: str | None = None,
        url: str | None = None,
        selector: str | None = None,
        key: str | None = None,
        direction: str | None = None,
        amount: int | None = None,
        value: str | None = None,
        content: str | None = None,
        role: str | None = None,
        name: str | None = None,
        label: str | None = None,
        placeholder: str | None = None,
        nth: int | None = None,
        modifiers: list[str] | None = None,
        site: str | None = None,
        clear: bool | None = None,
        screenshot: bool | None = None,
        x: int | None = None,
        y: int | None = None,
        expression: str | None = None,
        attribute: str | None = None,
        from_: dict[str, Any] | None = None,
        to: dict[str, Any] | None = None,
        cookies: list[dict[str, Any]] | None = None,
        auto_submit: bool | None = None,
        tab_id: str | None = None,
        **kwargs: Any,
    ) -> str:
        """Perform an action in the browser.

        Args:
            action: Action to perform (click, navigate, scroll, press, type, hover, etc.).
            ref: Element ref from a11y snapshot (e.g. "e5"). Preferred targeting method.
            text: Visible text on the element.
            url: URL for navigate action.
            selector: CSS selector (fallback).
            key: Key to press (Enter, Tab, Escape, etc.).
            direction: Scroll direction (up, down, left, right).
            amount: Scroll amount in pixels.
            value: Value for select action, file path for readFile/writeFile.
            content: File content for writeFile action.
            role: ARIA role (button, link, textbox, etc.).
            name: Accessible name of the element.
            label: Label text associated with the element.
            placeholder: Placeholder text of the input.
            nth: Which match to use (0-indexed).
            modifiers: Modifier keys (Ctrl, Shift, Alt, Meta).
            site: Site domain for login action.
            clear: Clear existing content before typing.
            screenshot: Attach screenshot after action.
            x: X coordinate for clickAtPoint/drag.
            y: Y coordinate for clickAtPoint/drag.
            expression: JavaScript expression for evaluate action.
            attribute: Attribute name for getAttribute action.
            from_: Drag source: {x, y} or {text, selector}.
            to: Drag target: {x, y} or {text, selector}.
            cookies: Cookies array for importCookies.
            auto_submit: Auto-submit after login.
            tab_id: Target a specific tab by ID.
            **kwargs: Additional arguments passed directly.

        Returns:
            Action result text (often a fresh a11y snapshot after navigation actions).
        """
        args: dict[str, Any] = {
            "action": action,
            "ref": ref,
            "text": text,
            "url": url,
            "selector": selector,
            "key": key,
            "direction": direction,
            "amount": amount,
            "value": value,
            "content": content,
            "role": role,
            "name": name,
            "label": label,
            "placeholder": placeholder,
            "nth": nth,
            "modifiers": modifiers,
            "site": site,
            "clear": clear,
            "screenshot": screenshot,
            "x": x,
            "y": y,
            "expression": expression,
            "attribute": attribute,
            "from": from_,
            "to": to,
            "cookies": cookies,
            "autoSubmit": auto_submit,
            "tabId": tab_id,
            **kwargs,
        }
        return self._call("act", args)

    def fill(
        self,
        fields: dict[str, Any],
        submit: Union[str, bool, None] = None,
        screenshot: bool | None = None,
        tab_id: str | None = None,
    ) -> str:
        """Fill form fields by label.

        Args:
            fields: Map of field label -> value (e.g. {"Email": "hi@oculo.com"}).
            submit: True for first submit button, or button text string.
            screenshot: Attach screenshot after filling.
            tab_id: Target a specific tab by ID.

        Returns:
            Fill result text.
        """
        return self._call("fill", {
            "fields": fields,
            "submit": submit,
            "screenshot": screenshot,
            "tabId": tab_id,
        })

    def read(
        self,
        what: str,
        scope: str | None = None,
        fields: list[str] | None = None,
        limit: int | None = None,
        format: str | None = None,
        tab_id: str | None = None,
    ) -> str:
        """Extract structured data from the page.

        Args:
            what: What to extract ("search results", "products", "table data", etc.).
            scope: CSS selector to narrow extraction scope.
            fields: Specific fields to extract.
            limit: Max items to return (default: 10).
            format: Output format ("text" or "json").
            tab_id: Target a specific tab by ID.

        Returns:
            Extracted data as text or JSON string.
        """
        return self._call("read", {
            "what": what,
            "scope": scope,
            "fields": fields,
            "limit": limit,
            "format": format,
            "tabId": tab_id,
        })

    def run(
        self,
        steps: list[dict[str, Any]] | None = None,
        workflow: str | None = None,
        description: str | None = None,
        return_all: bool | None = None,
        tab_id: str | None = None,
    ) -> str:
        """Execute a multi-step pipeline.

        Args:
            steps: Array of pipeline steps. Each step has exactly ONE key:
                   page, act, fill, read, wait, or if.
            workflow: Replay a cached workflow by ID.
            description: Short description for caching.
            return_all: Return results from all steps (default: last only).
            tab_id: Target a specific tab by ID.

        Returns:
            Pipeline result text.
        """
        return self._call("run", {
            "steps": steps,
            "workflow": workflow,
            "description": description,
            "returnAll": return_all,
            "tabId": tab_id,
        })

    def media(
        self,
        type: str,
        prompt: str,
        image: str | None = None,
        model: str | None = None,
        size: str | None = None,
        style: str | None = None,
        provider: str | None = None,
        duration: int | None = None,
        **kwargs: Any,
    ) -> str:
        """Generate images or videos.

        Args:
            type: "image" or "video".
            prompt: What to create.
            image: Path to reference image for image-to-image editing.
            model: Image model (nano-banana-2, nano-banana-pro, nano-banana).
            size: Image: 1024x1024, 2K, 4K. Video: 16:9, 9:16.
            style: natural, vivid, cinematic, anime.
            provider: Override: gemini, openai, stability.
            duration: Video duration: 4, 6, or 8 seconds.
            **kwargs: Additional arguments.

        Returns:
            File path of the generated media.
        """
        args: dict[str, Any] = {
            "type": type,
            "prompt": prompt,
            "image": image,
            "model": model,
            "size": size,
            "style": style,
            "provider": provider,
            "duration": duration,
            **kwargs,
        }
        return self._call("media", args)

    def shell(
        self,
        command: str,
        timeout: int | None = None,
    ) -> str:
        """Execute a shell command.

        Args:
            command: The shell command to execute.
            timeout: Timeout in milliseconds (default: 30000, max: 120000).

        Returns:
            stdout + stderr output with exit code.
        """
        return self._call("shell", {
            "command": command,
            "timeout": timeout,
        })

    # ── Convenience Methods ────────────────────────────────────────────────

    def navigate(self, url: str, screenshot: bool | None = None) -> str:
        """Navigate to a URL. Shortcut for act("navigate", url=...)."""
        return self.act("navigate", url=url, screenshot=screenshot)

    def click(self, ref: str | None = None, text: str | None = None, selector: str | None = None) -> str:
        """Click an element. Shortcut for act("click", ...)."""
        return self.act("click", ref=ref, text=text, selector=selector)

    def type_text(self, text: str, ref: str | None = None, selector: str | None = None, clear: bool | None = None) -> str:
        """Type text into an element. Shortcut for act("type", ...)."""
        return self.act("type", ref=ref, text=text, selector=selector, clear=clear)

    def press(self, key: str, modifiers: list[str] | None = None) -> str:
        """Press a key. Shortcut for act("press", ...)."""
        return self.act("press", key=key, modifiers=modifiers)

    def scroll(self, direction: str = "down", amount: int | None = None) -> str:
        """Scroll the page. Shortcut for act("scroll", ...)."""
        return self.act("scroll", direction=direction, amount=amount)

    def screenshot(self) -> str:
        """Take a screenshot. Shortcut for act("screenshot")."""
        return self.act("screenshot")

    def evaluate(self, expression: str) -> str:
        """Evaluate JavaScript in the page. Shortcut for act("evaluate", ...)."""
        return self.act("evaluate", expression=expression)

    # ── Connection Management ──────────────────────────────────────────────

    def is_running(self) -> bool:
        """Check if Oculo is reachable."""
        return self._conn.health()

    def list_tools(self) -> list[dict[str, Any]]:
        """List all available MCP tools."""
        return self._conn.list_tools()

    def close(self) -> None:
        """Close the connection."""
        self._conn.close()

    def __enter__(self) -> OculoClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
