/**
 * Error recovery strategies for MCP tool execution.
 * Provides structured error responses and retry logic.
 */

export interface StructuredError {
  error: string
  message: string
  suggestion: string
  retryable: boolean
}

export const ERROR_CODES = {
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  TIMEOUT: 'TIMEOUT',
  PAGE_CRASHED: 'PAGE_CRASHED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_SELECTOR: 'INVALID_SELECTOR',
  WEBVIEW_NOT_READY: 'WEBVIEW_NOT_READY',
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

/**
 * Create a structured error response for MCP tool results.
 */
export function createStructuredError(code: ErrorCode, detail?: string): StructuredError {
  const suggestions: Record<ErrorCode, string> = {
    ELEMENT_NOT_FOUND: 'Try using page(detail="a11y") to see available elements, then use the exact ref number or text.',
    NAVIGATION_FAILED: 'Check the URL is valid and the site is accessible. Try act(action="navigate", url="...") again.',
    TIMEOUT: 'The page may be loading slowly. Try page() to check current state, then retry the action.',
    PAGE_CRASHED: 'The page crashed. Try act(action="navigate") to reload, or act(action="reload").',
    NETWORK_ERROR: 'Network request failed. Check if the site is accessible and try again.',
    PERMISSION_DENIED: 'This action requires user confirmation. The user may have denied the permission.',
    INVALID_SELECTOR: 'The CSS selector is invalid. Use page(detail="a11y") to find the correct element reference.',
    WEBVIEW_NOT_READY: 'The browser tab is not ready. Wait a moment and try again.',
  }

  const messages: Record<ErrorCode, string> = {
    ELEMENT_NOT_FOUND: `Element not found${detail ? ': ' + detail : ''}`,
    NAVIGATION_FAILED: `Navigation failed${detail ? ': ' + detail : ''}`,
    TIMEOUT: `Operation timed out${detail ? ': ' + detail : ''}`,
    PAGE_CRASHED: `Page crashed${detail ? ': ' + detail : ''}`,
    NETWORK_ERROR: `Network error${detail ? ': ' + detail : ''}`,
    PERMISSION_DENIED: `Permission denied${detail ? ': ' + detail : ''}`,
    INVALID_SELECTOR: `Invalid selector${detail ? ': ' + detail : ''}`,
    WEBVIEW_NOT_READY: `Browser tab not ready${detail ? ': ' + detail : ''}`,
  }

  return {
    error: code,
    message: messages[code],
    suggestion: suggestions[code],
    retryable: ['ELEMENT_NOT_FOUND', 'TIMEOUT', 'NETWORK_ERROR', 'WEBVIEW_NOT_READY'].includes(code)
  }
}

/**
 * Parse a tool result string and detect if it's an error that can be auto-recovered.
 */
export function detectRecoverableError(result: string): { code: ErrorCode; shouldRetry: boolean } | null {
  if (!result) return null

  const lower = result.toLowerCase()

  if (lower.includes('element not found') || lower.includes('not found:')) {
    return { code: 'ELEMENT_NOT_FOUND', shouldRetry: true }
  }

  if (lower.includes('err_aborted') || lower.includes('net::err_')) {
    return { code: 'NAVIGATION_FAILED', shouldRetry: true }
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { code: 'TIMEOUT', shouldRetry: true }
  }

  if (lower.includes('crashed') || lower.includes('render process gone')) {
    return { code: 'PAGE_CRASHED', shouldRetry: false }
  }

  if (lower.includes('no webview') || lower.includes('webview not ready')) {
    return { code: 'WEBVIEW_NOT_READY', shouldRetry: true }
  }

  return null
}

/**
 * Retry configuration for different error types.
 */
export function getRetryConfig(code: ErrorCode): { maxRetries: number; delayMs: number } {
  switch (code) {
    case 'ELEMENT_NOT_FOUND':
      return { maxRetries: 1, delayMs: 500 }
    case 'NAVIGATION_FAILED':
      return { maxRetries: 1, delayMs: 1000 }
    case 'TIMEOUT':
      return { maxRetries: 1, delayMs: 500 }
    case 'WEBVIEW_NOT_READY':
      return { maxRetries: 2, delayMs: 1000 }
    default:
      return { maxRetries: 0, delayMs: 0 }
  }
}
