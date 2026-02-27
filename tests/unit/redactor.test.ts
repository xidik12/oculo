import { describe, it, expect, beforeEach } from 'vitest'
import { Redactor } from '../../src/main/security/redactor'

describe('Redactor', () => {
  let redactor: Redactor

  beforeEach(() => {
    redactor = new Redactor()
  })

  describe('redact', () => {
    it('should redact credit card numbers', () => {
      const text = 'Card: 4111-1111-1111-1111'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:card]')
      expect(result).not.toContain('4111')
    })

    it('should redact credit cards without dashes', () => {
      const text = 'Card: 4111111111111111'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:card]')
    })

    it('should redact credit cards with spaces', () => {
      const text = 'Card: 4111 1111 1111 1111'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:card]')
    })

    it('should redact SSN numbers', () => {
      const text = 'SSN: 123-45-6789'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:ssn]')
      expect(result).not.toContain('123-45-6789')
    })

    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      const text = `Token: ${jwt}`
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:token]')
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    })

    it('should redact API keys', () => {
      const text = 'api_key: "sk_live_1234567890abcdefghij"'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:key]')
      expect(result).not.toContain('sk_live_1234567890abcdefghij')
    })

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9abcdefgh'
      const result = redactor.redact(text)
      expect(result).toContain('Bearer [REDACTED:token]')
    })

    it('should redact private keys', () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3lc...
-----END RSA PRIVATE KEY-----`
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:private-key]')
      expect(result).not.toContain('MIIEpAIBAAKCAQEA0Z3VS5JJcds3lc')
    })

    it('should not redact normal text', () => {
      const text = 'Hello, this is a normal page with some content about products and services.'
      const result = redactor.redact(text)
      expect(result).toBe(text)
    })

    it('should not redact short number sequences that are not cards', () => {
      const text = 'Phone: 555-1234'
      const result = redactor.redact(text)
      expect(result).toBe(text)
    })

    it('should handle multiple redactions in one text', () => {
      const text = 'Card: 4111-1111-1111-1111, SSN: 123-45-6789'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:card]')
      expect(result).toContain('[REDACTED:ssn]')
    })
  })

  describe('setCustomPatterns', () => {
    it('should redact custom patterns', () => {
      redactor.setCustomPatterns(['patient-\\d+'])
      const text = 'Record for patient-12345 is ready'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('patient-12345')
    })

    it('should handle invalid regex patterns gracefully', () => {
      // Should not throw on invalid regex
      redactor.setCustomPatterns(['[invalid regex', 'valid-pattern'])
      const text = 'Contains valid-pattern here'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED]')
    })

    it('should apply both built-in and custom patterns', () => {
      redactor.setCustomPatterns(['INTERNAL-\\w+'])
      const text = 'Card: 4111-1111-1111-1111, Ref: INTERNAL-ABC123'
      const result = redactor.redact(text)
      expect(result).toContain('[REDACTED:card]')
      expect(result).toContain('[REDACTED]')
    })
  })

  describe('redactFormFields', () => {
    it('should redact password field values', () => {
      const text = 'password field (type=password, mySecret123)'
      const result = redactor.redactFormFields(text)
      expect(result).toContain('***')
    })

    it('should not modify text without password fields', () => {
      const text = 'email field (type=email, user@test.com)'
      const result = redactor.redactFormFields(text)
      expect(result).toBe(text)
    })
  })
})
