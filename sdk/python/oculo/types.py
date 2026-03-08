"""Pydantic v2 models for Oculo MCP tool requests and responses."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Request Models ─────────────────────────────────────────────────────────


class PageRequest(BaseModel):
    """Parameters for the `page` tool."""

    detail: Literal["compact", "a11y", "markdown"] | None = Field(
        None,
        description="compact (~30-80 tokens), a11y (ref-tagged tree), or markdown (article extraction)",
    )
    scope: str | None = Field(None, description="CSS selector to scope description")
    include: list[str] | None = Field(
        None,
        description='Categories: "forms", "buttons", "links", "headings", "text", "images"',
    )
    screenshot: bool | None = Field(None, description="Attach a screenshot")
    tab_id: str | None = Field(None, alias="tabId", description="Target a specific tab by ID")


class ActRequest(BaseModel):
    """Parameters for the `act` tool."""

    action: str = Field(..., description="Action to perform (click, navigate, scroll, press, type, hover, etc.)")
    ref: str | None = Field(None, description='Element ref from a11y snapshot (e.g. "e5")')
    text: str | None = Field(None, description="Visible text on the element")
    role: str | None = Field(None, description="ARIA role (button, link, textbox, etc.)")
    name: str | None = Field(None, description="Accessible name of the element")
    label: str | None = Field(None, description="Label text associated with the element")
    placeholder: str | None = Field(None, description="Placeholder text of the input")
    selector: str | None = Field(None, description="CSS selector (fallback)")
    nth: int | None = Field(None, description="Which match to use (0-indexed)")
    url: str | None = Field(None, description="URL for navigate action")
    direction: Literal["up", "down", "left", "right"] | None = Field(None, description="Scroll direction")
    amount: int | None = Field(None, description="Scroll amount in pixels")
    key: str | None = Field(None, description="Key to press (Enter, Tab, Escape, etc.)")
    modifiers: list[str] | None = Field(None, description="Modifier keys (Ctrl, Shift, Alt, Meta)")
    value: str | None = Field(None, description="Value for select action, file path for readFile/writeFile")
    content: str | None = Field(None, description="File content for writeFile action")
    site: str | None = Field(None, description="Site domain for login action")
    clear: bool | None = Field(None, description="Clear existing content before typing")
    screenshot: bool | None = Field(None, description="Attach screenshot after action")
    from_: dict[str, Any] | None = Field(None, alias="from", description="Drag source: {x, y} or {text, selector}")
    to: dict[str, Any] | None = Field(None, description="Drag target: {x, y} or {text, selector}")
    x: int | None = Field(None, description="X coordinate for clickAtPoint/drag")
    y: int | None = Field(None, description="Y coordinate for clickAtPoint/drag")
    expression: str | None = Field(None, description="JavaScript expression for evaluate action")
    attribute: str | None = Field(None, description="Attribute name for getAttribute action")
    cookies: list[dict[str, Any]] | None = Field(None, description="Cookies array for importCookies")
    auto_submit: bool | None = Field(None, alias="autoSubmit", description="Auto-submit after login")
    tab_id: str | None = Field(None, alias="tabId", description="Target a specific tab by ID")


class FillRequest(BaseModel):
    """Parameters for the `fill` tool."""

    fields: dict[str, Any] = Field(..., description='Map of label -> value (e.g. {"Email": "hi@oculo.com"})')
    submit: str | bool | None = Field(None, description="true = first submit button, string = button text")
    screenshot: bool | None = Field(None, description="Attach screenshot after filling")
    tab_id: str | None = Field(None, alias="tabId", description="Target a specific tab by ID")


class ReadRequest(BaseModel):
    """Parameters for the `read` tool."""

    what: str = Field(..., description='What to extract: "search results", "products", "table data", etc.')
    scope: str | None = Field(None, description="CSS selector to narrow extraction scope")
    fields: list[str] | None = Field(None, description="Specific fields to extract")
    limit: int | None = Field(None, description="Max items to return (default: 10)")
    format: Literal["text", "json"] | None = Field(None, description="Output format (default: text)")
    tab_id: str | None = Field(None, alias="tabId", description="Target a specific tab by ID")


class RunStep(BaseModel):
    """A single step in a `run` pipeline."""

    page: dict[str, Any] | None = None
    act: dict[str, Any] | None = None
    fill: dict[str, Any] | None = None
    read: dict[str, Any] | None = None
    wait: dict[str, Any] | None = None
    if_: dict[str, Any] | None = Field(None, alias="if")


class RunRequest(BaseModel):
    """Parameters for the `run` tool."""

    steps: list[dict[str, Any]] | None = Field(None, description="Array of pipeline steps")
    workflow: str | None = Field(None, description="Replay a cached workflow by ID")
    description: str | None = Field(None, description="Short description for caching")
    return_all: bool | None = Field(None, alias="returnAll", description="Return results from all steps")
    tab_id: str | None = Field(None, alias="tabId", description="Target a specific tab by ID")


class MediaRequest(BaseModel):
    """Parameters for the `media` tool."""

    type: Literal["image", "video"] = Field(..., description="Generate an image or video")
    prompt: str = Field(..., description="What to create")
    image: str | None = Field(None, description="Path to reference image for image-to-image editing")
    model: str | None = Field(None, description="Image model: nano-banana-2, nano-banana-pro, nano-banana")
    size: str | None = Field(None, description="Image: 1024x1024, 2K, 4K. Video: 16:9, 9:16")
    style: str | None = Field(None, description="natural, vivid, cinematic, anime")
    provider: str | None = Field(None, description="Override: gemini, openai, stability")
    duration: int | None = Field(None, description="Video duration: 4, 6, or 8 seconds")


class ShellRequest(BaseModel):
    """Parameters for the `shell` tool."""

    command: str = Field(..., description="The shell command to execute")
    timeout: int | None = Field(None, description="Timeout in milliseconds (default: 30000, max: 120000)")


# ── Response Models ────────────────────────────────────────────────────────


class ContentItem(BaseModel):
    """A single content item in an MCP tool response."""

    type: str = "text"
    text: str = ""


class ToolResponse(BaseModel):
    """The response from an MCP tool call."""

    content: list[ContentItem] = Field(default_factory=list)
    is_error: bool | None = Field(None, alias="isError")

    @property
    def text(self) -> str:
        """Extract the text from the first content item."""
        if self.content:
            return self.content[0].text
        return ""

    @property
    def error(self) -> bool:
        """Whether this response represents an error."""
        return bool(self.is_error)


class HealthResponse(BaseModel):
    """Response from the /health endpoint."""

    status: str
    name: str | None = None
