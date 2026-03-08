"""Oculo Python SDK — Control the Oculo AI Browser programmatically.

Usage:
    from oculo import OculoClient

    with OculoClient() as browser:
        browser.navigate("https://example.com")
        print(browser.page(detail="a11y"))
        browser.click(ref="e5")

Async usage:
    from oculo import AsyncOculoClient

    async with AsyncOculoClient() as browser:
        await browser.navigate("https://example.com")
        print(await browser.page(detail="a11y"))
        await browser.click(ref="e5")
"""

from .async_client import AsyncOculoClient
from .client import OculoClient
from .exceptions import (
    OculoAuthError,
    OculoConnectionRefused,
    OculoError,
    OculoNotRunning,
    OculoPermissionDenied,
    OculoTimeout,
    OculoToolError,
)

__version__ = "0.1.0"

__all__ = [
    "OculoClient",
    "AsyncOculoClient",
    "OculoError",
    "OculoNotRunning",
    "OculoConnectionRefused",
    "OculoTimeout",
    "OculoPermissionDenied",
    "OculoAuthError",
    "OculoToolError",
]
