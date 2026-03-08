"""Async Oculo client.

Usage:
    import asyncio
    from oculo import AsyncOculoClient

    async def main():
        async with AsyncOculoClient() as browser:
            print(await browser.page())
            await browser.act("navigate", url="https://example.com")
            await browser.fill({"Search": "oculo browser"}, submit=True)
            results = await browser.read("search results", limit=5)

    asyncio.run(main())
"""

from __future__ import annotations

from typing import Any, Union

from .connection import AsyncOculoConnection
from .exceptions import OculoToolError


class AsyncOculoClient:
    """Async client for controlling the Oculo AI Browser.

    Same API as OculoClient but all methods are async.
    Uses httpx.AsyncClient under the hood.
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
        """Initialize the async Oculo client.

        Args:
            port: Override port (default: read from ~/.oculo-port).
            token: Override auth token (default: read from ~/.oculo-port).
            timeout: Request timeout in seconds (default: 600s / 10min).
            max_retries: Number of connection retry attempts.
            retry_delay: Delay between retries in seconds.
            raise_on_error: If True, raise OculoToolError on tool errors.
        """
        self._conn = AsyncOculoConnection(
            port=port,
            token=token,
            timeout=timeout,
            max_retries=max_retries,
            retry_delay=retry_delay,
        )
        self._raise_on_error = raise_on_error

    async def _call(self, tool: str, args: dict[str, Any]) -> str:
        """Call a tool and return the text result."""
        clean_args = {k: v for k, v in args.items() if v is not None}
        response = await self._conn.call_tool(tool, clean_args)

        if response.error and self._raise_on_error:
            raise OculoToolError(tool, response.text)

        return response.text

    # ── Core Tools ─────────────────────────────────────────────────────────

    async def page(
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
            include: Categories to include.
            screenshot: Attach a screenshot.
            tab_id: Target a specific tab by ID.
        """
        return await self._call("page", {
            "detail": detail,
            "scope": scope,
            "include": include,
            "screenshot": screenshot,
            "tabId": tab_id,
        })

    async def act(
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
            ref: Element ref from a11y snapshot (e.g. "e5").
            text: Visible text on the element.
            url: URL for navigate action.
            selector: CSS selector (fallback).
            key: Key to press.
            direction: Scroll direction.
            amount: Scroll amount in pixels.
            value: Value for select action.
            content: File content for writeFile action.
            role: ARIA role.
            name: Accessible name.
            label: Label text.
            placeholder: Placeholder text.
            nth: Which match to use.
            modifiers: Modifier keys.
            site: Site domain for login.
            clear: Clear existing content before typing.
            screenshot: Attach screenshot after action.
            x: X coordinate.
            y: Y coordinate.
            expression: JavaScript expression for evaluate.
            attribute: Attribute name for getAttribute.
            from_: Drag source.
            to: Drag target.
            cookies: Cookies array for importCookies.
            auto_submit: Auto-submit after login.
            tab_id: Target a specific tab by ID.
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
        return await self._call("act", args)

    async def fill(
        self,
        fields: dict[str, Any],
        submit: Union[str, bool, None] = None,
        screenshot: bool | None = None,
        tab_id: str | None = None,
    ) -> str:
        """Fill form fields by label.

        Args:
            fields: Map of field label -> value.
            submit: True for first submit button, or button text string.
            screenshot: Attach screenshot after filling.
            tab_id: Target a specific tab by ID.
        """
        return await self._call("fill", {
            "fields": fields,
            "submit": submit,
            "screenshot": screenshot,
            "tabId": tab_id,
        })

    async def read(
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
            what: What to extract.
            scope: CSS selector to narrow scope.
            fields: Specific fields to extract.
            limit: Max items to return.
            format: Output format ("text" or "json").
            tab_id: Target a specific tab by ID.
        """
        return await self._call("read", {
            "what": what,
            "scope": scope,
            "fields": fields,
            "limit": limit,
            "format": format,
            "tabId": tab_id,
        })

    async def run(
        self,
        steps: list[dict[str, Any]] | None = None,
        workflow: str | None = None,
        description: str | None = None,
        return_all: bool | None = None,
        tab_id: str | None = None,
    ) -> str:
        """Execute a multi-step pipeline.

        Args:
            steps: Array of pipeline steps.
            workflow: Replay a cached workflow by ID.
            description: Short description for caching.
            return_all: Return results from all steps.
            tab_id: Target a specific tab by ID.
        """
        return await self._call("run", {
            "steps": steps,
            "workflow": workflow,
            "description": description,
            "returnAll": return_all,
            "tabId": tab_id,
        })

    async def media(
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
            image: Path to reference image.
            model: Image model.
            size: Image/video size.
            style: Style preset.
            provider: Provider override.
            duration: Video duration.
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
        return await self._call("media", args)

    async def shell(
        self,
        command: str,
        timeout: int | None = None,
    ) -> str:
        """Execute a shell command.

        Args:
            command: The shell command to execute.
            timeout: Timeout in milliseconds.
        """
        return await self._call("shell", {
            "command": command,
            "timeout": timeout,
        })

    # ── Convenience Methods ────────────────────────────────────────────────

    async def navigate(self, url: str, screenshot: bool | None = None) -> str:
        """Navigate to a URL."""
        return await self.act("navigate", url=url, screenshot=screenshot)

    async def click(self, ref: str | None = None, text: str | None = None, selector: str | None = None) -> str:
        """Click an element."""
        return await self.act("click", ref=ref, text=text, selector=selector)

    async def type_text(self, text: str, ref: str | None = None, selector: str | None = None, clear: bool | None = None) -> str:
        """Type text into an element."""
        return await self.act("type", ref=ref, text=text, selector=selector, clear=clear)

    async def press(self, key: str, modifiers: list[str] | None = None) -> str:
        """Press a key."""
        return await self.act("press", key=key, modifiers=modifiers)

    async def scroll(self, direction: str = "down", amount: int | None = None) -> str:
        """Scroll the page."""
        return await self.act("scroll", direction=direction, amount=amount)

    async def screenshot(self) -> str:
        """Take a screenshot."""
        return await self.act("screenshot")

    async def evaluate(self, expression: str) -> str:
        """Evaluate JavaScript in the page."""
        return await self.act("evaluate", expression=expression)

    # ── Connection Management ──────────────────────────────────────────────

    async def is_running(self) -> bool:
        """Check if Oculo is reachable."""
        return await self._conn.health()

    async def list_tools(self) -> list[dict[str, Any]]:
        """List all available MCP tools."""
        return await self._conn.list_tools()

    async def close(self) -> None:
        """Close the connection."""
        await self._conn.close()

    async def __aenter__(self) -> AsyncOculoClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
