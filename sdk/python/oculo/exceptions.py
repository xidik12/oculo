"""Custom exceptions for the Oculo Python SDK."""


class OculoError(Exception):
    """Base exception for all Oculo SDK errors."""

    def __init__(self, message: str, details: str | None = None):
        self.details = details
        super().__init__(message)


class OculoNotRunning(OculoError):
    """Oculo browser is not running or ~/.oculo-port is missing."""

    def __init__(self, message: str = "Oculo browser is not running. Launch Oculo first."):
        super().__init__(message)


class OculoConnectionRefused(OculoError):
    """Connection to Oculo was refused (stale port file or crashed)."""

    def __init__(self, port: int | None = None):
        msg = "Connection to Oculo refused"
        if port:
            msg += f" on port {port}"
        msg += ". Is the browser still running?"
        super().__init__(msg)


class OculoTimeout(OculoError):
    """Request to Oculo timed out."""

    def __init__(self, timeout_seconds: float = 600.0):
        super().__init__(f"Request to Oculo timed out after {timeout_seconds}s")


class OculoPermissionDenied(OculoError):
    """The requested action was denied by the Oculo permission gate."""

    def __init__(self, action: str = ""):
        msg = "Action denied by Oculo permission gate"
        if action:
            msg += f": {action}"
        super().__init__(msg)


class OculoAuthError(OculoError):
    """Authentication failed (invalid or missing auth token)."""

    def __init__(self):
        super().__init__("Authentication failed. The auth token from ~/.oculo-port may be stale.")


class OculoToolError(OculoError):
    """A tool call returned an error from Oculo."""

    def __init__(self, tool: str, message: str):
        self.tool = tool
        super().__init__(f"Tool '{tool}' error: {message}")
