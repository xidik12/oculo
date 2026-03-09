import { describe, it, expect } from 'vitest'
import { createStructuredError, detectRecoverableError, getRetryConfig, ERROR_CODES } from '../../src/main/engine/error-recovery'

describe('Error Recovery', () => {
  describe('createStructuredError', () => {
    it('should create structured error for ELEMENT_NOT_FOUND', () => {
      const err = createStructuredError('ELEMENT_NOT_FOUND', 'Submit button')
      expect(err.error).toBe('ELEMENT_NOT_FOUND')
      expect(err.message).toContain('Submit button')
      expect(err.suggestion).toBeTruthy()
      expect(err.retryable).toBe(true)
    })

    it('should create non-retryable error for PAGE_CRASHED', () => {
      const err = createStructuredError('PAGE_CRASHED')
      expect(err.retryable).toBe(false)
    })

    it('should create non-retryable error for PERMISSION_DENIED', () => {
      const err = createStructuredError('PERMISSION_DENIED')
      expect(err.retryable).toBe(false)
    })

    it('should create non-retryable error for INVALID_SELECTOR', () => {
      const err = createStructuredError('INVALID_SELECTOR', 'div[[[')
      expect(err.retryable).toBe(false)
      expect(err.message).toContain('div[[[')
    })

    it('should handle all error codes', () => {
      for (const code of Object.values(ERROR_CODES)) {
        const err = createStructuredError(code)
        expect(err.error).toBe(code)
        expect(err.message).toBeTruthy()
        expect(err.suggestion).toBeTruthy()
        expect(typeof err.retryable).toBe('boolean')
      }
    })

    it('should include detail in message when provided', () => {
      const err = createStructuredError('TIMEOUT', 'after 30s')
      expect(err.message).toBe('Operation timed out: after 30s')
    })

    it('should produce clean message without detail', () => {
      const err = createStructuredError('TIMEOUT')
      expect(err.message).toBe('Operation timed out')
    })
  })

  describe('detectRecoverableError', () => {
    it('should detect element not found', () => {
      const result = detectRecoverableError('Element not found: Submit')
      expect(result?.code).toBe('ELEMENT_NOT_FOUND')
      expect(result?.shouldRetry).toBe(true)
    })

    it('should detect "not found:" pattern', () => {
      const result = detectRecoverableError('Button not found: Login')
      expect(result?.code).toBe('ELEMENT_NOT_FOUND')
    })

    it('should detect network errors with ERR_ABORTED', () => {
      const result = detectRecoverableError('net::ERR_ABORTED')
      expect(result?.code).toBe('NAVIGATION_FAILED')
      expect(result?.shouldRetry).toBe(true)
    })

    it('should detect network errors with other net:: codes', () => {
      const result = detectRecoverableError('net::ERR_NAME_NOT_RESOLVED')
      expect(result?.code).toBe('NAVIGATION_FAILED')
    })

    it('should detect timeout errors', () => {
      const result = detectRecoverableError('Operation timed out after 30000ms')
      expect(result?.code).toBe('TIMEOUT')
      expect(result?.shouldRetry).toBe(true)
    })

    it('should detect page crashes', () => {
      const result = detectRecoverableError('Render process gone: crashed')
      expect(result?.code).toBe('PAGE_CRASHED')
      expect(result?.shouldRetry).toBe(false)
    })

    it('should detect webview not ready', () => {
      const result = detectRecoverableError('No webview available')
      expect(result?.code).toBe('WEBVIEW_NOT_READY')
      expect(result?.shouldRetry).toBe(true)
    })

    it('should return null for successful results', () => {
      expect(detectRecoverableError('Clicked "Submit"')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(detectRecoverableError('')).toBeNull()
    })

    it('should be case-insensitive', () => {
      expect(detectRecoverableError('ELEMENT NOT FOUND')?.code).toBe('ELEMENT_NOT_FOUND')
      expect(detectRecoverableError('TIMEOUT')?.code).toBe('TIMEOUT')
    })
  })

  describe('getRetryConfig', () => {
    it('should return retry config for ELEMENT_NOT_FOUND', () => {
      const config = getRetryConfig('ELEMENT_NOT_FOUND')
      expect(config.maxRetries).toBe(1)
      expect(config.delayMs).toBe(500)
    })

    it('should return retry config for NAVIGATION_FAILED', () => {
      const config = getRetryConfig('NAVIGATION_FAILED')
      expect(config.maxRetries).toBe(1)
      expect(config.delayMs).toBe(1000)
    })

    it('should allow more retries for WEBVIEW_NOT_READY', () => {
      const config = getRetryConfig('WEBVIEW_NOT_READY')
      expect(config.maxRetries).toBe(2)
      expect(config.delayMs).toBe(1000)
    })

    it('should return zero retries for non-retryable errors', () => {
      expect(getRetryConfig('PERMISSION_DENIED').maxRetries).toBe(0)
      expect(getRetryConfig('PAGE_CRASHED').maxRetries).toBe(0)
      expect(getRetryConfig('INVALID_SELECTOR').maxRetries).toBe(0)
    })

    it('should return zero delay for non-retryable errors', () => {
      expect(getRetryConfig('PERMISSION_DENIED').delayMs).toBe(0)
      expect(getRetryConfig('PAGE_CRASHED').delayMs).toBe(0)
    })
  })

  describe('ERROR_CODES', () => {
    it('should have 8 error codes', () => {
      expect(Object.keys(ERROR_CODES)).toHaveLength(8)
    })

    it('should have matching key-value pairs', () => {
      for (const [key, value] of Object.entries(ERROR_CODES)) {
        expect(key).toBe(value)
      }
    })
  })
})
