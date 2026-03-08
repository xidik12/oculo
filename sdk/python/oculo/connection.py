"""Connection management for Oculo MCP HTTP server.

Handles port discovery from ~/.oculo-port, authentication, health checks,
and HTTP transport to the Oculo Electron app.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import httpx

from .exceptions import (
    OculoAuthError,
    OculoConnectionRefused,
    OculoError,
    OculoNotRunning,
    OculoTimeout,
)
from .types import ToolResponse

PORT_FILE = Path.home() / ".oculo-port"
DEFAULT_TIMEOUT = 600.0  # 10 minutes, matching the bridge


def read_port_file() -> tuple[int, str]:
    """Read port and auth token from ~/.oculo-port.

    File format: `port:authtoken`

    Returns:
        Tuple of (port, token).

    Raises:
        OculoNotRunning: If the port file doesn't exist or is malformed.
    """
    if not PORT_FILE.exists():
        raise OculoNotRunning()

    raw = PORT_FILE.read_text().strip()
    if not raw:
        raise OculoNotRunning("Port file is empty.")

    colon_idx = raw.find(":")
    if colon_idx == -1:
        # Port only, no token
        try:
            port = int(raw)
            return port, ""
        except ValueError:
            raise OculoNotRunning(f"Invalid port file content: {raw}")

    try:
        port = int(raw[:colon_idx])
    except ValueError:
        raise OculoNotRunning(f"Invalid port in port file: {raw[:colon_idx]}")

    token = raw[colon_idx + 1 :]
    return port, token


class OculoConnection:
    """Synchronous HTTP connection to Oculo's MCP server."""

    def __init__(
        self,
        port: int | None = None,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        if port is not None and token is not None:
            self._port = port
            self._token = token
        else:
            self._port, self._token = read_port_file()

        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._base_url = f"http://127.0.0.1:{self._port}"
        self._client = httpx.Client(timeout=timeout)

    @property
    def port(self) -> int:
        return self._port

    @property
    def base_url(self) -> str:
        return self._base_url

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def health(self) -> bool:
        """Check if Oculo is reachable.

        Returns:
            True if the health endpoint responds with 200.
        """
        try:
            resp = self._client.get(f"{self._base_url}/health", timeout=2.0)
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> ToolResponse:
        """Send a tools/call request to Oculo.

        Args:
            name: Tool name (page, act, fill, read, run, media, shell).
            arguments: Tool arguments dict.

        Returns:
            ToolResponse with the result.

        Raises:
            OculoConnectionRefused: If connection is refused after retries.
            OculoTimeout: If the request times out.
            OculoAuthError: If authentication fails (HTTP 401).
            OculoError: For other HTTP or protocol errors.
        """
        body = {
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments or {},
            },
        }

        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                resp = self._client.post(
                    f"{self._base_url}/mcp",
                    json=body,
                    headers=self._headers(),
                )

                if resp.status_code == 401:
                    raise OculoAuthError()
                if resp.status_code != 200:
                    raise OculoError(f"HTTP {resp.status_code}: {resp.text}")

                data = resp.json()
                return ToolResponse.model_validate(data)

            except httpx.ConnectError as e:
                last_error = e
                if attempt < self._max_retries - 1:
                    time.sleep(self._retry_delay)
                continue
            except httpx.TimeoutException:
                raise OculoTimeout(self._timeout)

        raise OculoConnectionRefused(self._port)

    def list_tools(self) -> list[dict[str, Any]]:
        """Send a tools/list request to Oculo.

        Returns:
            List of tool definitions.
        """
        body = {"method": "tools/list"}
        try:
            resp = self._client.post(
                f"{self._base_url}/mcp",
                json=body,
                headers=self._headers(),
            )
            if resp.status_code == 401:
                raise OculoAuthError()
            if resp.status_code != 200:
                raise OculoError(f"HTTP {resp.status_code}: {resp.text}")
            data = resp.json()
            return data.get("tools", [])
        except httpx.ConnectError:
            raise OculoConnectionRefused(self._port)
        except httpx.TimeoutException:
            raise OculoTimeout(self._timeout)

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> OculoConnection:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class AsyncOculoConnection:
    """Async HTTP connection to Oculo's MCP server."""

    def __init__(
        self,
        port: int | None = None,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        if port is not None and token is not None:
            self._port = port
            self._token = token
        else:
            self._port, self._token = read_port_file()

        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._base_url = f"http://127.0.0.1:{self._port}"
        self._client = httpx.AsyncClient(timeout=timeout)

    @property
    def port(self) -> int:
        return self._port

    @property
    def base_url(self) -> str:
        return self._base_url

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    async def health(self) -> bool:
        """Check if Oculo is reachable."""
        try:
            resp = await self._client.get(f"{self._base_url}/health", timeout=2.0)
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> ToolResponse:
        """Send a tools/call request to Oculo.

        Args:
            name: Tool name (page, act, fill, read, run, media, shell).
            arguments: Tool arguments dict.

        Returns:
            ToolResponse with the result.
        """
        import asyncio

        body = {
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments or {},
            },
        }

        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                resp = await self._client.post(
                    f"{self._base_url}/mcp",
                    json=body,
                    headers=self._headers(),
                )

                if resp.status_code == 401:
                    raise OculoAuthError()
                if resp.status_code != 200:
                    raise OculoError(f"HTTP {resp.status_code}: {resp.text}")

                data = resp.json()
                return ToolResponse.model_validate(data)

            except httpx.ConnectError as e:
                last_error = e
                if attempt < self._max_retries - 1:
                    await asyncio.sleep(self._retry_delay)
                continue
            except httpx.TimeoutException:
                raise OculoTimeout(self._timeout)

        raise OculoConnectionRefused(self._port)

    async def list_tools(self) -> list[dict[str, Any]]:
        """Send a tools/list request to Oculo."""
        body = {"method": "tools/list"}
        try:
            resp = await self._client.post(
                f"{self._base_url}/mcp",
                json=body,
                headers=self._headers(),
            )
            if resp.status_code == 401:
                raise OculoAuthError()
            if resp.status_code != 200:
                raise OculoError(f"HTTP {resp.status_code}: {resp.text}")
            data = resp.json()
            return data.get("tools", [])
        except httpx.ConnectError:
            raise OculoConnectionRefused(self._port)
        except httpx.TimeoutException:
            raise OculoTimeout(self._timeout)

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> AsyncOculoConnection:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
